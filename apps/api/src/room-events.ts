import type { RoomStatus } from "./room-store.js";

export type RoomRole = "host" | "viewer";

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

export type ServerRoomEvent =
  | RoomSnapshotEvent
  | RoomStatusEvent
  | RoomViewersEvent
  | RoomEndedEvent;

export function serializeRoomEvent(event: ServerRoomEvent) {
  return JSON.stringify(event);
}
