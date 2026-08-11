import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardInfo } from "@/components/dashboard/dashboard-info";
import { DashboardPreview } from "@/components/dashboard/dashboard-preview";
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
  const [isPausePending, setIsPausePending] = useState(false);
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
    stopSharing,
  } = useScreen();
  const duration = useSessionDuration(startedAt);
  const roomUrl = `${window.location.origin}/${room.id}`;

  useEffect(() => {
    if (stream || room.status !== "live") {
      return;
    }

    closePublisher();
    void deleteRoomMedia(room.id).catch(() => undefined);
    void updateRoomStatus(room.id, "waiting").catch(() => undefined);
  }, [closePublisher, room.id, room.status, stream]);

  const handleSystemStop = useCallback((endedRoomId: string) => {
    closePublisher();
    void deleteRoomMedia(endedRoomId).catch(() => undefined);
    void updateRoomStatus(endedRoomId, "waiting").catch(() => undefined);
  }, [closePublisher]);

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
      closePublisher();
      stopSharing();
      await deleteRoomMedia(room.id).catch(() => undefined);
      void updateRoomStatus(room.id, "waiting").catch(() => undefined);
      setRoomError(
        getApiErrorMessage(error, "Unable to publish the screen. Please try again."),
      );
    }
  }, [closePublisher, handleSystemStop, publish, room.id, startSharing, stopSharing]);

  const handleChangeSource = useCallback(async () => {
    setRoomError(null);
    const nextStream = await changeSource();

    if (!nextStream) {
      return;
    }

    try {
      await replacePublisherTrack(nextStream);
    } catch {
      try {
        await publish(room.id, nextStream);
      } catch (error) {
        closePublisher();
        stopSharing();
        await deleteRoomMedia(room.id).catch(() => undefined);
        void updateRoomStatus(room.id, "waiting").catch(() => undefined);
        setRoomError(
          getApiErrorMessage(error, "Unable to change the shared screen. Please try again."),
        );
      }
    }
  }, [changeSource, closePublisher, publish, replacePublisherTrack, room.id, stopSharing]);

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
    setIsEndingRoom(true);
    stopSharing();
    closePublisher();

    try {
      await deleteRoomMedia(room.id).catch(() => undefined);
      await deleteRoom(room.id);
      navigate("/");
    } catch (error) {
      void updateRoomStatus(room.id, "waiting").catch(() => undefined);
      setRoomError(
        getApiErrorMessage(error, "Unable to end the room. Please try again."),
      );
      setIsEndingRoom(false);
    }
  }

  return (
    <DashboardLayout>
      <Card className="gap-3 bg-white/[0.03] p-3 ring-white/10 sm:p-3.5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
          <DashboardHeader
            duration={duration}
            isSharing={stream !== null}
            isPaused={stream !== null && room.streamPaused}
          />
          <DashboardInfo roomUrl={roomUrl} viewerCount={room.viewers} />
        </div>

        <DashboardActions
          isSharing={stream !== null}
          isRequestingScreen={isRequestingScreen || isPublishing}
          isEndingRoom={isEndingRoom}
          isPaused={stream !== null && room.streamPaused}
          isPausePending={isPausePending}
          onStartSharing={() => void handleStartSharing()}
          onChangeSource={() => void handleChangeSource()}
          onTogglePause={() => void handleTogglePause()}
          onStopSharing={() => void handleStopSharing()}
        />
      </Card>

      <DashboardPreview
        stream={stream}
        errorMessage={shareError ?? roomError}
        isLive={room.status === "live"}
      />
    </DashboardLayout>
  );
}
