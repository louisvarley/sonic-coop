// Clean experimental behaviors, not a port of Sonic 3's native game logic.
import { V5Movement, type V5MovementState, type V5PlayerState } from "./movement.js";

const FP = 65536;
export type V5Object =
  | { id: number; kind: "ring"; x: number; y: number; plane: number | null }
  | { id: number; kind: "checkpoint"; x: number; y: number; plane: number | null }
  | { id: number; kind: "spring"; x: number; y: number; plane: number | null; vx: number; vy: number }
  | { id: number; kind: "hazard"; x: number; y: number; plane: number | null; halfWidth: number; halfHeight: number };

export interface V5Progress {
  rings: number;
  deaths: number;
  invincible: number;
  checkpoint: number | null;
  spawnX: number;
  spawnY: number;
  spawnPlane: number;
}
export interface V5GameplayState {
  movement: V5MovementState;
  players: V5Progress[];
  collected: number[];
  /** Per-object, per-player spring contact latches, included in rollback state. */
  contacts: number[];
}
export type V5GameplayEvent = { type: "ring" | "checkpoint" | "spring" | "hurt" | "respawn"; player: number; object: number | null };

export class V5Gameplay {
  private progress: V5Progress[];
  private collected = new Set<number>();
  private contacts = new Set<number>();
  readonly objects: readonly V5Object[];

  constructor(readonly movement: V5Movement, objects: readonly V5Object[], readonly deathY: number) {
    const ids = new Set<number>();
    for (const object of objects) {
      if (!Number.isInteger(object.id) || object.id < 0 || ids.has(object.id)
        || ![object.x, object.y].every((n) => Number.isInteger(n) && Math.abs(n) <= 0x70000000)
        || (object.plane !== null && object.plane !== 0 && object.plane !== 1)
        || (object.kind === "spring" && (![object.vx, object.vy].every(Number.isInteger)
          || Math.abs(object.vx) > 16 * FP || Math.abs(object.vy) > 16 * FP))
        || (object.kind === "hazard" && (![object.halfWidth, object.halfHeight].every(Number.isInteger)
          || object.halfWidth < 1 || object.halfHeight < 1 || object.halfWidth > 1024 || object.halfHeight > 1024))) {
        throw new Error("invalid experimental v5 gameplay object");
      }
      ids.add(object.id);
    }
    if (!Number.isInteger(deathY) || Math.abs(deathY) > 0x70000000) throw new Error("invalid v5 death boundary");
    this.objects = objects.map((object) => ({ ...object }));
    this.progress = movement.capture().players.map((p) => ({
      rings: 0, deaths: 0, invincible: 0, checkpoint: null, spawnX: p.x, spawnY: p.y, spawnPlane: p.plane,
    }));
  }

  capture(): V5GameplayState {
    return { movement: this.movement.capture(), players: this.progress.map((p) => ({ ...p })),
      collected: [...this.collected].sort((a, b) => a - b), contacts: [...this.contacts].sort((a, b) => a - b) };
  }

  restore(state: V5GameplayState): void {
    const rings = new Set(this.objects.filter((o) => o.kind === "ring").map((o) => o.id));
    const checkpoints = new Set(this.objects.filter((o) => o.kind === "checkpoint").map((o) => o.id));
    if (!state || !Array.isArray(state.players) || state.players.length !== this.progress.length
      || state.players.some((p) => !p || ![p.rings, p.deaths, p.invincible, p.spawnX, p.spawnY, p.spawnPlane].every(Number.isSafeInteger)
        || p.rings < 0 || p.rings > 999 || p.deaths < 0 || p.invincible < 0 || p.invincible > 180
        || Math.abs(p.spawnX) > 0x70000000 || Math.abs(p.spawnY) > 0x70000000 || (p.spawnPlane !== 0 && p.spawnPlane !== 1)
        || (p.checkpoint !== null && !checkpoints.has(p.checkpoint)))
      || !Array.isArray(state.collected) || state.collected.some((id) => !rings.has(id))
      || new Set(state.collected).size !== state.collected.length
      || !Array.isArray(state.contacts) || new Set(state.contacts).size !== state.contacts.length
      || state.contacts.some((key) => !Number.isInteger(key) || key < 0 || key >= this.objects.length * this.progress.length
        || this.objects[Math.floor(key / this.progress.length)].kind !== "spring")) {
      throw new Error("invalid v5 gameplay snapshot");
    }
    this.movement.restore(state.movement);
    this.progress = state.players.map((p) => ({ ...p }));
    this.collected = new Set(state.collected);
    this.contacts = new Set(state.contacts);
  }

  private touching(player: V5PlayerState, object: V5Object, width: number, height: number): boolean {
    return (object.plane === null || object.plane === player.plane)
      && Math.abs(player.x - object.x) <= (9 + width) * FP && Math.abs(player.y - object.y) <= (19 + height) * FP;
  }

  tick(pads: readonly number[]): V5GameplayEvent[] {
    const before = this.capture();
    const events: V5GameplayEvent[] = [];
    try {
      this.movement.tick(pads);
      const next = this.movement.capture();
      const contacts = new Set<number>();
      for (let slot = 0; slot < next.players.length; slot++) {
        const player = next.players[slot], progress = this.progress[slot];
        if (progress.invincible) progress.invincible--;
        if (player.y > this.deathY) {
          this.respawn(player, progress);
          events.push({ type: "respawn", player: slot, object: null });
          continue;
        }
        for (let index = 0; index < this.objects.length; index++) {
          const object = this.objects[index];
          if (object.kind === "ring") {
            if (!this.collected.has(object.id) && this.touching(player, object, 6, 6)) {
              this.collected.add(object.id); progress.rings = Math.min(999, progress.rings + 1);
              events.push({ type: "ring", player: slot, object: object.id });
            }
          } else if (object.kind === "checkpoint") {
            if (progress.checkpoint !== object.id && this.touching(player, object, 8, 24)) {
              progress.checkpoint = object.id;
              progress.spawnX = object.x; progress.spawnY = object.y - 24 * FP; progress.spawnPlane = player.plane;
              events.push({ type: "checkpoint", player: slot, object: object.id });
            }
          } else if (object.kind === "spring") {
            if (!this.touching(player, object, 12, 8)) continue;
            const key = index * next.players.length + slot;
            contacts.add(key);
            if (!this.contacts.has(key)) {
              player.vx = object.vx; player.vy = object.vy; player.grounded = false; player.jumping = false;
              events.push({ type: "spring", player: slot, object: object.id });
            }
          } else if (!progress.invincible && this.touching(player, object, object.halfWidth, object.halfHeight)) {
            if (progress.rings) {
              progress.rings = 0; progress.invincible = 120;
              player.vx = player.x < object.x ? -2 * FP : 2 * FP; player.vy = -4 * FP;
              player.grounded = false; player.jumping = false;
              events.push({ type: "hurt", player: slot, object: object.id });
            } else {
              this.respawn(player, progress);
              events.push({ type: "respawn", player: slot, object: object.id });
              break;
            }
          }
        }
      }
      this.contacts = contacts;
      this.movement.restore(next);
      return events;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  private respawn(player: V5PlayerState, progress: V5Progress): void {
    player.x = progress.spawnX; player.y = progress.spawnY; player.plane = progress.spawnPlane;
    player.vx = 0; player.vy = 0; player.grounded = false; player.jumping = false; player.angle = 0;
    progress.rings = 0; progress.deaths++; progress.invincible = 180;
  }
}
