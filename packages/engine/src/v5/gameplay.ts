// Clean experimental behaviors, not a port of Sonic 3's native game logic.
import { V5Movement, type V5MovementState, type V5PlayerState } from "./movement.js";
import { cos256LookupTable, sin256LookupTable } from "../math.js";
import { scatterV5Rings, tickV5DroppedRings, validateV5DroppedRings, type V5DroppedRing } from "./rings.js";
import { createV5Enemies, tickV5Enemies, validateV5Enemies, type V5Enemy, type V5EnemyWorld } from "./enemies.js";
import { BTN } from "../input.js";
import { v5PlayerHalfSize } from "./path-grip.js";
import { tickV5Collapses, v5CollapseTiles, validateV5Collapses, validateV5CollapseState, type V5Collapse, type V5CollapseState } from "./collapse.js";
import { v5SwingRopeAt, v5RopeVelocity, v5RopeBlocked, type V5SwingRope } from "./ropes.js";

const FP = 65536;
export type V5Object =
  | V5Enemy
  | V5Collapse
  | V5SwingRope
  | { id: number; kind: "water"; x: number; y: number; plane: number | null }
  | { id: number; kind: "ring"; x: number; y: number; plane: number | null }
  | { id: number; kind: "checkpoint"; x: number; y: number; plane: number | null }
  | { id: number; kind: "fling-ramp"; x: number; y: number; plane: number | null; direction: number }
  | { id: number; kind: "spring"; x: number; y: number; plane: number | null; vx: number; vy: number; onGround?: boolean }
  | { id: number; kind: "spikes"; x: number; y: number; plane: number | null; direction: number; count: number;
      moving: boolean; stagger: number; timer: number }
  | { id: number; kind: "platform"; x: number; y: number; plane: number | null; amplitudeX: number; amplitudeY: number;
      speed: number; phase: number; halfWidth: number; top: number; sprite: number }
  | { id: number; kind: "monitor"; x: number; y: number; plane: number | null; item: number; sprite: number }
  | { id: number; kind: "rock"; x: number; y: number; plane: number | null; halfWidth: number; top: number; bottom: number;
      smashTop: boolean; smashSides: boolean; restricted: boolean; sprite: number; frame: number }
  | { id: number; kind: "block"; x: number; y: number; plane: number | null; halfWidth: number; halfHeight: number;
      ignoreTop: boolean; ignoreBottom: boolean; ignoreLeft: boolean; ignoreRight: boolean }
  | { id: number; kind: "plane-switch"; x: number; y: number; plane: number | null; flags: number; size: number; angle: number; onPath: boolean }
  | { id: number; kind: "hazard"; x: number; y: number; plane: number | null; halfWidth: number; halfHeight: number };

export interface V5Progress {
  rings: number;
  deaths: number;
  invincible: number;
  checkpoint: number | null;
  spawnX: number;
  spawnY: number;
  spawnPlane: number;
  spawnHighPriority: boolean;
  shield: "none" | "blue" | "bubble" | "fire" | "lightning";
  powerInvincible: number;
  lives: number;
  airFrames: number;
  shieldUsed: boolean;
  bubbleBounce: boolean;
}
export interface V5GameplayState {
  movement: V5MovementState;
  players: V5Progress[];
  collected: number[];
  /** Per-object, per-player spring contact latches, included in rollback state. */
  contacts: number[];
  broken: number[];
  droppedRings: V5DroppedRing[];
  nextRingId: number;
  enemyWorld: V5EnemyWorld;
  collapses: V5CollapseState[];
}
export type V5GameplayEvent = { type: "ring" | "checkpoint" | "spring" | "hurt" | "respawn" | "plane" | "monitor" | "enemy" | "rock" | "ramp"; player: number; object: number | null };

/** Derives retracting spikes entirely from the shared 60 Hz frame, including their initial hidden interval. */
export function v5SpikesAt(object: Extract<V5Object, { kind: "spikes" }>, frame: number): { x: number; y: number; active: boolean } {
  const dx = object.direction < 2 ? 0 : object.direction === 2 ? 1 : -1;
  const dy = object.direction >= 2 ? 0 : object.direction === 0 ? -1 : 1;
  let extension = 32;
  if (object.moving) {
    const elapsed = frame - 1 - object.timer - object.stagger * 64;
    const phase = elapsed < 0 ? -1 : elapsed % 128;
    extension = phase < 0 || phase > 68 ? 0 : phase <= 4 ? phase * 8 : phase <= 64 ? 32 : (68 - phase) * 8;
  }
  return { x: object.x + dx * (extension - 32) * FP, y: object.y + dy * (extension - 32) * FP,
    active: !object.moving || extension > 0 };
}

