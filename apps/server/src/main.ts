// Sonic Coop game server: HTTP (health, stats) and the Colyseus WebSocket endpoint on one port.

import http from "node:http";
import express from "express";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CoopRoom } from "./room.js";
import { availableGames, DATA_DIR } from "./gamedata.js";
import { log } from "./log.js";
import { stats } from "./stats.js";
import { Sonic3ExperimentRoom } from "./sonic3-room.js";

const PORT = Number(process.env.PORT ?? 2567);
const VERSION = process.env.APP_VERSION ?? "dev";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health", (_req, res) => {
  const games = availableGames();
  res.status(games.length ? 200 : 503).json({
    ok: games.length > 0,
    version: VERSION,
    games,
    rooms: stats.rooms,
    uptime: Math.round((Date.now() - stats.startedAt) / 1000),
  });
});

app.get("/stats", (_req, res) => {
  res.json({ ...stats, tickMs: Number(stats.tickMs.toFixed(3)), version: VERSION });
});

// Joining by code: the room code is the Colyseus room id; this tells the browser whether it exists and has space.
app.get("/rooms/:code", async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const rooms = await matchMaker.query({ roomId: code });
  if (!rooms.length) return void res.status(404).json({ error: "No room with that code" });
  const r = rooms[0];
  res.json({ code, clients: r.clients, maxClients: r.maxClients, locked: r.locked });
});

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server, pingInterval: 5000, pingMaxRetries: 3 }) });
gameServer.define("coop", CoopRoom);
if (process.env.ENABLE_SONIC3_EXPERIMENT === "1") gameServer.define("sonic3-experiment", Sonic3ExperimentRoom);

gameServer.listen(PORT).then(() => {
  log("server", `Sonic Coop server ${VERSION} listening on :${PORT} (data: ${DATA_DIR}, games: ${availableGames().join(", ") || "none"})`);
});

// Colyseus handles SIGINT/SIGTERM itself: rooms are disposed and the process exits cleanly.
