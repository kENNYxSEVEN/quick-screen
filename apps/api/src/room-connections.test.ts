import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import WebSocket from "ws";

import { createApp } from "./app.js";
import { RoomConnectionManager } from "./room-connections.js";
import type { ServerRoomEvent } from "./room-events.js";
import { RoomStore } from "./room-store.js";

interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  socketUrl(path: string): string;
  close(): Promise<void>;
}

interface SocketClient {
  socket: WebSocket;
  events: ServerRoomEvent[];
  waitFor(
    predicate: (event: ServerRoomEvent) => boolean,
    startIndex?: number,
  ): Promise<ServerRoomEvent>;
}

function parseEvent(data: WebSocket.RawData): ServerRoomEvent | null {
  if (typeof data !== "string" && !Buffer.isBuffer(data)) {
    return null;
  }

  try {
    return JSON.parse(data.toString()) as ServerRoomEvent;
  } catch {
    return null;
  }
}

function createSocketClient(socket: WebSocket): SocketClient {
  const events: ServerRoomEvent[] = [];
  const subscribers = new Set<(event: ServerRoomEvent) => void>();

  socket.on("message", (data) => {
    const event = parseEvent(data);

    if (!event) {
      return;
    }

    events.push(event);

    for (const subscriber of subscribers) {
      subscriber(event);
    }
  });

  socket.on("error", () => undefined);

  return {
    socket,
    events,
    waitFor(predicate, startIndex = 0) {
      const existingEvent = events.slice(startIndex).find(predicate);

      if (existingEvent) {
        return Promise.resolve(existingEvent);
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscribers.delete(onEvent);
          reject(new Error("Timed out waiting for a room event."));
        }, 2_000);

        function onEvent(event: ServerRoomEvent) {
          if (!predicate(event)) {
            return;
          }

          clearTimeout(timeout);
          subscribers.delete(onEvent);
          resolve(event);
        }

        subscribers.add(onEvent);
      });
    },
  };
}

async function connectSocket(url: string, hostCookie?: string) {
  const socket = new WebSocket(
    url,
    hostCookie ? { headers: { cookie: hostCookie } } : undefined,
  );
  const client = createSocketClient(socket);

  await once(socket, "open");
  const snapshot = await client.waitFor((event) => event.type === "room:snapshot");

  return { client, snapshot };
}

async function closeSocket(client: SocketClient | null) {
  if (!client || client.socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closed = once(client.socket, "close");
  client.socket.close();
  await closed;
}

async function createTestServer(roomStore = new RoomStore()): Promise<TestServer> {
  const roomConnections = new RoomConnectionManager(roomStore);
  const app = createApp({
    roomStore,
    roomConnections,
    webOrigin: "http://localhost:5173",
  });
  const server = createServer(app);

  roomConnections.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    request(path, init = {}) {
      return fetch(`${baseUrl}${path}`, init);
    },
    socketUrl(path) {
      return `ws://127.0.0.1:${address.port}${path}`;
    },
    async close() {
      roomConnections.close();
      await closeServer(server);
    },
  };
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

async function createRoom(testServer: TestServer, id: string) {
  const response = await testServer.request("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const setCookie = response.headers.get("set-cookie");

  assert.equal(response.status, 201);
  assert.ok(setCookie);

  const hostCookie = setCookie.split(";", 1)[0];
  assert.ok(hostCookie);

  return hostCookie;
}

async function getViewerCount(testServer: TestServer, roomId: string) {
  const response = await testServer.request(`/api/rooms/${roomId}`);
  const payload = (await response.json()) as { room: { viewers: number } };

  assert.equal(response.status, 200);

  return payload.room.viewers;
}

test("viewer connections update the room count while host connections do not", async () => {
  const testServer = await createTestServer();
  let host: SocketClient | null = null;
  let viewer: SocketClient | null = null;

  try {
    const hostCookie = await createRoom(testServer, "kenny");
    const hostConnection = await connectSocket(testServer.socketUrl("/ws?roomId=kenny"), hostCookie);
    host = hostConnection.client;

    assert.deepEqual(hostConnection.snapshot, {
      type: "room:snapshot",
      roomId: "kenny",
      status: "waiting",
      streamPaused: false,
      viewers: 0,
      role: "host",
    });
    assert.equal(await getViewerCount(testServer, "kenny"), 0);

    const hostViewerUpdate = host.waitFor(
      (event) => event.type === "room:viewers" && event.viewers === 1,
      host.events.length,
    );
    const viewerConnection = await connectSocket(testServer.socketUrl("/ws?roomId=kenny"));
    viewer = viewerConnection.client;

    assert.deepEqual(viewerConnection.snapshot, {
      type: "room:snapshot",
      roomId: "kenny",
      status: "waiting",
      streamPaused: false,
      viewers: 1,
      role: "viewer",
    });
    await hostViewerUpdate;
    assert.equal(await getViewerCount(testServer, "kenny"), 1);

    const hostViewerDisconnect = host.waitFor(
      (event) => event.type === "room:viewers" && event.viewers === 0,
      host.events.length,
    );
    await closeSocket(viewer);
    viewer = null;
    await hostViewerDisconnect;
    assert.equal(await getViewerCount(testServer, "kenny"), 0);
  } finally {
    await closeSocket(viewer);
    await closeSocket(host);
    await testServer.close();
  }
});

test("status changes broadcast to every room connection", async () => {
  const testServer = await createTestServer();
  let host: SocketClient | null = null;
  let viewer: SocketClient | null = null;

  try {
    const hostCookie = await createRoom(testServer, "kenny");
    host = (await connectSocket(testServer.socketUrl("/ws?roomId=kenny"), hostCookie)).client;
    viewer = (await connectSocket(testServer.socketUrl("/ws?roomId=kenny"))).client;

    const hostStatusEvent = host.waitFor(
      (event) => event.type === "room:status" && event.status === "live",
      host.events.length,
    );
    const viewerStatusEvent = viewer.waitFor(
      (event) => event.type === "room:status" && event.status === "live",
      viewer.events.length,
    );
    const response = await testServer.request("/api/rooms/kenny", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ status: "live" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await hostStatusEvent, {
      type: "room:status",
      roomId: "kenny",
      status: "live",
      streamPaused: false,
    });
    assert.deepEqual(await viewerStatusEvent, {
      type: "room:status",
      roomId: "kenny",
      status: "live",
      streamPaused: false,
    });

    const hostPausedEvent = host.waitFor(
      (event) => event.type === "room:status" && event.streamPaused,
      host.events.length,
    );
    const viewerPausedEvent = viewer.waitFor(
      (event) => event.type === "room:status" && event.streamPaused,
      viewer.events.length,
    );
    const pauseResponse = await testServer.request("/api/rooms/kenny", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ streamPaused: true }),
    });

    assert.equal(pauseResponse.status, 200);
    assert.deepEqual(await hostPausedEvent, {
      type: "room:status",
      roomId: "kenny",
      status: "live",
      streamPaused: true,
    });
    assert.deepEqual(await viewerPausedEvent, {
      type: "room:status",
      roomId: "kenny",
      status: "live",
      streamPaused: true,
    });
  } finally {
    await closeSocket(viewer);
    await closeSocket(host);
    await testServer.close();
  }
});

