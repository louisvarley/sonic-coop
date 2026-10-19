// Opt-in experimental room. Sonic 3 is deliberately not added to the supported-game lobby.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import { decodeInput } from "@ringlink/engine";
import { readV5Level } from "../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../packages/engine/src/v5/movement.js";
import { V5Gameplay } from "../../../packages/engine/src/v5/gameplay.js";
import type { V5OnlineSnapshot } from "../../../packages/engine/src/v5/net.js";
import { DATA_DIR } from "./gamedata.js";
import { log } from "./log.js";
import { stats } from "./stats.js";

interface Seat { slot: number; seq: number; applied: number; pad: number; lastInput: number }

export class Sonic3ExperimentRoom extends Room {
  override maxClients = 2;
  private sim!: V5Gameplay;
  private initial!: ReturnType<V5Gameplay["capture"]>;
  private hash = "";
  private owner = "";
  private playing = false;
  private seats = new Map<string, Seat>();
  private counted = false;

  override onCreate(): void {
    const file = path.join(DATA_DIR, "sonic3", "experimental.pak");
    if (!fs.existsSync(file)) throw new Error("Sonic 3 experimental assets are missing. Run npm run export:sonic3.");
    const bytes = fs.readFileSync(file), level = readV5Level(bytes);
    if (level.spawns.length !== 2) throw new Error("Sonic 3 experiment requires two player spawns");
    this.hash = createHash("md5").update(bytes).digest("hex");
    this.sim = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    this.initial = this.sim.capture();
    this.onMessage("in", (client, bytes: unknown) => {
      const seat = this.seats.get(client.sessionId);
      if (!seat) return;
      if (!(bytes instanceof Uint8Array) || bytes.length !== 6) {
        log("error", `Sonic 3 ${this.roomId}: invalid input from ${client.sessionId}`);
        client.send("notice", "Invalid input packet");
        void client.leave(4002);
        return;
      }
      const input = decodeInput(bytes);
      if (input.seq <= seat.seq) return;
      seat.seq = input.seq; seat.pad = input.pad; seat.lastInput = performance.now();
    });
    this.onMessage("run", (client, value: unknown) => {
      if (client.sessionId !== this.owner) { client.send("notice", "Only the host can start or pause the experiment"); return; }
      if (typeof value !== "boolean") { client.send("notice", "Invalid run command"); return; }
      this.playing = value;
      for (const seat of this.seats.values()) seat.pad = 0;
      this.publish();
    });
    this.onMessage("restart", (client) => {
      if (client.sessionId !== this.owner) { client.send("notice", "Only the host can restart the experiment"); return; }
      this.playing = false; this.sim.restore(this.initial);
      for (const seat of this.seats.values()) seat.pad = 0;
      this.publish();
    });
    this.setSimulationInterval(() => this.step(), 1000 / 60);
    stats.rooms++; this.counted = true;
    log("room", `created Sonic 3 experiment ${this.roomId}`);
  }

  override onAuth(_client: Client, options: { levelHash?: unknown }): boolean {
    if (!options || options.levelHash !== this.hash) throw new Error("Sonic 3 assets do not match the server. Re-export and reload.");
    return true;
  }

  override onJoin(client: Client): void {
    const used = new Set([...this.seats.values()].map((seat) => seat.slot));
    const slot = used.has(0) ? 1 : 0;
    if (used.has(slot)) throw new Error("Sonic 3 experiment is full");
    this.seats.set(client.sessionId, { slot, seq: -1, applied: -1, pad: 0, lastInput: 0 });
    if (!this.owner) this.owner = client.sessionId;
    client.send("welcome", { slot });
    this.publish();
  }

  override onLeave(client: Client): void {
    this.seats.delete(client.sessionId);
    if (this.owner === client.sessionId) this.owner = this.seats.keys().next().value ?? "";
    if (!this.seats.size) this.playing = false;
    this.publish();
  }

  override onDispose(): void {
    if (this.counted) stats.rooms--;
    log("room", `disposed Sonic 3 experiment ${this.roomId}`);
  }

  private step(): void {
    if (!this.playing) return;
    const pads = [0, 0], now = performance.now();
    for (const seat of this.seats.values()) {
      // Lost focus or suspended browser: never keep moving forever on a stale held input.
      if (now - seat.lastInput <= 250) pads[seat.slot] = seat.pad;
    }
    try {
      const start = performance.now();
      this.sim.tick(pads);
      for (const seat of this.seats.values()) seat.applied = seat.seq;
      stats.ticks++; stats.tickMs = stats.tickMs * 0.98 + (performance.now() - start) * 0.02;
      if (this.sim.capture().movement.frame % 3 === 0) this.publish();
    } catch (error) {
      this.playing = false;
      log("error", `Sonic 3 ${this.roomId}: ${error instanceof Error ? error.stack : String(error)}`);
      this.broadcast("notice", "The experimental simulation failed and was paused");
      this.publish();
    }
  }

  private publish(): void {
    const acknowledged = [-1, -1];
    for (const seat of this.seats.values()) acknowledged[seat.slot] = seat.applied;
    const snapshot: V5OnlineSnapshot = { state: this.sim.capture(), playing: this.playing, owner: this.owner,
      acknowledged,
      players: [...this.seats].map(([id, seat]) => ({ id, slot: seat.slot })).sort((a, b) => a.slot - b.slot) };
    this.broadcast("world", snapshot);
  }
}
