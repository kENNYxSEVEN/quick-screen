import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

import {
  hasHostAccess,
  hostCookieClearOptions,
  hostCookieName,
  hostCookieOptions,
} from "./room-auth.js";
import {
  MediaServiceError,
  type MediaClient,
  type MediaSessionDescription,
} from "./media-client.js";
import type { RoomConnectionManager } from "./room-connections.js";
import { isValidRoomId } from "./room-id.js";
import {
  isRoomStatus,
  RoomStore,
  toPublicRoom,
  type StoredRoom,
} from "./room-store.js";

const DEFAULT_WEB_ORIGIN = "http://localhost:5173";
const INVALID_ROOM_MESSAGE =
  "Room ID must contain 3 to 48 lowercase letters, numbers, or hyphens.";
const MEDIA_SIGNAL_BODY_LIMIT = "128kb";

export interface CreateAppOptions {
  mediaClient?: MediaClient;
  roomStore?: RoomStore;
  roomConnections?: RoomConnectionManager;
  webOrigin?: string;
}

interface ErrorResponse {
  error: string;
  message: string;
}

interface RoomRequestBody {
  id?: unknown;
}

interface UpdateRoomRequestBody {
  status?: unknown;
  streamPaused?: unknown;
}

interface MediaSignalRequestBody {
  offer?: unknown;
}

function sendError(
  response: Response<ErrorResponse>,
  status: number,
  error: string,
  message: string,
) {
  return response.status(status).json({ error, message });
}

function readRoomId(request: Request, response: Response<ErrorResponse>) {
  const roomId = request.params.roomId;

  if (typeof roomId !== "string" || !isValidRoomId(roomId)) {
    sendError(response, 400, "invalid_room", INVALID_ROOM_MESSAGE);

    return null;
  }

  return roomId;
}

function findRoom(
  request: Request,
  response: Response<ErrorResponse>,
  roomStore: RoomStore,
) {
  const roomId = readRoomId(request, response);

  if (!roomId) {
    return null;
  }

  const room = roomStore.find(roomId);

  if (!room) {
    sendError(response, 404, "room_not_found", "This room does not exist.");

    return null;
  }

  return room;
}

function requireHost(
  request: Request,
  response: Response<ErrorResponse>,
  roomStore: RoomStore,
  room: StoredRoom,
) {
  if (hasHostAccess(roomStore, room, request.headers.cookie)) {
    roomStore.touchHost(room);

    return true;
  }

  sendError(
    response,
    403,
    "host_required",
    "Only the room host can perform this action.",
  );

  return false;
}

function isOffer(value: unknown): value is MediaSessionDescription {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "sdp" in value &&
    value.type === "offer" &&
    typeof value.sdp === "string" &&
    value.sdp.length > 0
  );
}

function isHost(request: Request, roomStore: RoomStore, room: StoredRoom) {
  return hasHostAccess(roomStore, room, request.headers.cookie);
}

function isPayloadTooLargeError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}

