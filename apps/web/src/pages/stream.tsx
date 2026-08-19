import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardInfo } from "@/components/dashboard/dashboard-info";
import { DashboardPreview } from "@/components/dashboard/dashboard-preview";
import { FloatingAlertStack } from "@/components/floating-alert-stack";
import { Card } from "@/components/ui/card";
import { useMedia } from "@/hooks/use-media";
import { useScreen } from "@/hooks/use-screen";
import { useSessionDuration } from "@/hooks/use-session-duration";
import {
  deleteRoom,
  deleteRoomMedia,
  getApiErrorMessage,
  updateRoomStreamPaused,
  updateRoomStatus,
  type Room,
} from "@/lib/api";
import { DashboardLayout } from "@/layouts/dashboard-layout";

interface StreamProps {
  room: Room;
}

export function Stream({ room }: StreamProps) {
  const navigate = useNavigate();
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isEndingRoom, setIsEndingRoom] = useState(false);
  const [isStoppingSharing, setIsStoppingSharing] = useState(false);
  const [isChangingSource, setIsChangingSource] = useState(false);
  const [isPausePending, setIsPausePending] = useState(false);
  const isEndingRoomRef = useRef(false);
  const waitingTransitionInFlightRef = useRef(false);
  const waitingTransitionConfirmedRef = useRef(false);
  const {
    closePublisher,
    isPublishing,
    publish,
    replacePublisherTrack,
    setPublisherPaused,
  } = useMedia();
  const {
    stream,
    isRequestingScreen,
    startedAt,
    shareError,
    startSharing,
    changeSource,
    commitSource,
    discardSource,
    stopSharing,
  } = useScreen();
  const duration = useSessionDuration(startedAt);
  const roomUrl = `${window.location.origin}/${room.id}`;
  const displayError = shareError ?? roomError;

  const transitionRoomToWaiting = useCallback(
    async (roomIdToUpdate: string) => {
      if (
        waitingTransitionInFlightRef.current ||
        waitingTransitionConfirmedRef.current
      ) {
        return;
      }

      waitingTransitionInFlightRef.current = true;
      closePublisher();

      try {
        // Media cleanup is best-effort. The authoritative room status still
        // needs to move to waiting even if the media service is unavailable.
        await deleteRoomMedia(roomIdToUpdate).catch(() => undefined);
        await updateRoomStatus(roomIdToUpdate, "waiting");
        waitingTransitionConfirmedRef.current = true;
      } finally {
        waitingTransitionInFlightRef.current = false;
      }
    },
    [closePublisher],
  );

  useEffect(() => {
    if (stream) {
      // A new live capture starts a fresh live -> waiting lifecycle.
      waitingTransitionConfirmedRef.current = false;

      return;
    }

    if (
      room.status !== "live" ||
      isEndingRoomRef.current ||
      waitingTransitionInFlightRef.current ||
      waitingTransitionConfirmedRef.current
    ) {
      return;
    }

    void transitionRoomToWaiting(room.id).catch(() => undefined);
  }, [room.id, room.status, stream, transitionRoomToWaiting]);

  const handleSystemStop = useCallback(
    (endedRoomId: string) => {
      void transitionRoomToWaiting(endedRoomId).catch(() => undefined);
    },
    [transitionRoomToWaiting],
  );

  const handleStartSharing = useCallback(async () => {
    setRoomError(null);

    const sharedStream = await startSharing({
      roomId: room.id,
      onEnded: handleSystemStop,
    });

    if (!sharedStream) {
      return;
    }

    try {
      await publish(room.id, sharedStream);

      if (sharedStream.getVideoTracks()[0]?.readyState !== "live") {
        throw new Error("Screen sharing ended before publishing completed.");
      }

      await updateRoomStatus(room.id, "live");
    } catch (error) {
      stopSharing();
      await transitionRoomToWaiting(room.id).catch(() => undefined);
      setRoomError(
        getApiErrorMessage(error, "Unable to publish the screen. Please try again."),
      );
    }
  }, [
    handleSystemStop,
    publish,
    room.id,
    startSharing,
    stopSharing,
    transitionRoomToWaiting,
  ]);

  const handleChangeSource = useCallback(async () => {
    if (!stream) {
      return;
    }

    setRoomError(null);
    setIsChangingSource(true);

    const previousStream = stream;
    const nextStream = await changeSource();

    if (!nextStream) {
      setIsChangingSource(false);

      return;
    }

    const restorePreviousPublisher = async () => {
      await publish(room.id, previousStream);

      // A full republish creates fresh RTP senders, so restore the room's
      // current paused state as well.
      if (room.streamPaused) {
        await setPublisherPaused(true);
      }
    };

    try {
      if (nextStream.getVideoTracks()[0]?.readyState !== "live") {
        discardSource(nextStream);
        setRoomError(
          "The selected source ended before switching completed. Your previous source is still live.",
        );

        return;
      }

      try {
        // Fast path: same media topology. Viewers stay on the existing
        // publisher connection and only sender tracks are replaced.
        await replacePublisherTrack(nextStream);
      } catch {
        // Track topology changed (commonly audio present <-> absent), or the
        // sender replacement failed. A full publisher renegotiation is needed.
        try {
          await publish(room.id, nextStream);

          if (room.streamPaused) {
            await setPublisherPaused(true);
          }
        } catch (switchError) {
          // Media publish may already have replaced/closed the previous SFU
          // publisher. Because the old screen capture is still alive, try to
          // restore it before telling the host that sharing has stopped.
          try {
            await restorePreviousPublisher();
            discardSource(nextStream);
            setRoomError(
              getApiErrorMessage(
                switchError,
                "Unable to change the shared screen. Your previous source was restored.",
              ),
            );

            return;
          } catch (restoreError) {
            if (import.meta.env.DEV) {
              console.warn("[webrtc] previous publisher could not be restored", restoreError);
            }

            discardSource(nextStream);
            stopSharing();
            await transitionRoomToWaiting(room.id).catch(() => undefined);
            setRoomError(
              getApiErrorMessage(
                switchError,
                "Unable to change the shared screen. Screen sharing was stopped.",
              ),
            );

            return;
          }
        }
      }

      // The media layer is now using nextStream. Only now swap the Screen
      // context and stop the previous browser capture.
      try {
        commitSource(nextStream);
      } catch (commitError) {
        // Extremely small race: the new capture ended after media switching
        // but before ScreenProvider committed it. Restore the still-live old
        // capture/publisher if possible.
        discardSource(nextStream);

        try {
          await restorePreviousPublisher();
          setRoomError(
            getApiErrorMessage(
              commitError,
              "The new source ended before switching completed. Your previous source was restored.",
            ),
          );
        } catch (restoreError) {
          if (import.meta.env.DEV) {
            console.warn("[webrtc] previous publisher could not be restored", restoreError);
          }

          stopSharing();
          await transitionRoomToWaiting(room.id).catch(() => undefined);
          setRoomError(
            "The new source ended before switching completed. Screen sharing was stopped.",
          );
        }
      }
    } finally {
      setIsChangingSource(false);
    }
  }, [
    changeSource,
    commitSource,
    discardSource,
    publish,
    replacePublisherTrack,
    room.id,
    room.streamPaused,
    setPublisherPaused,
    stopSharing,
    stream,
    transitionRoomToWaiting,
  ]);

  const handleTogglePause = useCallback(async () => {
    const nextPaused = !room.streamPaused;

    setRoomError(null);
    setIsPausePending(true);

    try {
      await setPublisherPaused(nextPaused);

      try {
        await updateRoomStreamPaused(room.id, nextPaused);
      } catch (error) {
        await setPublisherPaused(!nextPaused).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      setRoomError(
        getApiErrorMessage(error, "Unable to update the stream pause state. Please try again."),
      );
    } finally {
      setIsPausePending(false);
    }
  }, [room.id, room.streamPaused, setPublisherPaused]);

  async function handleStopSharing() {
    setRoomError(null);
    setIsStoppingSharing(true);
    stopSharing();

    try {
      await transitionRoomToWaiting(room.id);
    } catch (error) {
      setRoomError(
        getApiErrorMessage(
          error,
          "Screen sharing stopped, but the room could not be moved to waiting.",
        ),
      );
    } finally {
      setIsStoppingSharing(false);
    }
  }

  async function handleEndRoom() {
    setRoomError(null);
    isEndingRoomRef.current = true;
    setIsEndingRoom(true);

    // End is terminal. Stop local capture/publisher first, then let the API
    // close the media room and broadcast room:ended as one authoritative action.
    stopSharing();
    closePublisher();

    try {
      await deleteRoom(room.id);
      navigate("/");
    } catch (error) {
      isEndingRoomRef.current = false;
      setIsEndingRoom(false);
      setRoomError(
        getApiErrorMessage(error, "Unable to end the room. Please try again."),
      );
    }
  }

  return (
    <DashboardLayout showGrid>
      <FloatingAlertStack
        alerts={
          displayError
            ? [
                {
                  id: shareError ? "screen-share-error" : "host-action-error",
                  description: displayError,
                  variant: "error",
                },
              ]
            : []
        }
      />
      <Card className="gap-2.5 rounded-xl bg-[#121212] p-2.5 shadow-[0_16px_50px_rgba(0,0,0,0.18)] ring-white/[0.08] sm:p-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <DashboardHeader
            duration={duration}
            isSharing={stream !== null}
            isPaused={stream !== null && room.streamPaused}
          />
          <DashboardInfo roomUrl={roomUrl} viewerCount={room.viewers} />
        </div>

        <DashboardActions
          isSharing={stream !== null}
          isRequestingScreen={isRequestingScreen}
          isPublishing={isPublishing}
          isChangingSource={isChangingSource}
          isEndingRoom={isEndingRoom}
          isStoppingSharing={isStoppingSharing}
          isPaused={stream !== null && room.streamPaused}
          isPausePending={isPausePending}
          onStartSharing={() => void handleStartSharing()}
          onChangeSource={() => void handleChangeSource()}
          onTogglePause={() => void handleTogglePause()}
          onStopSharing={() => void handleStopSharing()}
          onEndRoom={() => void handleEndRoom()}
        />
      </Card>

      <DashboardPreview
        stream={stream}
        isLive={room.status === "live"}
        isSelectingScreen={isRequestingScreen || isPublishing}
        onSelectScreen={() => void handleStartSharing()}
      />
    </DashboardLayout>
  );
}
