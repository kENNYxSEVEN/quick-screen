import { useEffect, useState } from "react";

import { ApiError, type RoomStatus } from "@/lib/api";
import {
  WebRtcSignalingError,
  createSubscriber,
  type SubscriberConnection,
} from "@/lib/webrtc";
import type { ViewerConnectionState } from "@/types/viewer";

const PUBLISHER_RETRY_DELAY_MS = 1_000;
const RECONNECT_RETRY_BASE_DELAY_MS = 1_000;
const RECONNECT_RETRY_MAX_DELAY_MS = 5_000;
const BACKGROUND_RECOVERY_DELAY_MS = 15_000;
const DISCONNECTED_GRACE_PERIOD_MS = 2_000;
const MAX_RECONNECT_RETRIES = 6;
const MAX_PUBLISHER_NOT_READY_FAST_RETRIES = 10;

interface ViewerMediaState {
  state: ViewerConnectionState;
  stream: MediaStream | null;
}

function getErrorCause(error: unknown) {
  return error instanceof WebRtcSignalingError ? error.cause : error;
}

function isPublisherNotReady(error: unknown) {
  const cause = getErrorCause(error);

  return (
    cause instanceof ApiError &&
    cause.status === 409 &&
    cause.code === "publisher_not_ready"
  );
}

function isRetryableSubscriberError(error: unknown) {
  const cause = getErrorCause(error);

  // Browser/WebRTC/network failures are generally transient enough to retry.
  if (!(cause instanceof ApiError)) {
    return true;
  }

  // The host can be live while its publisher is still becoming ready.
  if (cause.status === 409 && cause.code === "publisher_not_ready") {
    return true;
  }

  // Retry timeouts, rate limiting, and server/media-service failures.
  return (
    cause.status === 408 ||
    cause.status === 425 ||
    cause.status === 429 ||
    cause.status >= 500
  );
}

function getReconnectDelay(retryCount: number) {
  return Math.min(
    RECONNECT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
    RECONNECT_RETRY_MAX_DELAY_MS,
  );
}

