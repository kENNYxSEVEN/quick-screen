import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ViewerJoin } from "@/components/viewer/viewer-join";
import { useRoomRealtime } from "@/hooks/use-room-realtime";
import {
  ApiError,
  getApiErrorMessage,
  getRoom,
  getRoomRole,
  type Room as ApiRoom,
  type RoomRole,
} from "@/lib/api";
import { isValidRoomId } from "@/lib/generate-room-id";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { NotFound } from "@/pages/not-found";
import { Stream } from "@/pages/stream";
import { Viewer } from "@/pages/viewer";

type RoomLoadState =
  | { kind: "loading" }
  | { kind: "ready"; room: ApiRoom; role: RoomRole }
  | { kind: "missing" }
  | { kind: "error"; message: string };

interface ActiveRoomProps {
  room: ApiRoom;
  role: RoomRole;
}

function ActiveRoom({ room, role }: ActiveRoomProps) {
  return role === "host" ? <HostRoom room={room} /> : <ViewerRoom room={room} />;
}

function HostRoom({ room }: Pick<ActiveRoomProps, "room">) {
  const realtime = useRoomRealtime(room);

  return <Stream room={realtime.room} />;
}

function ViewerRoom({ room }: Pick<ActiveRoomProps, "room">) {
  const [hasJoined, setHasJoined] = useState(false);

  if (!hasJoined) {
    return <ViewerJoin roomId={room.id} onJoin={() => setHasJoined(true)} />;
  }

  return <JoinedViewerRoom room={room} />;
}

function JoinedViewerRoom({ room }: Pick<ActiveRoomProps, "room">) {
  const realtime = useRoomRealtime(room);

  return <Viewer room={realtime.room} isEnded={realtime.isEnded} />;
}

export function Room() {
  const { roomId: routeRoomId } = useParams();
  const roomId = routeRoomId ?? "";
  const hasValidRoomId = isValidRoomId(roomId);
  const [loadState, setLoadState] = useState<RoomLoadState>({ kind: "loading" });

  const loadRoom = useCallback(async () => {
    if (!hasValidRoomId) {
      return;
    }

    setLoadState({ kind: "loading" });

    try {
      const room = await getRoom(roomId);
      const role = await getRoomRole(roomId);

      setLoadState({ kind: "ready", room, role });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLoadState({ kind: "missing" });

        return;
      }

      setLoadState({
        kind: "error",
        message: getApiErrorMessage(error, "Unable to check this room. Please try again."),
      });
    }
  }, [hasValidRoomId, roomId]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  if (!hasValidRoomId || loadState.kind === "missing") {
    return (
      <NotFound
        title="Room not found"
        description="This room does not exist or may have already ended."
      />
    );
  }

  if (loadState.kind === "loading") {
    return (
      <DashboardLayout>
        <Card className="items-center gap-2 bg-white/[0.03] p-6 text-center ring-white/10">
          <p className="font-medium text-white">Checking room</p>
          <p className="text-sm text-zinc-500">Verifying the share link and access.</p>
        </Card>
      </DashboardLayout>
    );
  }

  if (loadState.kind === "error") {
    return (
      <DashboardLayout>
        <Card className="items-center gap-4 bg-white/[0.03] p-6 text-center ring-white/10">
          <div>
            <p className="font-medium text-white">Unable to load room</p>
            <p className="mt-1 text-sm text-red-300">{loadState.message}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadRoom()}>
            Try again
          </Button>
        </Card>
      </DashboardLayout>
    );
  }

  return <ActiveRoom room={loadState.room} role={loadState.role} />;
}
