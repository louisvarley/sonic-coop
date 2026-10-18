// Integration: a real server and two clients (the same netcode the browser uses) playing together.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { hasData, loadVfs, root } from "./helpers.js";
import { NetGame } from "../apps/client/src/net/netgame.js";
import { BTN, nullHost, type LobbyState, type StartInfo } from "../packages/engine/src/index.js";

process.env.DATA_DIR = `${root}/data`;
const { CoopRoom } = await import("../apps/server/src/room.js");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 20000): Promise<void> {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await wait(10);
  }
}

describe.skipIf(!hasData("sonic2"))("online co-op", () => {
  let server: Server;
  let endpoint = "";

  beforeAll(async () => {
    const httpServer = http.createServer();
    server = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
    server.define("coop", CoopRoom);
    await server.listen(0);
    endpoint = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it("two players create, join by code, ready up and play the same world", async () => {
    const a = new Client(endpoint), b = new Client(endpoint);
    const roomA: Room = await a.create("coop", { name: "Alice" });
    let lobbyA: LobbyState | null = null;
    roomA.onMessage("lobby", (l: LobbyState) => (lobbyA = l));
    await until(() => !!lobbyA);
    const code = lobbyA!.code;
    expect(code).toMatch(/^[A-Z]{4}$/);

    const roomB: Room = await b.joinById(code, { name: "Bob" });
    let lobbyB: LobbyState | null = null;
    roomB.onMessage("lobby", (l: LobbyState) => (lobbyB = l));
    await until(() => lobbyA?.players.length === 2 && !!lobbyB);

    // a third player is refused: the room is full
    await expect(new Client(endpoint).joinById(code, { name: "Eve" })).rejects.toThrow();
    // a wrong code is refused
    await expect(new Client(endpoint).joinById("ZZZZ", { name: "Eve" })).rejects.toThrow();

    roomA.send("lobby", { setGame: "sonic2" });
    roomA.send("lobby", { setCharacter: 0 });
    roomB.send("lobby", { setCharacter: 2 });
    let startA: StartInfo | null = null, startB: StartInfo | null = null;
    roomA.onMessage("start", (s: StartInfo) => (startA = s));
    roomB.onMessage("start", (s: StartInfo) => (startB = s));
    roomA.send("lobby", { ready: true });
    roomB.send("lobby", { ready: true });
    await until(() => lobbyA!.players.every((p) => p.ready));
    roomA.send("lobby", { start: true });
    await until(() => !!startA && !!startB);
    expect(startA!.slot).toBe(0);
    expect(startB!.slot).toBe(1);
    expect(startB!.characters).toEqual([0, 2]);

    const gameA = new NetGame(roomA, loadVfs("sonic2"), nullHost, startA!, { headless: true });
    const gameB = new NetGame(roomB, loadVfs("sonic2"), nullHost, startB!, { headless: true });
    roomA.onMessage("snap", (bytes: Uint8Array) => gameA.onSnapshot(bytes));
    roomB.onMessage("snap", (bytes: Uint8Array) => gameB.onSnapshot(bytes));
    roomA.onMessage("event", () => {});
    roomB.onMessage("event", () => {});
    roomA.send("loaded");
    roomB.send("loaded");
    await until(() => gameA.started && gameB.started);

    const tickBeforeBacklog = gameB.sim.E.tick;
    for (let f = 0; f < 60; f++) gameB.step(0);
    expect(gameB.sim.E.tick).toBe(tickBeforeBacklog + 60);

    // play: A runs right, B runs left then jumps; 60 frames per second of wall time
    for (let f = 0; f < 420; f++) {
      gameA.step(f > 140 ? BTN.RIGHT : 0);
      gameB.step(f > 140 && f < 300 ? BTN.LEFT : f % 40 === 0 ? BTN.C : 0);
      await wait(1000 / 60);
    }
    for (let f = 0; f < 60; f++) {
      gameA.step(0);
      gameB.step(0);
      await wait(1000 / 60);
    }
    await wait(300);

    const pa = gameA.sim.E.objectEntityList, pb = gameB.sim.E.objectEntityList;
    // both clients agree on where both players are (prediction converged to the server's world)
    expect(Math.abs((pa[0].xpos >> 16) - (pb[0].xpos >> 16))).toBeLessThan(8);
    expect(Math.abs((pa[1].xpos >> 16) - (pb[1].xpos >> 16))).toBeLessThan(8);
    // and the players went their separate ways
    expect(pa[0].xpos >> 16).toBeGreaterThan(400);
    expect(pa[1].xpos >> 16).toBeLessThan(120);
    // nothing was collected twice: the ring totals match on both clients
    expect(pa[0].values[0]).toBe(pb[0].values[0]);
    expect(pa[1].values[0]).toBe(pb[1].values[0]);
    expect(gameA.stats.snapshots).toBeGreaterThan(50);

    await roomB.leave();
    await roomA.leave();
  });

  it("a disconnected player can reconnect into the running game", async () => {
    const a = new Client(endpoint), b = new Client(endpoint);
    const roomA = await a.create("coop", { name: "Host" });
    let lobby: LobbyState | null = null;
    roomA.onMessage("lobby", (l: LobbyState) => (lobby = l));
    await until(() => !!lobby);
    const roomB = await b.joinById(lobby!.code, { name: "Guest" });
    let startB: StartInfo | null = null;
    roomB.onMessage("lobby", () => {});
    roomB.onMessage("start", (s: StartInfo) => (startB = s));
    roomA.onMessage("start", () => roomA.send("loaded"));
    roomA.onMessage("snap", () => {});
    roomA.onMessage("event", () => {});
    roomA.send("lobby", { setGame: "sonic1" });
    await until(() => lobby!.game === "sonic1" && lobby!.players.length === 2);
    roomA.send("lobby", { ready: true });
    roomB.send("lobby", { ready: true });
    await until(() => lobby!.players.length === 2 && lobby!.players.every((p) => p.ready));
    roomA.send("lobby", { start: true });
    await until(() => !!startB);
    roomB.onMessage("snap", () => {});
    roomB.onMessage("event", () => {});
    roomB.send("loaded");
    await until(() => lobby!.phase === "playing");

    const token = roomB.reconnectionToken;
    // drop the connection without leaving
    (roomB.connection as unknown as { close(code?: number): void }).close(4999);
    await until(() => lobby!.players.some((p) => !p.connected));

    const back = await new Client(endpoint).reconnect(token);
    let restarted: StartInfo | null = null;
    back.onMessage("start", (s: StartInfo) => (restarted = s));
    back.onMessage("lobby", () => {});
    back.onMessage("event", () => {});
    const game = { got: 0 };
    back.onMessage("snap", () => game.got++);
    await until(() => !!restarted);
    back.send("loaded");
    await until(() => game.got > 3);
    expect(restarted!.slot).toBe(1);
    await until(() => lobby!.players.every((p) => p.connected));
    await back.leave();
    await roomA.leave();
  });
});