test("room deletion broadcasts ended and closes all room connections", async () => {
  const testServer = await createTestServer();
  let host: SocketClient | null = null;
  let viewer: SocketClient | null = null;

  try {
    const hostCookie = await createRoom(testServer, "kenny");
    host = (await connectSocket(testServer.socketUrl("/ws?roomId=kenny"), hostCookie)).client;
    viewer = (await connectSocket(testServer.socketUrl("/ws?roomId=kenny"))).client;

    const hostEnded = host.waitFor(
      (event) => event.type === "room:ended",
      host.events.length,
    );
    const viewerEnded = viewer.waitFor(
      (event) => event.type === "room:ended",
      viewer.events.length,
    );
    const hostClosed = once(host.socket, "close");
    const viewerClosed = once(viewer.socket, "close");
    const response = await testServer.request("/api/rooms/kenny", {
      method: "DELETE",
      headers: { cookie: hostCookie },
    });

    assert.equal(response.status, 204);
    assert.deepEqual(await hostEnded, { type: "room:ended", roomId: "kenny" });
    assert.deepEqual(await viewerEnded, { type: "room:ended", roomId: "kenny" });
    await hostClosed;
    await viewerClosed;

    const lookup = await testServer.request("/api/rooms/kenny");
    assert.equal(lookup.status, 404);
  } finally {
    await closeSocket(viewer);
    await closeSocket(host);
    await testServer.close();
  }
});

test("WebSocket rejects connections for nonexistent rooms", async () => {
  const testServer = await createTestServer();

  try {
    const statusCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(testServer.socketUrl("/ws?roomId=missing"));

      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        socket.terminate();
        resolve(response.statusCode ?? 0);
      });
      socket.once("error", reject);
    });

    assert.equal(statusCode, 404);
  } finally {
    await testServer.close();
  }
});

test("host WebSocket connection refreshes room inactivity", async () => {
  let now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const roomStore = new RoomStore({
    inactivityTtlMs: 1_000,
    now: () => now,
  });
  const testServer = await createTestServer(roomStore);
  let host: SocketClient | null = null;

  try {
    const hostCookie = await createRoom(testServer, "kenny");

    now += 900;
    host = (await connectSocket(testServer.socketUrl("/ws?roomId=kenny"), hostCookie)).client;

    now += 900;

    const lookup = await testServer.request("/api/rooms/kenny");
    assert.equal(lookup.status, 200);
  } finally {
    await closeSocket(host);
    await testServer.close();
  }
});

