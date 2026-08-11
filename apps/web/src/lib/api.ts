const configuredApiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
const defaultApiOrigin = import.meta.env.DEV
  ? "http://localhost:3001"
  : window.location.origin;

export const apiOrigin = (configuredApiOrigin || defaultApiOrigin).replace(/\/$/, "");

export type RoomStatus = "waiting" | "live";
export type RoomRole = "host" | "viewer";

export interface Room {
  id: string;
  status: RoomStatus;
  streamPaused: boolean;
  viewers: number;
  createdAt: string;
}

export interface MediaSessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

interface SubscribeRoomMediaOptions {
  signal?: AbortSignal;
  onResponse?(status: number): void;
}

interface ApiErrorPayload {
  error: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    "message" in value &&
    typeof value.error === "string" &&
    typeof value.message === "string"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  onResponse?: (status: number) => void,
): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    credentials: "include",
  });

  onResponse?.(response.status);

  if (!response.ok) {
    const payload = await readJson(response);

    if (isApiErrorPayload(payload)) {
      throw new ApiError(response.status, payload.error, payload.message);
    }

    throw new ApiError(response.status, "request_failed", "The request could not be completed.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

export async function createRoom(id: string) {
  const payload = await request<{ room: Room }>("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });

  return payload.room;
}

export async function getRoom(id: string) {
  const payload = await request<{ room: Room }>(`/api/rooms/${encodeURIComponent(id)}`);

  return payload.room;
}

export async function getRoomRole(id: string) {
  const payload = await request<{ role: RoomRole }>(`/api/rooms/${encodeURIComponent(id)}/me`);

  return payload.role;
}

export async function updateRoomStatus(id: string, status: RoomStatus) {
  const payload = await request<{ room: Room }>(`/api/rooms/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });

  return payload.room;
}

export async function updateRoomStreamPaused(id: string, streamPaused: boolean) {
  const payload = await request<{ room: Room }>(`/api/rooms/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streamPaused }),
  });

  return payload.room;
}

export function deleteRoom(id: string) {
  return request<void>(`/api/rooms/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function publishRoomMedia(id: string, offer: MediaSessionDescription) {
  const payload = await request<{ answer: MediaSessionDescription }>(
    `/api/rooms/${encodeURIComponent(id)}/media/publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer }),
    },
  );

  return payload.answer;
}

export async function subscribeRoomMedia(
  id: string,
  offer: MediaSessionDescription,
  options: SubscribeRoomMediaOptions = {},
) {
  const { signal, onResponse } = options;
  const payload = await request<{ answer: MediaSessionDescription }>(
    `/api/rooms/${encodeURIComponent(id)}/media/subscribe`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer }),
      signal,
    },
    onResponse,
  );

  return payload.answer;
}

export function deleteRoomMedia(id: string) {
  return request<void>(`/api/rooms/${encodeURIComponent(id)}/media`, {
    method: "DELETE",
  });
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
