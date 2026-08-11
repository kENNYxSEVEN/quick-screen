import { parse as parseCookie } from "cookie";

import type { RoomStore, StoredRoom } from "./room-store.js";

const HOST_COOKIE_PREFIX = "ingamers-screen-host-";
const HOST_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export function hostCookieName(roomId: string) {
  return `${HOST_COOKIE_PREFIX}${roomId}`;
}

function hostCookieBaseOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function hostCookieOptions() {
  return {
    ...hostCookieBaseOptions(),
    maxAge: HOST_COOKIE_MAX_AGE_MS,
  };
}

export function hostCookieClearOptions() {
  return hostCookieBaseOptions();
}

export function hasHostAccess(
  roomStore: RoomStore,
  room: StoredRoom,
  cookieHeader: string | undefined,
) {
  const cookies = parseCookie(cookieHeader ?? "");

  return roomStore.isHost(room, cookies[hostCookieName(room.id)]);
}
