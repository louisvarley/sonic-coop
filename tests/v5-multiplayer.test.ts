import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { BTN } from "../packages/engine/src/input.js";
import { encodeInput } from "../packages/engine/src/net/protocol.js";
import type { V5OnlineSnapshot } from "../packages/engine/src/v5/net.js";
import { readV5Level } from "../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../packages/engine/src/v5/collision.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { V5Gameplay } from "../packages/engine/src/v5/gameplay.js";

const data = fileURLToPath(new URL("../data", import.meta.url));
process.env.DATA_DIR = data;
const { Sonic3ExperimentRoom } = await import("../apps/server/src/sonic3-room.js");
const pack = fileURLToPath(new URL("../data/sonic3/experimental.pak", import.meta.url));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, timeout = 10000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for experimental room state");
    await wait(10);
  }
}

describe.skipIf(!fs.existsSync(pack))("experimental Sonic 3 online world", () => {
  let server: Server, endpoint: string, hash: string;
  beforeAll(async () => {
    const httpServer = http.createServer();
    server = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
    server.define("sonic3-experiment", Sonic3ExperimentRoom);
    await server.listen(0);
    endpoint = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    hash = createHash("md5").update(fs.readFileSync(pack)).digest("hex");
  });
  afterAll(async () => { await server.gracefullyShutdown(false); });

  it("shares one authoritative world, isolates controls, rejects guests controlling the host, and restores a freed slot", async () => {
    const rooms: Room[] = [];
    try {
      const a = await new Client(endpoint).create("sonic3-experiment", { levelHash: hash }); rooms.push(a);
      let worldA: V5OnlineSnapshot | null = null, worldB: V5OnlineSnapshot | null = null, notice = "";
      a.onMessage("welcome", () => {}); a.onMessage("world", (state: V5OnlineSnapshot) => { worldA = state; });
      a.onMessage("notice", () => {});
      await until(() => worldA !== null);
      const b = await new Client(endpoint).joinById(a.roomId, { levelHash: hash }); rooms.push(b);
      b.onMessage("welcome", () => {}); b.onMessage("world", (state: V5OnlineSnapshot) => { worldB = state; });
      b.onMessage("notice", (message: string) => { notice = message; });
      await until(() => worldA?.players.length === 2 && worldB !== null);
      await expect(new Client(endpoint).joinById(a.roomId, { levelHash: hash })).rejects.toThrow();
      b.send("run", true);
      await until(() => notice.includes("Only the host"));
      expect(worldA!.playing).toBe(false);
      a.send("run", true);
      await until(() => (worldA?.state.movement.frame ?? 0) > 60);
      let sequence = 0;
      const firstStart = worldA!.state.movement.players[0].x, secondStart = worldA!.state.movement.players[1].x;
      for (let i = 0; i < 75; i++) {
        a.sendBytes("in", encodeInput(++sequence, BTN.RIGHT));
        b.sendBytes("in", encodeInput(i + 1, 0));
        await wait(1000 / 60);
      }
      a.sendBytes("in", encodeInput(++sequence, 0));
      a.send("run", false);
      await until(() => !worldA?.playing && !worldB?.playing && worldA?.state.movement.frame === worldB?.state.movement.frame);
      expect(worldA!.state).toEqual(worldB!.state);
      expect(worldA!.acknowledged).toEqual(worldB!.acknowledged);
      expect(worldA!.acknowledged[0]).toBeGreaterThan(50);
      expect(worldA!.acknowledged[0]).toBeLessThanOrEqual(sequence);
      expect(worldA!.state.movement.players[0].x).toBeGreaterThan(firstStart + 100 * 65536);
      expect(worldA!.state.movement.players[1].x).toBe(secondStart);
      const level = readV5Level(fs.readFileSync(pack));
      const mirror = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
        level.collisionLayers, level.spawns), level.objects, level.deathY);
      mirror.restore(worldA!.state);
      expect(mirror.capture()).toEqual(worldA!.state);
      await b.leave(); rooms.splice(rooms.indexOf(b), 1);
      await until(() => worldA?.players.length === 1);
      await expect(new Client(endpoint).joinById(a.roomId, { levelHash: "wrong" })).rejects.toThrow("assets do not match");
      const c = await new Client(endpoint).joinById(a.roomId, { levelHash: hash }); rooms.push(c);
      let slot = -1, worldC: V5OnlineSnapshot | null = null;
      c.onMessage("welcome", (message: { slot: number }) => { slot = message.slot; });
      c.onMessage("world", (state: V5OnlineSnapshot) => { worldC = state; }); c.onMessage("notice", () => {});
      await until(() => slot === 1);
      a.send("restart");
      await until(() => worldA?.state.movement.frame === 0);
      expect(worldA!.state.players.map((p) => p.rings)).toEqual([0, 0]);
      await a.leave(); rooms.splice(rooms.indexOf(a), 1);
      await until(() => worldC?.players.length === 1 && worldC.owner === c.sessionId);
      const d = await new Client(endpoint).joinById(c.roomId, { levelHash: hash }); rooms.push(d);
      let returningSlot = -1;
      d.onMessage("welcome", (message: { slot: number }) => { returningSlot = message.slot; });
      d.onMessage("world", () => {}); d.onMessage("notice", () => {});
      await until(() => returningSlot === 0);
      c.send("run", true);
      await until(() => worldC?.playing === true && worldC.state.movement.frame > 0);
      c.send("restart");
      await until(() => worldC?.playing === false && worldC.state.movement.frame === 0);
    } finally {
      await Promise.all(rooms.map((room) => room.leave()));
    }
  }, 15000);

  it("drops malformed input clients explicitly and releases held controls after input timeout", async () => {
    const a = await new Client(endpoint).create("sonic3-experiment", { levelHash: hash });
    try {
      let world: V5OnlineSnapshot | null = null, left = false;
      a.onMessage("welcome", () => {}); a.onMessage("world", (state: V5OnlineSnapshot) => { world = state; });
      a.onMessage("notice", () => {});
      a.onLeave(() => { left = true; });
      await until(() => !!world);
      expect(world!.acknowledged).toEqual([-1, -1]);
      a.send("run", true);
      a.sendBytes("in", encodeInput(1, BTN.RIGHT));
      await until(() => (world?.state.movement.frame ?? 0) > 45);
      expect(world!.state.movement.players[0].pad).toBe(0);
      expect(world!.acknowledged).toEqual([1, -1]);
      a.send("run", false);
      await until(() => !world?.playing);
      a.sendBytes("in", new Uint8Array(5));
      await until(() => left);
    } finally {
      if (a.connection.isOpen) await a.leave();
    }
  });
});
