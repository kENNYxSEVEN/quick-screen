import { useEffect, useRef, useState } from "react";

import type { Room } from "@/lib/api";
import { connectRoomSocket, type RoomSocketConnection } from "@/lib/room-socket";

const RECONNECT_DELAY_MS = 1_000;

interface RoomRealtimeState {
  room: Room;
  isEnded: boolean;
}

export function useRoomRealtime(initialRoom: Room): RoomRealtimeState {
  const [room, setRoom] = useState<Room>(initialRoom);
  const [isEnded, setIsEnded] = useState(false);
  const endedRef = useRef(false);

  useEffect(() => {
    let isDisposed = false;
    let initialConnectTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let activeConnection: RoomSocketConnection | null = null;

    endedRef.current = false;
    setRoom(initialRoom);
    setIsEnded(false);

    function scheduleReconnect() {
      if (isDisposed || endedRef.current || reconnectTimer !== null) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    }

    function connect() {
      if (isDisposed || endedRef.current) {
        return;
      }

      try {
        const connection = connectRoomSocket(initialRoom.id, {
          onEvent(event) {
            if (isDisposed || event.roomId !== initialRoom.id) {
              return;
            }

            if (event.type === "room:snapshot") {
              setRoom((currentRoom) => ({
                ...currentRoom,
                status: event.status,
                streamPaused: event.streamPaused,
                viewers: event.viewers,
              }));

              return;
            }

            if (event.type === "room:status") {
              setRoom((currentRoom) => ({
                ...currentRoom,
                status: event.status,
                streamPaused: event.streamPaused,
              }));

              return;
            }

            if (event.type === "room:viewers") {
              setRoom((currentRoom) => ({ ...currentRoom, viewers: event.viewers }));

              return;
            }

            endedRef.current = true;
            setIsEnded(true);
          },
          onClose() {
            if (activeConnection === connection) {
              activeConnection = null;
            }

            scheduleReconnect();
          },
        });

        activeConnection = connection;
      } catch {
        scheduleReconnect();
      }
    }

    initialConnectTimer = window.setTimeout(() => {
      initialConnectTimer = null;
      connect();
    }, 0);

    return () => {
      isDisposed = true;

      if (initialConnectTimer !== null) {
        window.clearTimeout(initialConnectTimer);
      }

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      activeConnection?.close();
    };
  }, [initialRoom]);

  return { room, isEnded };
}
