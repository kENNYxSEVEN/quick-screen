import "dotenv/config";
import { createServer } from "node:http";

import { createApp } from "./app.js";
import { HttpMediaClient } from "./media-client.js";
import { RoomConnectionManager } from "./room-connections.js";
import { RoomStore } from "./room-store.js";

function readPort(value: string | undefined) {
  if (!value) {
    return 3001;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

const ROOM_EXPIRY_SWEEP_INTERVAL_MS = 60_000;

const port = readPort(process.env.PORT);
const roomStore = new RoomStore();
const roomConnections = new RoomConnectionManager(roomStore);
const mediaClient = new HttpMediaClient();
const app = createApp({ roomStore, roomConnections, mediaClient });
const server = createServer(app);
const roomExpiryTimer = setInterval(() => {
  roomStore.pruneExpired();
}, ROOM_EXPIRY_SWEEP_INTERVAL_MS);

roomExpiryTimer.unref();
server.on("close", () => {
  clearInterval(roomExpiryTimer);
});

roomConnections.attach(server);
server.listen(port);
