import { useEffect, useState } from "react";

import { ApiError, type RoomStatus } from "@/lib/api";
import {
  WebRtcSignalingError,
  createSubscriber,
  type SubscriberConnection,
} from "@/lib/webrtc";
import type { ViewerConnectionState } from "@/types/viewer";

const SUBSCRIBE_RETRY_DELAY_MS = 1_000;

interface ViewerMediaState {
  state: ViewerConnectionState;
  stream: MediaStream | null;
}

function isPublisherNotReady(error: unknown) {
  const cause = error instanceof WebRtcSignalingError ? error.cause : error;

  return (
    cause instanceof ApiError &&
    cause.status === 409 &&
    cause.code === "publisher_not_ready"
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
    let pendingRequest: AbortController | null = null;
    let isConnecting = false;
    let attempt = 0;

    function scheduleRetry(error?: unknown) {
      if (isDisposed || retryTimer !== null) {
        return;
      }

      if (import.meta.env.DEV) {
        console.info("[webrtc] viewer subscribe will retry", {
          roomId,
          reason: error instanceof Error ? error.message : undefined,
        });
      }

      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, SUBSCRIBE_RETRY_DELAY_MS);
    }

    function connect() {
      if (isDisposed || isConnecting || activeConnection) {
        return;
      }

      isConnecting = true;
      const currentAttempt = ++attempt;
      let connectionFailed = false;
      const requestController = new AbortController();
      pendingRequest = requestController;
      setStream(null);
      setState("connecting");

      if (import.meta.env.DEV) {
        console.info("[webrtc] viewer subscriber connection starting", {
          roomId,
          attempt: currentAttempt,
        });
      }

      void createSubscriber(roomId, {
        onConnectionStateChange(connectionState) {
          if (
            isDisposed ||
            currentAttempt !== attempt ||
            (connectionState !== "failed" &&
              connectionState !== "disconnected" &&
              connectionState !== "closed")
          ) {
            return;
          }

          connectionFailed = true;
          activeConnection?.close();
          activeConnection = null;
          scheduleRetry();
        },
        onTrack(remoteStream) {
          if (isDisposed || currentAttempt !== attempt || connectionFailed) {
            return;
          }

          if (remoteStream.getVideoTracks().length === 0) {
            return;
          }

          setStream(remoteStream);
          setState("watching");
        },
      }, requestController.signal).then(
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

          if (currentAttempt === attempt && isPublisherNotReady(error)) {
            scheduleRetry(error);

            return;
          }

          if (currentAttempt === attempt) {
            setStream(null);
            setState("disconnected");

            if (import.meta.env.DEV) {
              console.warn("[webrtc] viewer subscriber connection failed", {
                stage: error instanceof WebRtcSignalingError
                  ? error.diagnostic.stage
                  : "unknown",
                reason: error instanceof WebRtcSignalingError
                  ? error.diagnostic.reason
                  : error instanceof Error
                    ? error.message
                    : "Unknown WebRTC error.",
              });
            }
          }
        },
      );
    }

    connectionTimer = window.setTimeout(() => {
      connectionTimer = null;
      connect();
    }, 0);

    return () => {
      isDisposed = true;
      attempt++;

      pendingRequest?.abort();

      if (connectionTimer !== null) {
        window.clearTimeout(connectionTimer);
      }

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }

      activeConnection?.close();
    };
  }, [isEnded, roomId, roomStatus]);

  return { state, stream };
}
