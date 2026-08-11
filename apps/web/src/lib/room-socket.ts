import { apiOrigin, type RoomRole, type RoomStatus } from "@/lib/api";

export interface RoomSnapshotEvent {
  type: "room:snapshot";
  roomId: string;
  status: RoomStatus;
  streamPaused: boolean;
  viewers: number;
  role: RoomRole;
}

export interface RoomStatusEvent {
  type: "room:status";
  roomId: string;
  status: RoomStatus;
  streamPaused: boolean;
}

export interface RoomViewersEvent {
  type: "room:viewers";
  roomId: string;
  viewers: number;
}

export interface RoomEndedEvent {
  type: "room:ended";
  roomId: string;
}

export type RoomSocketEvent =
  | RoomSnapshotEvent
  | RoomStatusEvent
  | RoomViewersEvent
  | RoomEndedEvent;

interface RoomSocketHandlers {
  onEvent(event: RoomSocketEvent): void;
  onClose(): void;
}

export interface RoomSocketConnection {
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoomStatus(value: unknown): value is RoomStatus {
  return value === "waiting" || value === "live";
}

function isRoomRole(value: unknown): value is RoomRole {
  return value === "host" || value === "viewer";
}

function isViewerCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStreamPaused(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function parseRoomSocketEvent(data: unknown): RoomSocketEvent | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(data) as unknown;

    if (!isRecord(payload) || typeof payload.type !== "string" || typeof payload.roomId !== "string") {
      return null;
    }

    if (
      payload.type === "room:snapshot" &&
      isRoomStatus(payload.status) &&
      isStreamPaused(payload.streamPaused) &&
      isViewerCount(payload.viewers) &&
      isRoomRole(payload.role)
    ) {
      return {
        type: payload.type,
        roomId: payload.roomId,
        status: payload.status,
        streamPaused: payload.streamPaused,
        viewers: payload.viewers,
        role: payload.role,
      };
    }

    if (
      payload.type === "room:status" &&
      isRoomStatus(payload.status) &&
      isStreamPaused(payload.streamPaused)
    ) {
      return {
        type: payload.type,
        roomId: payload.roomId,
        status: payload.status,
        streamPaused: payload.streamPaused,
      };
    }

    if (payload.type === "room:viewers" && isViewerCount(payload.viewers)) {
      return { type: payload.type, roomId: payload.roomId, viewers: payload.viewers };
    }

    if (payload.type === "room:ended") {
      return { type: payload.type, roomId: payload.roomId };
    }
  } catch {
    return null;
  }

  return null;
}

function getRoomSocketUrl(roomId: string) {
  const url = new URL("/ws", apiOrigin);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("roomId", roomId);

  return url.toString();
}

export function connectRoomSocket(
  roomId: string,
  handlers: RoomSocketHandlers,
): RoomSocketConnection {
  const socket = new WebSocket(getRoomSocketUrl(roomId));
  let closeRequested = false;
  let hasOpened = false;

  socket.addEventListener("open", () => {
    hasOpened = true;

    if (closeRequested) {
      socket.close();
    }
  });
  socket.addEventListener("message", (message) => {
    const event = parseRoomSocketEvent(message.data);

    if (event) {
      handlers.onEvent(event);
    }
  });
  socket.addEventListener("close", handlers.onClose);

  return {
    close() {
      closeRequested = true;

      if (hasOpened && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    },
  };
}