const platformSine = Int32Array.from({ length: 1024 }, (_, angle) => Math.trunc(Math.sin(angle * Math.PI / 512) * 1024));
platformSine[0] = platformSine[512] = 0; platformSine[256] = 1024; platformSine[768] = -1024;

export function v5PlatformAt(object: Extract<V5Object, { kind: "platform" }>, frame: number): { x: number; y: number } {
  const wave = platformSine[(object.speed * ((frame % 1024) + object.phase)) & 1023];
  return { x: object.x + Math.floor(object.amplitudeX / 1024) * wave,
    y: object.y + Math.floor(object.amplitudeY / 1024) * wave };
}

export class V5Gameplay {
  private progress: V5Progress[];
  private collected = new Set<number>();
  private contacts = new Set<number>();
  private broken = new Set<number>();
  private droppedRings: V5DroppedRing[] = [];
  private nextRingId = 0;
  private enemyWorld: V5EnemyWorld;
  private readonly enemies: V5Enemy[];
  readonly waterY: number | null;
  private readonly collapsing: V5Collapse[];
  private collapses: V5CollapseState[];
  readonly objects: readonly V5Object[];

  constructor(readonly movement: V5Movement, objects: readonly V5Object[], readonly deathY: number) {
    const ids = new Set<number>();
    for (const object of objects) {
      if (!Number.isInteger(object.id) || object.id < 0 || ids.has(object.id)
        || ![object.x, object.y].every((n) => Number.isInteger(n) && Math.abs(n) <= 0x70000000)
        || (object.plane !== null && object.plane !== 0 && object.plane !== 1)
        || (object.kind === "fling-ramp" && (!Number.isInteger(object.direction) || object.direction < 0 || object.direction > 2))
        || (object.kind === "spring" && (![object.vx, object.vy].every(Number.isInteger)
          || Math.abs(object.vx) > 16 * FP || Math.abs(object.vy) > 16 * FP || (!object.vx && !object.vy)
          || (object.onGround !== undefined && typeof object.onGround !== "boolean")))
        || (object.kind === "spikes" && (![object.direction, object.count, object.stagger, object.timer].every(Number.isInteger)
          || object.direction < 0 || object.direction > 3 || object.count < 2 || object.count > 64
          || object.stagger < 0 || object.stagger > 1 || object.timer < 0 || object.timer > 63 || typeof object.moving !== "boolean"))
        || (object.kind === "platform" && (![object.amplitudeX, object.amplitudeY, object.speed, object.phase,
          object.halfWidth, object.top, object.sprite].every(Number.isInteger)
          || Math.abs(object.amplitudeX) > 256 * FP || Math.abs(object.amplitudeY) > 256 * FP
          || object.speed < 0 || object.speed > 8 || object.phase < 0 || object.phase > 1023
          || object.halfWidth < 1 || object.halfWidth > 1024 || Math.abs(object.top) > 1024
          || object.sprite < 0 || object.sprite > 255))
        || (object.kind === "monitor" && (!Number.isInteger(object.item) || object.item < 0 || object.item > 9
          || !Number.isInteger(object.sprite) || object.sprite < 0 || object.sprite > 255))
        || (object.kind === "rock" && (![object.halfWidth, object.top, object.bottom, object.sprite, object.frame].every(Number.isInteger)
          || object.halfWidth < 1 || object.halfWidth > 1024 || object.top < -1024 || object.bottom > 1024 || object.top >= object.bottom
          || object.sprite < 0 || object.sprite > 255 || object.frame < 0 || object.frame > 2
          || ![object.smashTop, object.smashSides, object.restricted].every((v) => typeof v === "boolean")))
        || (("facing" in object) && ((object.facing !== -1 && object.facing !== 1)
          || !Number.isInteger(object.sprite) || object.sprite < 0 || object.sprite > 255))
        || (object.kind === "swing-rope" && (!Number.isInteger(object.links) || object.links < 1 || object.links > 32
          || !Number.isInteger(object.phase) || object.phase < 0 || object.phase > 511
          || !Number.isInteger(object.sprite) || object.sprite < 0 || object.sprite > 255))
        || (object.kind === "block" && (![object.halfWidth, object.halfHeight].every(Number.isInteger)
          || object.halfWidth < 1 || object.halfWidth > 2048 || object.halfHeight < 1 || object.halfHeight > 2048
          || ![object.ignoreTop, object.ignoreBottom, object.ignoreLeft, object.ignoreRight].every((v) => typeof v === "boolean")))
        || (object.kind === "plane-switch" && (![object.flags, object.size, object.angle].every(Number.isInteger)
          || object.flags < 0 || object.flags > 15 || object.size < 1 || object.size > 1024
          || object.angle < 0 || object.angle > 255 || typeof object.onPath !== "boolean"))
        || (object.kind === "hazard" && (![object.halfWidth, object.halfHeight].every(Number.isInteger)
          || object.halfWidth < 1 || object.halfHeight < 1 || object.halfWidth > 1024 || object.halfHeight > 1024))) {
        throw new Error("invalid experimental v5 gameplay object");
      }
      ids.add(object.id);
    }
    if (!Number.isInteger(deathY) || Math.abs(deathY) > 0x70000000) throw new Error("invalid v5 death boundary");
    this.objects = objects.map((object) => ({ ...object }));
    this.enemies = this.objects.filter((object): object is V5Enemy =>
      object.kind === "cyclone" || object.kind === "saruder" || object.kind === "tulippon");
    this.enemyWorld = createV5Enemies(this.enemies);
    this.collapsing = this.objects.filter((o): o is V5Collapse => o.kind === "collapse");
    validateV5Collapses(this.collapsing, movement.world.layers);
    if (this.collapsing.some((o) => !movement.collisionLayers.includes(o.layer))) throw new Error("v5 collapse layer has no collision");
    this.collapses = this.collapsing.map(({ id }) => ({ id, started: null }));
    this.applyCollapses(0);
    const waters = this.objects.filter((o) => o.kind === "water");
    if (waters.length > 1 || waters.some((o) => o.plane !== null)) throw new Error("unsupported v5 water volumes");
    this.waterY = waters[0]?.y ?? null;
    this.progress = movement.capture().players.map((p) => ({
      rings: 0, deaths: 0, invincible: 0, checkpoint: null, spawnX: p.x, spawnY: p.y, spawnPlane: p.plane,
      spawnHighPriority: p.highPriority,
      shield: "none", powerInvincible: 0, lives: 3,
      airFrames: 1800, shieldUsed: false, bubbleBounce: false,
    }));
  }