export function useViewerMedia(
  roomId: string,
  roomStatus: RoomStatus,
  isEnded: boolean,
): ViewerMediaState {
  const [state, setState] = useState<ViewerConnectionState>("waiting");
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (isEnded) {
      setStream(null);
      setState("disconnected");

      return;
    }

    if (roomStatus === "waiting") {
      setStream(null);
      setState("waiting");

      return;
    }

    let isDisposed = false;
    let activeConnection: SubscriberConnection | null = null;
    let connectionTimer: number | null = null;
    let retryTimer: number | null = null;
    let disconnectedGraceTimer: number | null = null;
    let pendingRequest: AbortController | null = null;
    let isConnecting = false;
    let isBackgroundRecovery = false;
    let attempt = 0;
    let reconnectRetryCount = 0;
    let publisherNotReadyRetryCount = 0;
    let currentStream: MediaStream | null = stream;

    function logFinalFailure(error?: unknown) {
      if (!import.meta.env.DEV) {
        return;
      }

      console.warn("[webrtc] viewer subscriber connection failed", {
        roomId,
        attempt,
        retries: reconnectRetryCount,
        stage:
          error instanceof WebRtcSignalingError
            ? error.diagnostic.stage
            : "connection-state",
        reason:
          error instanceof WebRtcSignalingError
            ? error.diagnostic.reason
            : error instanceof Error
              ? error.message
              : "Viewer connection could not be restored.",
      });
    }

    function enterDisconnected(error?: unknown) {
      if (isDisposed) {
        return;
      }

      isBackgroundRecovery = false;
      currentStream = null;
      setStream(null);
      setState("disconnected");
      logFinalFailure(error);
    }

    function scheduleBackgroundRecovery(error?: unknown) {
      if (isDisposed || retryTimer !== null) {
        return;
      }

      enterDisconnected(error);
      isBackgroundRecovery = true;

      if (import.meta.env.DEV) {
        console.info("[webrtc] viewer entered background recovery", {
          roomId,
          delayMs: BACKGROUND_RECOVERY_DELAY_MS,
        });
      }

      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect({ background: true });
      }, BACKGROUND_RECOVERY_DELAY_MS);
    }

    function scheduleRetry(error?: unknown) {
      if (isDisposed || retryTimer !== null) {
        return;
      }

      const publisherNotReady = isPublisherNotReady(error);

      if (publisherNotReady) {
        publisherNotReadyRetryCount += 1;

        if (
          publisherNotReadyRetryCount >
          MAX_PUBLISHER_NOT_READY_FAST_RETRIES
        ) {
          scheduleBackgroundRecovery(error);

          return;
        }
      } else {
        reconnectRetryCount += 1;

        if (reconnectRetryCount > MAX_RECONNECT_RETRIES) {
          scheduleBackgroundRecovery(error);

          return;
        }
      }

      const delay = publisherNotReady
        ? PUBLISHER_RETRY_DELAY_MS
        : getReconnectDelay(reconnectRetryCount);

      // Keep the existing MediaStream mounted during fast recovery so the
      // player can preserve the last visible frame under a Reconnecting overlay.
      setState("connecting");

      if (import.meta.env.DEV) {
        console.info("[webrtc] viewer subscribe will retry", {
          roomId,
          retry: publisherNotReady
            ? publisherNotReadyRetryCount
            : reconnectRetryCount,
          retryType: publisherNotReady
            ? "publisher-not-ready"
            : "connection",
          maxRetries: publisherNotReady
            ? MAX_PUBLISHER_NOT_READY_FAST_RETRIES
            : MAX_RECONNECT_RETRIES,
          delayMs: delay,
          preservingPreviousStream: currentStream !== null,
          reason: error instanceof Error ? error.message : undefined,
        });
      }

      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    }

    function connect(options?: { background?: boolean }) {
      if (isDisposed || isConnecting || activeConnection) {
        return;
      }

      const background = options?.background === true;

      isConnecting = true;
      isBackgroundRecovery = background;
      const currentAttempt = ++attempt;
      let connectionFailed = false;
      const requestController = new AbortController();

      pendingRequest = requestController;

      if (!background) {
        setState("connecting");
      }

      if (import.meta.env.DEV) {
        console.info("[webrtc] viewer subscriber connection starting", {
          roomId,
          attempt: currentAttempt,
          reconnectRetryCount,
          background,
        });
      }

      void createSubscriber(
        roomId,
        {
          onConnectionStateChange(connectionState) {
            if (
              isDisposed ||
              currentAttempt !== attempt ||
              connectionFailed
            ) {
              return;
            }

            function clearDisconnectedGraceTimer() {
              if (disconnectedGraceTimer === null) {
                return;
              }

              window.clearTimeout(disconnectedGraceTimer);
              disconnectedGraceTimer = null;
            }

            function failCurrentConnection() {
              if (
                isDisposed ||
                currentAttempt !== attempt ||
                connectionFailed
              ) {
                return;
              }

              clearDisconnectedGraceTimer();
              connectionFailed = true;
              isConnecting = false;

              if (pendingRequest === requestController) {
                pendingRequest = null;
                requestController.abort();
              }

              const connectionToClose = activeConnection;
              activeConnection = null;
              connectionToClose?.close();

              if (background) {
                scheduleBackgroundRecovery();
              } else {
                scheduleRetry();
              }
            }

            if (connectionState === "connected") {
              clearDisconnectedGraceTimer();

              return;
            }

            if (connectionState === "disconnected") {
              if (disconnectedGraceTimer !== null) {
                return;
              }

              if (import.meta.env.DEV) {
                console.info(
                  "[webrtc] viewer connection temporarily disconnected; waiting before reconnect",
                  {
                    roomId,
                    graceMs: DISCONNECTED_GRACE_PERIOD_MS,
                  },
                );
              }

              disconnectedGraceTimer = window.setTimeout(() => {
                disconnectedGraceTimer = null;
                failCurrentConnection();
              }, DISCONNECTED_GRACE_PERIOD_MS);

              return;
            }

            if (
              connectionState === "failed" ||
              connectionState === "closed"
            ) {
              failCurrentConnection();
            }
          },

          onTrack(remoteStream) {
            if (isDisposed || currentAttempt !== attempt || connectionFailed) {
              return;
            }

            if (remoteStream.getVideoTracks().length === 0) {
              return;
            }

            // A received video track is the point at which recovery is complete.
            reconnectRetryCount = 0;
            publisherNotReadyRetryCount = 0;
            isBackgroundRecovery = false;
            currentStream = remoteStream;
            setStream(remoteStream);
            setState("watching");
          },
        },
        requestController.signal,
      ).then(
        (connection) => {
          isConnecting = false;

          if (pendingRequest === requestController) {
            pendingRequest = null;
          }

          if (isDisposed || currentAttempt !== attempt || connectionFailed) {
            connection.close();

            return;
          }

          activeConnection = connection;
        },
        (error: unknown) => {
          isConnecting = false;

          if (pendingRequest === requestController) {
            pendingRequest = null;
          }

          if (isDisposed || currentAttempt !== attempt) {
            return;
          }

          if (isRetryableSubscriberError(error)) {
            if (background) {
              scheduleBackgroundRecovery(error);
            } else {
              scheduleRetry(error);
            }

            return;
          }

          enterDisconnected(error);
        },
      );
    }

    function handleOnline() {
      if (
        isDisposed ||
        !isBackgroundRecovery ||
        isConnecting ||
        activeConnection
      ) {
        return;
      }

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }

      reconnectRetryCount = 0;
      publisherNotReadyRetryCount = 0;
      isBackgroundRecovery = false;

      if (import.meta.env.DEV) {
        console.info("[webrtc] browser is online; retrying viewer connection now", {
          roomId,
        });
      }

      connect();
    }

    window.addEventListener("online", handleOnline);

    connectionTimer = window.setTimeout(() => {
      connectionTimer = null;
      connect();
    }, 0);

    return () => {
      isDisposed = true;
      attempt += 1;

      window.removeEventListener("online", handleOnline);
      pendingRequest?.abort();

      if (connectionTimer !== null) {
        window.clearTimeout(connectionTimer);
      }

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }

      if (disconnectedGraceTimer !== null) {
        window.clearTimeout(disconnectedGraceTimer);
      }

      activeConnection?.close();
    };
  }, [isEnded, roomId, roomStatus]);

  return { state, stream };
}
