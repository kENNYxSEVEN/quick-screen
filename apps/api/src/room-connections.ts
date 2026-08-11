import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import { hasHostAccess } from "./room-auth.js";
import {
  serializeRoomEvent,
  type RoomRole,
  type ServerRoomEvent,
} from "./room-events.js";
import { isValidRoomId } from "./room-id.js";
import type { Room, RoomStore, StoredRoom } from "./room-store.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLICY_VIOLATION_CLOSE_CODE = 1008;

interface RoomConnection {
  socket: WebSocket;
  role: RoomRole;
  isAlive: boolean;
  isClosed: boolean;
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

export class RoomConnectionManager {
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private readonly connections = new Map<string, Set<RoomConnection>>();
  private server: Server | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly roomStore: RoomStore) {}

  attach(server: Server) {
    if (this.server) {
      throw new Error("RoomConnectionManager is already attached to a server.");
    }

    this.server = server;
    server.on("upgrade", this.handleUpgrade);
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.server?.off("upgrade", this.handleUpgrade);
    this.server = null;

    for (const roomConnections of this.connections.values()) {
      for (const connection of roomConnections) {
        connection.isClosed = true;
        connection.socket.terminate();
      }
    }

    this.connections.clear();
    this.webSocketServer.close();
  }

  broadcastStatus(room: Room) {
    this.broadcast(room.id, {
      type: "room:status",
      roomId: room.id,
      status: room.status,
      streamPaused: room.streamPaused,
    });
  }

  endRoom(roomId: string) {
    const roomConnections = this.connections.get(roomId);

    if (!roomConnections) {
      return;
    }

    for (const connection of roomConnections) {
      this.send(connection.socket, { type: "room:ended", roomId });
    }

    this.connections.delete(roomId);

    for (const connection of roomConnections) {
      connection.isClosed = true;
      connection.socket.close(1000, "Room ended");
    }
  }

  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    const requestUrl = this.getRequestUrl(request);

    if (
      request.method !== "GET" ||
      !requestUrl ||
      requestUrl.pathname !== "/ws" ||
      requestUrl.searchParams.getAll("roomId").length !== 1
    ) {
      rejectUpgrade(socket, 400, "Bad Request");

      return;
    }

    const roomId = requestUrl.searchParams.get("roomId");

    if (!roomId || !isValidRoomId(roomId)) {
      rejectUpgrade(socket, 400, "Bad Request");

      return;
    }

    const room = this.roomStore.find(roomId);

    if (!room) {
      rejectUpgrade(socket, 404, "Not Found");

      return;
    }

    const role: RoomRole = hasHostAccess(
      this.roomStore,
      room,
      request.headers.cookie,
    )
      ? "host"
      : "viewer";

    this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.addConnection(room, role, webSocket);
    });
  };

  private getRequestUrl(request: IncomingMessage) {
    try {
      return new URL(request.url ?? "", "http://localhost");
    } catch {
      return null;
    }
  }

  private addConnection(room: StoredRoom, role: RoomRole, socket: WebSocket) {
    const connection: RoomConnection = {
      socket,
      role,
      isAlive: true,
      isClosed: false,
    };
    const roomConnections = this.connections.get(room.id) ?? new Set<RoomConnection>();

    roomConnections.add(connection);
    this.connections.set(room.id, roomConnections);
    room.viewers = this.getViewerCount(roomConnections);

    if (role === "host") {
      this.roomStore.touchHost(room);
    }

    socket.on("pong", () => {
      connection.isAlive = true;

      if (role === "host") {
        this.roomStore.touchHost(room);
      }
    });
    socket.on("message", () => {
      socket.close(POLICY_VIOLATION_CLOSE_CODE, "Client messages are not supported.");
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      this.removeConnection(room.id, connection);
    });

    this.send(socket, {
      type: "room:snapshot",
      roomId: room.id,
      status: room.status,
      streamPaused: room.streamPaused,
      viewers: room.viewers,
      role,
    });

    if (role === "viewer") {
      this.broadcastViewers(room.id, room.viewers);
    }
  }

  private removeConnection(roomId: string, connection: RoomConnection) {
    if (connection.isClosed) {
      return;
    }

    connection.isClosed = true;
    const roomConnections = this.connections.get(roomId);

    if (!roomConnections || !roomConnections.delete(connection)) {
      return;
    }

    const room = this.roomStore.find(roomId);

    if (room) {
      if (connection.role === "host") {
        this.roomStore.touchHost(room);
      }

      room.viewers = this.getViewerCount(roomConnections);

      if (connection.role === "viewer") {
        this.broadcastViewers(roomId, room.viewers);
      }
    }

    if (roomConnections.size === 0) {
      this.connections.delete(roomId);
    }
  }

  private runHeartbeat() {
    for (const roomConnections of this.connections.values()) {
      for (const connection of roomConnections) {
        if (connection.socket.readyState !== WebSocket.OPEN) {
          connection.socket.terminate();

          continue;
        }

        if (!connection.isAlive) {
          connection.socket.terminate();

          continue;
        }

        connection.isAlive = false;
        connection.socket.ping();
      }
    }
  }

  private broadcastViewers(roomId: string, viewers: number) {
    this.broadcast(roomId, { type: "room:viewers", roomId, viewers });
  }

  private broadcast(roomId: string, event: ServerRoomEvent) {
    const roomConnections = this.connections.get(roomId);

    if (!roomConnections) {
      return;
    }

    for (const connection of roomConnections) {
      this.send(connection.socket, event);
    }
  }

  private send(socket: WebSocket, event: ServerRoomEvent) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serializeRoomEvent(event));
    }
  }

  private getViewerCount(roomConnections: Set<RoomConnection>) {
    let viewers = 0;

    for (const connection of roomConnections) {
      if (connection.role === "viewer" && !connection.isClosed) {
        viewers += 1;
      }
    }

    return viewers;
  }
}
