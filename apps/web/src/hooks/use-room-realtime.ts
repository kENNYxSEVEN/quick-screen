import { useEffect, useRef, useState } from "react";

import { ApiError, getRoom, type Room } from "@/lib/api";
import { connectRoomSocket, type RoomSocketConnection } from "@/lib/room-socket";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

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
    let reconnectTimer: number | null = null;
    let activeConnection: RoomSocketConnection | null = null;
    let reconnectAttempt = 0;
    let recoveryInFlight = false;

    const sessionCreatedAt = initialRoom.createdAt;

    endedRef.current = false;
    setRoom(initialRoom);
    setIsEnded(false);

    function clearReconnectTimer() {
      if (reconnectTimer === null) {
        return;
      }

      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    function markEnded(reason: "room_missing" | "session_replaced" | "room_ended") {
      if (isDisposed || endedRef.current) {
        return;
      }

      endedRef.current = true;
      clearReconnectTimer();
      setIsEnded(true);

      if (import.meta.env.DEV) {
        console.info("[room] realtime session ended", {
          roomId: initialRoom.id,
          sessionCreatedAt,
          reason,
        });
      }
    }

    function resetReconnectBackoff() {
      reconnectAttempt = 0;
    }

    function scheduleRecovery() {
      if (
        isDisposed ||
        endedRef.current ||
        reconnectTimer !== null ||
        activeConnection !== null ||
        recoveryInFlight
      ) {
        return;
      }

      const delay =
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
        ];

      reconnectAttempt += 1;

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void validateSessionAndConnect();
      }, delay);
    }

    function connect() {
      if (isDisposed || endedRef.current || activeConnection !== null) {
        return;
      }

      try {
        const connection = connectRoomSocket(initialRoom.id, {
          onEvent(event) {
            if (
              isDisposed ||
              endedRef.current ||
              event.roomId !== initialRoom.id
            ) {
              return;
            }

            // Receiving any valid event proves that the socket is healthy again.
            resetReconnectBackoff();

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
              setRoom((currentRoom) => ({
                ...currentRoom,
                viewers: event.viewers,
              }));

              return;
            }

            if (event.type === "room:ended") {
              markEnded("room_ended");
            }
          },
          onClose() {
            if (activeConnection === connection) {
              activeConnection = null;
            }

            scheduleRecovery();
          },
        });

        activeConnection = connection;
      } catch {
        scheduleRecovery();
      }
    }

    async function validateSessionAndConnect() {
      if (
        isDisposed ||
        endedRef.current ||
        activeConnection !== null ||
        recoveryInFlight
      ) {
        return;
      }

      recoveryInFlight = true;

      try {
        const currentRoom = await getRoom(initialRoom.id);

        if (isDisposed || endedRef.current) {
          return;
        }

        if (currentRoom.createdAt !== sessionCreatedAt) {
          markEnded("session_replaced");

          return;
        }

        // Refresh any room state that may have changed while realtime was offline.
        setRoom(currentRoom);
        connect();
      } catch (error) {
        if (isDisposed || endedRef.current) {
          return;
        }

        if (error instanceof ApiError && error.status === 404) {
          markEnded("room_missing");

          return;
        }

        // A temporary network/API error does not mean the room ended.
        scheduleRecovery();
      } finally {
        recoveryInFlight = false;

        // scheduleRecovery() called from the catch while recoveryInFlight was
        // true is intentionally ignored, so schedule it once more after the
        // request has fully settled.
        if (
          !isDisposed &&
          !endedRef.current &&
          activeConnection === null &&
          reconnectTimer === null
        ) {
          scheduleRecovery();
        }
      }
    }

    function handleOnline() {
      if (
        isDisposed ||
        endedRef.current ||
        activeConnection !== null ||
        recoveryInFlight
      ) {
        return;
      }

      clearReconnectTimer();
      void validateSessionAndConnect();
    }

    window.addEventListener("online", handleOnline);

    // Validate session identity even for the first socket connection. This
    // closes the race where the room was ended/recreated between the page's
    // initial GET (or Join click) and opening the realtime socket.
    void validateSessionAndConnect();

    return () => {
      isDisposed = true;
      clearReconnectTimer();
      window.removeEventListener("online", handleOnline);
      activeConnection?.close();
      activeConnection = null;
    };
  }, [initialRoom]);

  return { room, isEnded };
}