export function createApp(options: CreateAppOptions = {}) {
  const mediaClient = options.mediaClient;
  const roomStore = options.roomStore ?? new RoomStore();
  const roomConnections = options.roomConnections;
  const webOrigin = options.webOrigin ?? process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN;
  const app = express();

  roomStore.setExpirationHandler((room) => {
    roomConnections?.endRoom(room.id);

    if (mediaClient) {
      void mediaClient.closeRoom(room.id).catch(() => undefined);
    }
  });

  app.use(
    cors({
      origin: webOrigin,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: MEDIA_SIGNAL_BODY_LIMIT }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/api/rooms", (request, response) => {
    const body = request.body as RoomRequestBody;

    if (typeof body?.id !== "string" || !isValidRoomId(body.id)) {
      return sendError(response, 400, "invalid_room", INVALID_ROOM_MESSAGE);
    }

    const room = roomStore.create(body.id);

    if (!room) {
      return sendError(response, 409, "room_exists", "This room name is already in use.");
    }

    response
      .cookie(hostCookieName(room.id), room.hostToken, hostCookieOptions())
      .status(201)
      .json({ room: toPublicRoom(room) });
  });

  app.get("/api/rooms/:roomId", (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room) {
      return;
    }

    response.json({ room: toPublicRoom(room) });
  });

  app.get("/api/rooms/:roomId/me", (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room) {
      return;
    }

    const role = hasHostAccess(roomStore, room, request.headers.cookie)
      ? "host"
      : "viewer";

    if (role === "host") {
      roomStore.touchHost(room);
      response.cookie(hostCookieName(room.id), room.hostToken, hostCookieOptions());
    }

    response.json({ role });
  });

  app.post("/api/rooms/:roomId/media/publish", async (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room || !requireHost(request, response, roomStore, room)) {
      return;
    }

    const body = request.body as MediaSignalRequestBody;

    if (!isOffer(body?.offer)) {
      return sendError(response, 400, "invalid_sdp", "A valid SDP offer is required.");
    }

    if (!mediaClient) {
      return sendError(response, 503, "media_unavailable", "Media service is unavailable.");
    }

    const answer = await mediaClient.publish(room.id, body.offer);

    response.json({ answer });
  });

  app.post("/api/rooms/:roomId/media/subscribe", async (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room) {
      return;
    }

    if (isHost(request, roomStore, room)) {
      return sendError(response, 403, "viewer_required", "Only viewers can subscribe to media.");
    }

    const body = request.body as MediaSignalRequestBody;

    if (!isOffer(body?.offer)) {
      return sendError(response, 400, "invalid_sdp", "A valid SDP offer is required.");
    }

    if (!mediaClient) {
      return sendError(response, 503, "media_unavailable", "Media service is unavailable.");
    }

    const answer = await mediaClient.subscribe(room.id, body.offer);

    response.json({ answer });
  });

  app.delete("/api/rooms/:roomId/media", async (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room || !requireHost(request, response, roomStore, room)) {
      return;
    }

    if (mediaClient) {
      await mediaClient.closeRoom(room.id);
    }

    response.status(204).send();
  });

  app.patch("/api/rooms/:roomId", (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room || !requireHost(request, response, roomStore, room)) {
      return;
    }

    const body = request.body as UpdateRoomRequestBody;

    const status = body?.status;
    const streamPaused = body?.streamPaused;

    if (status !== undefined && !isRoomStatus(status)) {
      return sendError(
        response,
        400,
        "invalid_status",
        "Room status must be waiting or live.",
      );
    }

    if (streamPaused !== undefined && typeof streamPaused !== "boolean") {
      return sendError(
        response,
        400,
        "invalid_stream_paused",
        "Stream paused must be true or false.",
      );
    }

    if (status === undefined && streamPaused === undefined) {
      return sendError(
        response,
        400,
        "invalid_room_update",
        "Provide a room status or stream paused value.",
      );
    }

    const nextStatus = status ?? room.status;
    const nextStreamPaused =
      nextStatus === "waiting" ? false : (streamPaused ?? room.streamPaused);

    if (nextStreamPaused && nextStatus !== "live") {
      return sendError(
        response,
        409,
        "invalid_pause_state",
        "Only a live room can pause its stream.",
      );
    }

    room.status = nextStatus;
    room.streamPaused = nextStreamPaused;
    roomConnections?.broadcastStatus(room);
    response.json({ room: toPublicRoom(room) });
  });

  app.delete("/api/rooms/:roomId", async (request, response) => {
    const room = findRoom(request, response, roomStore);

    if (!room || !requireHost(request, response, roomStore, room)) {
      return;
    }

    if (mediaClient) {
      try {
        await mediaClient.closeRoom(room.id);
      } catch {
        // Room authority must still be able to terminate an unavailable media session.
      }
    }

    roomConnections?.endRoom(room.id);
    roomStore.delete(room.id);
    response.clearCookie(hostCookieName(room.id), hostCookieClearOptions());
    response.status(204).send();
  });

  app.use((_request, response) => {
    sendError(response, 404, "not_found", "The requested endpoint does not exist.");
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response<ErrorResponse>,
      _next: NextFunction,
    ) => {
      if (error instanceof MediaServiceError) {
        sendError(response, error.status, error.code, error.message);

        return;
      }

      if (error instanceof SyntaxError) {
        sendError(response, 400, "invalid_json", "Request body must be valid JSON.");

        return;
      }

      if (isPayloadTooLargeError(error)) {
        sendError(
          response,
          413,
          "payload_too_large",
          "The media session description is too large.",
        );

        return;
      }

      sendError(response, 500, "internal_error", "Unexpected server error.");
    },
  );

  return app;
}
