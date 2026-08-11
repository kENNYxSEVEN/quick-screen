import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createApp } from "./app.js";
import {
  MediaServiceError,
  type MediaClient,
  type MediaSessionDescription,
} from "./media-client.js";
import { RoomStore } from "./room-store.js";

const offer: MediaSessionDescription = {
  type: "offer",
  sdp: "v=0\r\no=browser 1 1 IN IP4 127.0.0.1\r\n",
};
const answer: MediaSessionDescription = {
  type: "answer",
  sdp: "v=0\r\no=media 1 1 IN IP4 127.0.0.1\r\n",
};

class FakeMediaClient implements MediaClient {
  readonly published: Array<{ roomId: string; offer: MediaSessionDescription }> = [];
  readonly subscribed: Array<{ roomId: string; offer: MediaSessionDescription }> = [];
  readonly closedRoomIds: string[] = [];

  async publish(roomId: string, mediaOffer: MediaSessionDescription) {
    this.published.push({ roomId, offer: mediaOffer });

    return answer;
  }

  async subscribe(roomId: string, mediaOffer: MediaSessionDescription) {
    this.subscribed.push({ roomId, offer: mediaOffer });

    return answer;
  }

  async closeRoom(roomId: string) {
    this.closedRoomIds.push(roomId);
  }
}

class PublisherNotReadyMediaClient extends FakeMediaClient {
  override async subscribe(
    _roomId: string,
    _mediaOffer: MediaSessionDescription,
  ): Promise<MediaSessionDescription> {
    throw new MediaServiceError(
      "publisher video track is unavailable",
      409,
      "publisher_not_ready",
    );
  }
}

interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

async function createTestServer(mediaClient: MediaClient): Promise<TestServer> {
  const app = createApp({
    mediaClient,
    roomStore: new RoomStore(),
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

async function createRoom(testServer: TestServer) {
  const response = await testServer.request("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "kenny" }),
  });
  const setCookie = response.headers.get("set-cookie");

  assert.equal(response.status, 201);
  assert.ok(setCookie);

  const hostCookie = setCookie.split(";", 1)[0];
  assert.ok(hostCookie);

  return hostCookie;
}

test("media signaling keeps publish host-only and proxies typed SDP answers", async () => {
  const mediaClient = new FakeMediaClient();
  const testServer = await createTestServer(mediaClient);

  try {
    const hostCookie = await createRoom(testServer);
    const viewerPublish = await testServer.request("/api/rooms/kenny/media/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer }),
    });
    assert.equal(viewerPublish.status, 403);

    const hostPublish = await testServer.request("/api/rooms/kenny/media/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ offer }),
    });
    assert.equal(hostPublish.status, 200);
    assert.deepEqual(await hostPublish.json(), { answer });
    assert.deepEqual(mediaClient.published, [{ roomId: "kenny", offer }]);

    const invalidOffer = await testServer.request("/api/rooms/kenny/media/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ offer: { type: "answer", sdp: "invalid" } }),
    });
    assert.equal(invalidOffer.status, 400);
  } finally {
    await testServer.close();
  }
});

test("viewer subscribe and room cleanup remain under API room authority", async () => {
  const mediaClient = new FakeMediaClient();
  const testServer = await createTestServer(mediaClient);

  try {
    const hostCookie = await createRoom(testServer);
    const hostSubscribe = await testServer.request("/api/rooms/kenny/media/subscribe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: hostCookie,
      },
      body: JSON.stringify({ offer }),
    });
    assert.equal(hostSubscribe.status, 403);

    const viewerSubscribe = await testServer.request("/api/rooms/kenny/media/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer }),
    });
    assert.equal(viewerSubscribe.status, 200);
    assert.deepEqual(await viewerSubscribe.json(), { answer });
    assert.deepEqual(mediaClient.subscribed, [{ roomId: "kenny", offer }]);

    const mediaCleanup = await testServer.request("/api/rooms/kenny/media", {
      method: "DELETE",
      headers: { cookie: hostCookie },
    });
    assert.equal(mediaCleanup.status, 204);
    assert.deepEqual(mediaClient.closedRoomIds, ["kenny"]);

    const roomDelete = await testServer.request("/api/rooms/kenny", {
      method: "DELETE",
      headers: { cookie: hostCookie },
    });
    assert.equal(roomDelete.status, 204);
    assert.deepEqual(mediaClient.closedRoomIds, ["kenny", "kenny"]);
  } finally {
    await testServer.close();
  }
});

test("publisher readiness is exposed to viewers as a retryable conflict", async () => {
  const mediaClient = new PublisherNotReadyMediaClient();
  const testServer = await createTestServer(mediaClient);

  try {
    await createRoom(testServer);
    const response = await testServer.request("/api/rooms/kenny/media/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "publisher_not_ready",
      message: "publisher video track is unavailable",
    });
  } finally {
    await testServer.close();
  }
});

test("viewer media subscribe accepts an SDP body with video and audio sections", async () => {
  const mediaClient = new FakeMediaClient();
  const testServer = await createTestServer(mediaClient);
  const audioCapableOffer: MediaSessionDescription = {
    type: "offer",
    sdp: `v=0\r\n${"a=x-test:audio-video\r\n".repeat(500)}`,
  };

  try {
    await createRoom(testServer);
    const response = await testServer.request("/api/rooms/kenny/media/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer: audioCapableOffer }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer });
    assert.deepEqual(mediaClient.subscribed, [{ roomId: "kenny", offer: audioCapableOffer }]);
  } finally {
    await testServer.close();
  }
});