  capture(): V5GameplayState {
    return { movement: this.movement.capture(), players: this.progress.map((p) => ({ ...p })),
      collected: [...this.collected].sort((a, b) => a - b), contacts: [...this.contacts].sort((a, b) => a - b),
      broken: [...this.broken].sort((a, b) => a - b),
      droppedRings: this.droppedRings.map((ring) => ({ ...ring })), nextRingId: this.nextRingId,
      enemyWorld: structuredClone(this.enemyWorld), collapses: this.collapses.map((entry) => ({ ...entry })) };
  }

  restore(state: V5GameplayState): void {
    if (!state) throw new Error("invalid v5 gameplay snapshot");
    validateV5DroppedRings(state.droppedRings, state.nextRingId);
    validateV5Enemies(state.enemyWorld, this.enemies);
    validateV5CollapseState(state.collapses, this.collapsing, state.movement?.frame);
    const rings = new Set(this.objects.filter((o) => o.kind === "ring").map((o) => o.id));
    const checkpoints = new Set(this.objects.filter((o) => o.kind === "checkpoint").map((o) => o.id));
    const platforms = new Set(this.objects.filter((o) => o.kind === "platform" || (o.kind === "block" && !o.ignoreTop)).map((o) => o.id));
    const breakables = new Set(this.objects.filter((o) => o.kind === "monitor" || (o.kind === "rock" && !o.restricted)).map((o) => o.id));
    const solids = new Set(this.objects.filter((o) => o.kind === "monitor" || o.kind === "rock").map((o) => o.id));
    const ropes = new Set(this.objects.filter((o) => o.kind === "swing-rope").map((o) => o.id));
    if (!state || !Array.isArray(state.players) || state.players.length !== this.progress.length
      || !Array.isArray(state.broken) || state.broken.some((id) => !breakables.has(id)) || new Set(state.broken).size !== state.broken.length
      || !state.movement || !Array.isArray(state.movement.players)
      || state.movement.players.some((p) => !p || (p.groundObject !== null && (!p.grounded
        || (!platforms.has(p.groundObject) && (!solids.has(p.groundObject) || state.broken.includes(p.groundObject)))))
        || (p.grabObject !== null && !ropes.has(p.grabObject)))
      || state.players.some((p) => !p || ![p.rings, p.deaths, p.invincible, p.spawnX, p.spawnY, p.spawnPlane].every(Number.isSafeInteger)
        || p.rings < 0 || p.rings > 999 || p.deaths < 0 || p.invincible < 0 || p.invincible > 180
        || Math.abs(p.spawnX) > 0x70000000 || Math.abs(p.spawnY) > 0x70000000 || (p.spawnPlane !== 0 && p.spawnPlane !== 1)
        || typeof p.spawnHighPriority !== "boolean"
        || !["none", "blue", "bubble", "fire", "lightning"].includes(p.shield)
        || !Number.isInteger(p.powerInvincible) || p.powerInvincible < 0 || p.powerInvincible > 1200
        || !Number.isInteger(p.lives) || p.lives < 0 || p.lives > 99
        || !Number.isInteger(p.airFrames) || p.airFrames < 1 || p.airFrames > 1800
        || typeof p.shieldUsed !== "boolean" || typeof p.bubbleBounce !== "boolean"
        || (p.bubbleBounce && (p.shield !== "bubble" || !p.shieldUsed))
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
    this.broken = new Set(state.broken);
    this.droppedRings = state.droppedRings.map((ring) => ({ ...ring }));
    this.nextRingId = state.nextRingId;
    this.enemyWorld = structuredClone(state.enemyWorld);
    this.collapses = state.collapses.map((entry) => ({ ...entry }));
    this.applyCollapses(state.movement.frame);
  }

  private touching(player: V5PlayerState, object: V5Object, width: number, height: number): boolean {
    const size = v5PlayerHalfSize(player);
    return (object.plane === null || object.plane === player.plane)
      && Math.abs(player.x - object.x) <= (size.x + width) * FP
      && Math.abs(player.y - object.y) <= (size.y + height) * FP;
  }

  tick(pads: readonly number[]): V5GameplayEvent[] {
    const before = this.capture();
    const events: V5GameplayEvent[] = [];
    try {
      const switched = this.movement.capture();
      for (const object of this.objects) {
        if (object.kind !== "plane-switch") continue;
        const cos = cos256LookupTable[object.angle], sin = sin256LookupTable[object.angle];
        switched.players.forEach((player, slot) => {
          if ((object.onPath && !player.grounded) || (object.plane !== null && object.plane !== player.plane)) return;
          // Native switches quantize to 1/256 pixel before rotating into switch-local coordinates.
          const dx = Math.floor((player.x - object.x) / 256), dy = Math.floor((player.y - object.y) / 256);
          const across = dx * cos - dy * sin;
          const along = dx * sin + dy * cos;
          if (Math.abs(across) >= 24 * FP || Math.abs(along) >= object.size * 8 * FP) return;
          const velocity = Math.floor(player.vx / 256) * cos - Math.floor(player.vy / 256) * sin;
          // Each side encodes draw priority in its low bit and collision plane in its high bit.
          const side = object.flags >>> (across + velocity >= 0 ? 2 : 0);
          const plane = (side >>> 1) & 1, highPriority = !!(side & 1);
          if (player.plane !== plane || player.highPriority !== highPriority) {
            player.plane = plane; player.highPriority = highPriority;
            events.push({ type: "plane", player: slot, object: object.id });
          }
        });
      }
      switched.players.forEach((player, slot) => {
        if (player.grabObject === null) return;
        const rope = this.objects.find((o): o is V5SwingRope => o.kind === "swing-rope" && o.id === player.grabObject);
        if (!rope) throw new Error("missing v5 grabbed rope");
        const handle = v5SwingRopeAt(rope, switched.frame + 1), velocity = v5RopeVelocity(rope, switched.frame + 1);
        const released = pads[slot] & ~player.pad & (BTN.A | BTN.B | BTN.C);
        const wrongPlane = rope.plane !== null && player.plane !== rope.plane;
        const blocked = v5RopeBlocked(this.movement.world, this.movement.collisionLayers, player, handle.x, handle.y + 19 * FP);
        if (released || wrongPlane || blocked) {
          player.grabObject = null; player.grabLock = 30;
          const jumpSpeed = player.underwater ? 0x38000 : 0x68000;
          player.vx = blocked ? 0 : velocity.vx;
          player.vy = blocked ? 0 : Math.max(-16 * FP, velocity.vy - (released ? jumpSpeed : 0));
          player.jumping = !!released; player.rolling = !!released;
          if (released) { player.y += 5 * FP; player.pad = pads[slot]; }
        } else {
          player.x = handle.x; player.y = handle.y + 19 * FP;
          player.vx = velocity.vx; player.vy = velocity.vy;
        }
      });
      switched.players.forEach((player, slot) => {
        const progress = this.progress[slot];
        if (this.waterY !== null && player.y > this.waterY && (progress.shield === "fire" || progress.shield === "lightning")) {
          progress.shield = "none"; progress.shieldUsed = false;
        }
        if (player.grounded) { progress.shieldUsed = false; progress.bubbleBounce = false; }
        const pressed = pads[slot] & ~player.pad & (BTN.A | BTN.B | BTN.C);
        if (slot !== 0 || !player.jumping || player.grounded || progress.shieldUsed || !pressed) return;
        if (progress.shield === "lightning") { player.vy = -0x58000; progress.shieldUsed = true; }
        else if (progress.shield === "fire") {
          player.vx = player.facing * 8 * FP; player.vy = 0; player.controlLock = 16; progress.shieldUsed = true;
        } else if (progress.shield === "bubble") {
          player.vx = 0; player.vy = 8 * FP; progress.shieldUsed = true; progress.bubbleBounce = true;
        }
      });
      for (const object of this.objects) {
        if (object.kind !== "fling-ramp") continue;
        switched.players.forEach((player, slot) => {
          if (!player.grounded || !this.touching(player, object, 16, 16)) return;
          const right = object.direction !== 2 && player.facing === 1 && player.vx >= 4 * FP;
          const left = object.direction !== 1 && player.facing === -1 && player.vx <= -4 * FP;
          if (!right && !left) return;
          player.vx = Math.max(-16 * FP, Math.min(16 * FP, player.vx + (right ? 4 : -4) * FP));
          player.vy = -7 * FP; player.grounded = false; player.groundObject = null; player.angle = 0;
          player.jumping = false; player.spinCharge = 0; player.flying = false; player.flightTime = 0;
          player.pad = pads[slot];
          this.progress[slot].bubbleBounce = false;
          events.push({ type: "ramp", player: slot, object: object.id });
        });
      }
      this.movement.restore(switched);
      tickV5Collapses(this.collapses, this.collapsing, switched.players, switched.frame + 1);
      this.applyCollapses(switched.frame + 1);
      const platforms = this.objects.flatMap((object) => {
        if (object.kind === "block") {
          return [{ id: object.id, x: object.x, y: object.y - object.halfHeight * FP, previousX: object.x,
            previousY: object.y - object.halfHeight * FP, halfWidth: object.halfWidth, plane: object.plane,
            bottom: object.y + object.halfHeight * FP, ignoreTop: object.ignoreTop, ignoreBottom: object.ignoreBottom,
            ignoreLeft: object.ignoreLeft, ignoreRight: object.ignoreRight }];
        }
        if (object.kind === "monitor" && !this.broken.has(object.id)) {
          return [{ id: object.id, x: object.x, y: object.y - 16 * FP, previousX: object.x,
            previousY: object.y - 16 * FP, halfWidth: 16, plane: object.plane, bottom: object.y + 16 * FP }];
        }
        if (object.kind === "rock" && !this.broken.has(object.id)) {
          return [{ id: object.id, x: object.x, y: object.y + object.top * FP, previousX: object.x,
            previousY: object.y + object.top * FP, halfWidth: object.halfWidth, plane: object.plane,
            bottom: object.y + object.bottom * FP }];
        }
        if (object.kind !== "platform") return [];
        const current = v5PlatformAt(object, switched.frame + 1), previous = v5PlatformAt(object, switched.frame);
        return [{ id: object.id, x: current.x, y: current.y + object.top * FP, previousX: previous.x,
          previousY: previous.y + object.top * FP, halfWidth: object.halfWidth, plane: object.plane }];
      });
      this.movement.tick(pads, platforms, this.waterY);
      const next = this.movement.capture();
      this.droppedRings = tickV5DroppedRings(this.droppedRings, this.movement.world, this.movement.collisionLayers, this.deathY);
      tickV5Enemies(this.enemyWorld, this.enemies, next.players, this.movement.world, this.movement.collisionLayers, this.deathY);
      const contacts = new Set<number>();
      for (let slot = 0; slot < next.players.length; slot++) {
        const player = next.players[slot], progress = this.progress[slot];
        if (progress.invincible) progress.invincible--;
        if (progress.powerInvincible) progress.powerInvincible--;
        if (player.y > this.deathY) {
          this.respawn(player, progress);
          events.push({ type: "respawn", player: slot, object: null });
          continue;
        }
        if (progress.bubbleBounce && player.grounded) {
          if (!player.rolling) { player.y += 5 * FP; player.rolling = true; }
          player.vy = -0x78000; player.grounded = false; player.jumping = true; player.groundObject = null;
          progress.bubbleBounce = false; progress.shieldUsed = false;
        } else if (player.grounded) progress.shieldUsed = false;
        if (this.waterY !== null && player.y - (player.rolling ? 14 : 19) * FP > this.waterY && progress.shield !== "bubble") {
          if (--progress.airFrames === 0) {
            this.respawn(player, progress);
            events.push({ type: "respawn", player: slot, object: this.objects.find((o) => o.kind === "water")!.id });
            continue;
          }
        } else progress.airFrames = 1800;
        this.droppedRings = this.droppedRings.filter((ring) => {
          const size = v5PlayerHalfSize(player);
          if (ring.age < 32 || ring.plane !== player.plane || Math.abs(player.x - ring.x) > (size.x + 6) * FP
            || Math.abs(player.y - ring.y) > (size.y + 6) * FP) return true;
          progress.rings = Math.min(999, progress.rings + 1);
          events.push({ type: "ring", player: slot, object: null });
          return false;
        });
        for (let index = 0; index < this.objects.length; index++) {
          const object = this.objects[index];
          if (object.kind === "swing-rope") {
            const handle = v5SwingRopeAt(object, next.frame);
            if (player.grabObject !== null || player.grabLock || player.grounded || player.vy < -4 * FP
              || !this.touching(player, { ...object, x: handle.x, y: handle.y + 16 * FP }, 8, 12)
              || v5RopeBlocked(this.movement.world, this.movement.collisionLayers, player, handle.x, handle.y + 19 * FP)) continue;
            player.grabObject = object.id; player.x = handle.x; player.y = handle.y + 19 * FP;
            const velocity = v5RopeVelocity(object, next.frame); player.vx = velocity.vx; player.vy = velocity.vy;
            player.rolling = false; player.jumping = false; player.flying = false; player.flightTime = 0;
            player.spinCharge = 0; player.groundObject = null; player.angle = 0; player.controlLock = 0; progress.bubbleBounce = false;
          } else if (object.kind === "rock") {
            const center = { ...object, y: object.y + (object.top + object.bottom) * FP / 2 };
            if (object.restricted || this.broken.has(object.id)
              || !this.touching(player, center, object.halfWidth, (object.bottom - object.top) / 2)) continue;
            const previous = switched.players[slot], size = v5PlayerHalfSize(previous);
            const top = object.y + object.top * FP;
            const fromTop = !previous.grounded && previous.vy >= 0 && previous.y + size.y * FP <= top
              && player.groundObject === object.id;
            const fromSide = Math.abs(player.x - object.x) >= (object.halfWidth + v5PlayerHalfSize(player).x - 1) * FP
              && previous.vx * (object.x - previous.x) > 0;
            const defaultSmash = !object.smashTop && !object.smashSides;
            const fireDash = slot === 0 && progress.shield === "fire" && progress.shieldUsed && previous.controlLock > 0;
            const sideAttack = (previous.grounded && previous.rolling && Math.abs(previous.vx) >= 0x48000) || fireDash;
            const bounce = fromTop && (object.smashTop || defaultSmash) && (previous.jumping || previous.rolling);
            if (!bounce && !(fromSide && (object.smashSides || defaultSmash) && sideAttack)) continue;
            this.broken.add(object.id);
            for (const other of next.players) if (other.groundObject === object.id) {
              other.groundObject = null; other.grounded = false; other.spinCharge = 0;
            }
            if (bounce) {
              if (!player.rolling) { player.y += 5 * FP; player.rolling = true; }
              player.vy = -3 * FP; player.grounded = false; player.jumping = true; player.flying = false;
              player.flightTime = 0; player.spinCharge = 0; player.groundObject = null;
              progress.bubbleBounce = false;
            } else player.vx = previous.vx;
            events.push({ type: "rock", player: slot, object: object.id });
          } else if (object.kind === "monitor") {
            if (this.broken.has(object.id) || !this.touching(player, object, 16, 16)) continue;
            const previous = before.movement.players[slot];
            if (!player.rolling && !previous.rolling && !previous.jumping) continue;
            this.broken.add(object.id);
            for (const other of next.players) if (other.groundObject === object.id) {
              other.groundObject = null; other.grounded = false; other.spinCharge = 0;
            }
            const previousFoot = previous.y + (previous.rolling ? 14 : 19) * FP;
            if (previous.vy >= 0 && previousFoot <= object.y - 15 * FP) {
              if (!player.rolling) { player.y += 5 * FP; player.rolling = true; }
              player.vy = -4 * FP; player.grounded = false; player.jumping = true; player.flying = false;
              player.spinCharge = 0; player.groundObject = null;
            } else if (previous.vx) player.vx = previous.vx;
            if (object.item === 0) progress.rings = Math.min(999, progress.rings + 10);
            else if (object.item <= 4) {
              progress.shield = (["blue", "bubble", "fire", "lightning"] as const)[object.item - 1];
              progress.shieldUsed = false; progress.bubbleBounce = false;
            }
            else if (object.item === 5) progress.powerInvincible = 1200;
            else if (object.item === 6) player.speedTime = 1200;
            else progress.lives = Math.min(99, progress.lives + 1);
            events.push({ type: "monitor", player: slot, object: object.id });
          } else if (object.kind === "ring") {
            if (!this.collected.has(object.id) && this.touching(player, object, 6, 6)) {
              this.collected.add(object.id); progress.rings = Math.min(999, progress.rings + 1);
              events.push({ type: "ring", player: slot, object: object.id });
            }
          } else if (object.kind === "checkpoint") {
            if (progress.checkpoint !== object.id && this.touching(player, object, 8, 24)) {
              progress.checkpoint = object.id;
              progress.spawnX = object.x; progress.spawnY = object.y - 24 * FP; progress.spawnPlane = player.plane;
              progress.spawnHighPriority = player.highPriority;
              events.push({ type: "checkpoint", player: slot, object: object.id });
            }
          } else if (object.kind === "spring") {
            const horizontal = object.vy === 0, vertical = object.vx === 0;
            if (!this.touching(player, object, horizontal ? 8 : vertical ? 16 : 12, horizontal ? 16 : vertical ? 8 : 12)) continue;
            if (object.onGround && !player.grounded) continue;
            if (vertical && (player.y - object.y) * Math.sign(object.vy) < 0) continue;
            if (horizontal && (player.x - object.x) * Math.sign(object.vx) < 0) continue;
            if (!horizontal && !vertical && !player.grounded && player.vy < 0 && Math.abs(player.vx) <= -player.vy) continue;
            const key = index * next.players.length + slot;
            contacts.add(key);
            if (!this.contacts.has(key)) {
              if (object.vx) { player.vx = object.vx; player.facing = object.vx < 0 ? -1 : 1; player.controlLock = 16; }
              if (object.vy) { player.vy = object.vy; player.grounded = false; player.groundObject = null; }
              player.jumping = false; player.spinCharge = 0; player.flying = false; progress.bubbleBounce = false;
              player.grabObject = null; player.grabLock = 30;
              events.push({ type: "spring", player: slot, object: object.id });
            }
          } else if (object.kind === "hazard" || object.kind === "spikes") {
            const position = object.kind === "spikes" ? v5SpikesAt(object, next.frame) : { ...object, active: true };
            const width = object.kind === "hazard" ? object.halfWidth : object.direction < 2 ? object.count * 8 : 16;
            const height = object.kind === "hazard" ? object.halfHeight : object.direction < 2 ? 16 : object.count * 8;
            if (!position.active || progress.invincible || progress.powerInvincible
              || !this.touching(player, { ...object, ...position }, width, height)) continue;
            this.hurt(player, progress, slot, object.x, object.id, events);
            if (progress.deaths !== before.players[slot].deaths) break;
          }
        }
        if (progress.deaths !== before.players[slot].deaths) continue;
        for (let index = 0; index < this.enemies.length; index++) {
          const object = this.enemies[index], enemy = this.enemyWorld.enemies[index];
          const width = object.kind === "cyclone" ? 18 : object.kind === "saruder" ? 12 : 16;
          if (enemy.defeated || !this.touching(player, { ...object, x: enemy.x, y: enemy.y }, width, 18)) continue;
          if (progress.powerInvincible || ((player.rolling || player.jumping) && progress.invincible === 0)) {
            enemy.defeated = true;
            if (player.vy > 0) { player.vy = -4 * FP; player.grounded = false; player.jumping = true; player.groundObject = null; }
            events.push({ type: "enemy", player: slot, object: object.id });
          } else if (!progress.invincible) this.hurt(player, progress, slot, enemy.x, object.id, events);
          if (progress.deaths !== before.players[slot].deaths) break;
        }
        if (progress.deaths !== before.players[slot].deaths) continue;
        this.enemyWorld.projectiles = this.enemyWorld.projectiles.filter((shot) => {
          const source = this.enemies.find((object) => object.id === shot.source);
          if (!source) throw new Error("missing v5 projectile source");
          if (progress.invincible || progress.powerInvincible
            || !this.touching(player, { ...source, x: shot.x, y: shot.y }, 6, 6)) return true;
          this.hurt(player, progress, slot, shot.x, shot.source, events);
          return false;
        });
      }
      this.contacts = contacts;
      this.movement.restore(next);
      return events;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  private applyCollapses(frame: number): void {
    this.movement.world.setRemovedTiles(this.collapsing.flatMap((object, index) =>
      v5CollapseTiles(object, this.movement.world.layers, this.collapses[index].started, frame)));
  }

  private hurt(player: V5PlayerState, progress: V5Progress, slot: number, sourceX: number, object: number,
    events: V5GameplayEvent[]): void {
    if (!progress.rings && progress.shield === "none") {
      this.respawn(player, progress);
      events.push({ type: "respawn", player: slot, object });
      return;
    }
    if (progress.shield !== "none") progress.shield = "none";
    else {
      const count = Math.min(32, progress.rings);
      if (this.nextRingId > Number.MAX_SAFE_INTEGER - count) throw new Error("v5 dropped ring id overflow");
      this.droppedRings.push(...scatterV5Rings(player.x, player.y, player.plane, count, this.nextRingId));
      this.nextRingId += count; progress.rings = 0;
    }
    progress.invincible = 120;
    progress.shieldUsed = false; progress.bubbleBounce = false;
    player.vx = player.x < sourceX ? -2 * FP : 2 * FP; player.vy = -4 * FP;
    player.grounded = false; player.jumping = false; player.spinCharge = 0; player.controlLock = 0; player.groundObject = null;
    player.flying = false; player.flightTime = slot === 1 ? 480 : 0;
    player.grabObject = null; player.grabLock = 30;
    events.push({ type: "hurt", player: slot, object });
  }

  private respawn(player: V5PlayerState, progress: V5Progress): void {
    player.x = progress.spawnX; player.y = progress.spawnY; player.plane = progress.spawnPlane;
    player.highPriority = progress.spawnHighPriority;
    player.vx = 0; player.vy = 0; player.grounded = false; player.jumping = false; player.angle = 0;
    player.rolling = false; player.spinCharge = 0; player.facing = 1; player.controlLock = 0; player.groundObject = null;
    player.flying = false; player.flightTime = 0;
    player.speedTime = 0;
    player.underwater = false;
    player.grabObject = null; player.grabLock = 0;
    progress.airFrames = 1800; progress.shieldUsed = false; progress.bubbleBounce = false;
    progress.shield = "none"; progress.powerInvincible = 0; progress.lives = Math.max(0, progress.lives - 1);
    progress.rings = 0; progress.deaths++; progress.invincible = 180;
  }
}
