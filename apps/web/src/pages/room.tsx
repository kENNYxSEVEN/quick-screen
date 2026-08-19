import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
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
  const [endedRoomId, setEndedRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (realtime.isEnded) {
      setEndedRoomId(room.id);
    }
  }, [realtime.isEnded, room.id]);

  const isSessionEnded =
    realtime.isEnded || endedRoomId === room.id;

  return (
    <Viewer
      room={realtime.room}
      isEnded={isSessionEnded}
    />
  );
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
      <DashboardLayout showGrid>
        <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center py-8">
          <div className="w-full max-w-[360px] sm:-translate-y-5">
            <div className="rounded-xl border border-white/[0.07] bg-[#121212] px-7 py-6 text-center">
              <span className="mx-auto flex size-9 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.025] text-zinc-400">
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              </span>

              <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                Checking room
              </p>

              <h1 className="mt-1.5 text-[1.375rem] font-semibold leading-none tracking-[-0.025em] text-zinc-50">
                Verifying link
              </h1>

              <p className="mx-auto mt-3 max-w-[270px] text-xs leading-5 text-zinc-400">
                Checking the room and your access.
              </p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (loadState.kind === "error") {
    return (
      <DashboardLayout showGrid>
        <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center py-8">
          <div className="w-full max-w-[360px] sm:-translate-y-5">
            <div className="rounded-xl border border-white/[0.07] bg-[#121212] px-7 py-6">
              <div className="text-center">
                <span className="mx-auto flex size-9 items-center justify-center rounded-lg border border-red-400/10 bg-red-400/[0.035] text-red-300/75">
                  <AlertCircle className="size-4" aria-hidden="true" />
                </span>

                <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Connection error
                </p>

                <h1 className="mt-1.5 text-[1.375rem] font-semibold leading-none tracking-[-0.025em] text-zinc-50">
                  Unable to load room
                </h1>

                <p className="mx-auto mt-3 max-w-[280px] text-xs leading-5 text-zinc-400">
                  {loadState.message}
                </p>
              </div>

              <div className="mx-auto mt-5 w-full max-w-[280px]">
                <Button
                  type="button"
                  size="lg"
                  onClick={() => void loadRoom()}
                  className="h-11 w-full rounded-lg bg-zinc-100 px-4 text-zinc-950 hover:bg-white"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return <ActiveRoom room={loadState.room} role={loadState.role} />;
}