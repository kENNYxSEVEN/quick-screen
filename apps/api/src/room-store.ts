import { randomBytes, timingSafeEqual } from "node:crypto";

export const roomStatuses = ["waiting", "live"] as const;
export const DEFAULT_ROOM_INACTIVITY_TTL_MS = 24 * 60 * 60 * 1_000;

export type RoomStatus = (typeof roomStatuses)[number];

export interface Room {
  id: string;
  status: RoomStatus;
  streamPaused: boolean;
  viewers: number;
  createdAt: string;
}

export interface StoredRoom extends Room {
  hostToken: string;
  lastHostActivityAt: number;
}

export interface RoomStoreOptions {
  inactivityTtlMs?: number;
  now?: () => number;
}

type RoomExpirationHandler = (room: StoredRoom) => void;

function generateHostToken() {
  return randomBytes(32).toString("base64url");
}

export class RoomStore {
  private readonly rooms = new Map<string, StoredRoom>();
  private readonly inactivityTtlMs: number;
  private readonly now: () => number;
  private expirationHandler: RoomExpirationHandler | null = null;

  constructor(options: RoomStoreOptions = {}) {
    this.inactivityTtlMs =
      options.inactivityTtlMs ?? DEFAULT_ROOM_INACTIVITY_TTL_MS;
    this.now = options.now ?? Date.now;

    if (
      !Number.isFinite(this.inactivityTtlMs) ||
      this.inactivityTtlMs <= 0
    ) {
      throw new Error("Room inactivity TTL must be a positive number.");
    }
  }

  setExpirationHandler(handler: RoomExpirationHandler | null) {
    this.expirationHandler = handler;
  }

  create(id: string): StoredRoom | null {
    const existingRoom = this.rooms.get(id);

    if (existingRoom && !this.expireIfStale(existingRoom)) {
      return null;
    }

    const now = this.now();
    const room: StoredRoom = {
      id,
      status: "waiting",
      streamPaused: false,
      viewers: 0,
      createdAt: new Date(now).toISOString(),
      hostToken: generateHostToken(),
      lastHostActivityAt: now,
    };

    this.rooms.set(id, room);

    return room;
  }

  find(id: string) {
    const room = this.rooms.get(id);

    if (!room || this.expireIfStale(room)) {
      return undefined;
    }

    return room;
  }

  delete(id: string) {
    return this.rooms.delete(id);
  }

  touchHost(room: StoredRoom) {
    if (this.rooms.get(room.id) !== room) {
      return false;
    }

    room.lastHostActivityAt = this.now();

    return true;
  }

  pruneExpired() {
    const expiredRoomIds: string[] = [];

    for (const room of this.rooms.values()) {
      if (this.expireIfStale(room)) {
        expiredRoomIds.push(room.id);
      }
    }

    return expiredRoomIds;
  }

  isHost(room: StoredRoom, hostToken: string | undefined) {
    if (!hostToken) {
      return false;
    }

    const expectedToken = Buffer.from(room.hostToken);
    const receivedToken = Buffer.from(hostToken);

    return (
      expectedToken.length === receivedToken.length &&
      timingSafeEqual(expectedToken, receivedToken)
    );
  }

  private expireIfStale(room: StoredRoom) {
    if (this.now() - room.lastHostActivityAt < this.inactivityTtlMs) {
      return false;
    }

    if (this.rooms.get(room.id) !== room) {
      return true;
    }

    this.rooms.delete(room.id);
    this.expirationHandler?.(room);

    return true;
  }
}

export function toPublicRoom(room: Room): Room {
  return {
    id: room.id,
    status: room.status,
    streamPaused: room.streamPaused,
    viewers: room.viewers,
    createdAt: room.createdAt,
  };
}

export function isRoomStatus(value: unknown): value is RoomStatus {
  return typeof value === "string" && roomStatuses.some((status) => status === value);
}
