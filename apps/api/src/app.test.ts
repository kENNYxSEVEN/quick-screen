import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createApp } from "./app.js";
import { RoomStore } from "./room-store.js";

interface PublicRoom {
  id: string;
  status: "waiting" | "live";
  streamPaused: boolean;
  viewers: number;
  createdAt: string;
}

interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

async function createTestServer(roomStore = new RoomStore()): Promise<TestServer> {
  const app = createApp({
    roomStore,
    webOrigin: "http://localhost:5173",
  });
  const server = app.listen(0, "127.0.0.1");

  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    request(path, init = {}) {
      return fetch(`${baseUrl}${path}`, init);
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);

            return;
          }

          resolve();
        });
      });
    },
  };
}

async function createRoom(testServer: TestServer, id: string) {
  const response = await testServer.request("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const setCookie = response.headers.get("set-cookie");

  assert.ok(setCookie, "Creating a room must set a host cookie.");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=2592000/);

  return {
    response,
    hostCookie: setCookie.split(";", 1)[0],
  };
}

test("health endpoint reports availability", async () => {
  const testServer = await createTestServer();

  try {
    const response = await testServer.request("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    await testServer.close();
  }
});

test("room creation validates IDs, rejects duplicates, and supports lookup", async () => {
  const testServer = await createTestServer();

  try {
    const invalidResponse = await testServer.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "Invalid Room" }),
    });

    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), {
      error: "invalid_room",
      message: "Room ID must contain 3 to 48 lowercase letters, numbers, or hyphens.",
    });

    const { response: createResponse } = await createRoom(testServer, "kenny");
    const createBody = (await createResponse.json()) as { room: PublicRoom };

    assert.equal(createResponse.status, 201);
    assert.equal(createBody.room.id, "kenny");
    assert.equal(createBody.room.status, "waiting");
    assert.equal(createBody.room.streamPaused, false);
    assert.equal(createBody.room.viewers, 0);
    assert.ok(Date.parse(createBody.room.createdAt));
    assert.equal("hostToken" in createBody.room, false);

    const duplicateResponse = await testServer.request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "kenny" }),
    });

    assert.equal(duplicateResponse.status, 409);

    const lookupResponse = await testServer.request("/api/rooms/kenny");

    assert.equal(lookupResponse.status, 200);
    assert.deepEqual(await lookupResponse.json(), { room: createBody.room });

    const missingResponse = await testServer.request("/api/rooms/missing");
    assert.equal(missingResponse.status, 404);
  } finally {
    await testServer.close();
  }
});

test("host ownership protects updates and deletion, then permits room reuse", async () => {
  const testServer = await createTestServer();

  try {
    const { hostCookie } = await createRoom(testServer, "kenny");

    const viewerRole = await testServer.request("/api/rooms/kenny/me");
    assert.deepEqual(await viewerRole.json(), { role: "viewer" });

    const hostRole = await testServer.request("/api/rooms/kenny/me", {
      headers: { cookie: hostCookie },
    });
    assert.deepEqual(await hostRole.json(), { role: "host" });
    assert.match(hostRole.headers.get("set-cookie") ?? "", /Max-Age=2592000/);

    const viewerPatch = await testServer.request("/api/rooms/kenny", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "live" }),
    });
    assert.equal(viewerPatch.status, 403);

    const hostPatch = await testServer.request("/api/rooms/kenny", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ status: "live" }),
    });
    const hostPatchBody = (await hostPatch.json()) as { room: PublicRoom };

    assert.equal(hostPatch.status, 200);
    assert.equal(hostPatchBody.room.id, "kenny");
    assert.equal(hostPatchBody.room.status, "live");
    assert.equal(hostPatchBody.room.streamPaused, false);
    assert.equal(hostPatchBody.room.viewers, 0);

    const hostPause = await testServer.request("/api/rooms/kenny", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ streamPaused: true }),
    });
    const hostPauseBody = (await hostPause.json()) as { room: PublicRoom };

    assert.equal(hostPause.status, 200);
    assert.equal(hostPauseBody.room.streamPaused, true);

    const viewerResume = await testServer.request("/api/rooms/kenny", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streamPaused: false }),
    });
    assert.equal(viewerResume.status, 403);

    const viewerDelete = await testServer.request("/api/rooms/kenny", {
      method: "DELETE",
    });
    assert.equal(viewerDelete.status, 403);

    const hostDelete = await testServer.request("/api/rooms/kenny", {
      method: "DELETE",
      headers: { cookie: hostCookie },
    });
    assert.equal(hostDelete.status, 204);

    const missingResponse = await testServer.request("/api/rooms/kenny");
    assert.equal(missingResponse.status, 404);

    const reusedRoom = await createRoom(testServer, "kenny");
    assert.equal(reusedRoom.response.status, 201);
  } finally {
    await testServer.close();
  }
});

test("host activity refreshes room inactivity TTL and stale rooms become reusable", async () => {
  let now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const roomStore = new RoomStore({
    inactivityTtlMs: 1_000,
    now: () => now,
  });
  const testServer = await createTestServer(roomStore);

  try {
    const { hostCookie } = await createRoom(testServer, "kenny");

    now += 900;

    const hostRole = await testServer.request("/api/rooms/kenny/me", {
      headers: { cookie: hostCookie },
    });
    assert.equal(hostRole.status, 200);
    assert.deepEqual(await hostRole.json(), { role: "host" });

    now += 900;

    const stillActive = await testServer.request("/api/rooms/kenny");
    assert.equal(stillActive.status, 200);

    now += 101;

    const expired = await testServer.request("/api/rooms/kenny");
    assert.equal(expired.status, 404);

    const reusedRoom = await createRoom(testServer, "kenny");
    assert.equal(reusedRoom.response.status, 201);
  } finally {
    await testServer.close();
  }
});

