// Experimental movement and ball physics, not a port of Sonic 3's native player logic.
import { BTN } from "../input.js";
import { V5CollisionWorld, type V5CollisionHit, type V5Surface } from "./collision.js";
import { moveV5Surface, v5GroundSpeed, v5SurfaceNormal, v5SurfaceVelocity } from "./path-grip.js";

const FIXED = 65536;
const HALF_WIDTH = 9, HALF_HEIGHT = 19, BALL_HEIGHT = 14, FOOT_OFFSET = 6;
const MAX_SPEED = 6 * FIXED, MAX_FALL = 16 * FIXED;
const JUMP = BTN.A | BTN.B | BTN.C;

export interface V5PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  angle: number;
  plane: number;
  pad: number;
  jumping: boolean;
  rolling: boolean;
  spinCharge: number;
  facing: -1 | 1;
  highPriority: boolean;
  controlLock: number;
  groundObject: number | null;
  flying: boolean;
  flightTime: number;
  speedTime: number;
  underwater: boolean;
  grabObject: number | null;
  grabLock: number;
}

export interface V5PlatformSurface {
  id: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  halfWidth: number;
  plane: number | null;
  bottom?: number;
  ignoreTop?: boolean;
  ignoreBottom?: boolean;
  ignoreLeft?: boolean;
  ignoreRight?: boolean;
}

export interface V5MovementState {
  frame: number;
  players: V5PlayerState[];
}

/** Integer, 60 Hz locomotion harness shared by headless tests and future v5 runtime work. */
export class V5Movement {
  private state: V5MovementState;
  private readonly layerIndices: number[];

  constructor(readonly world: V5CollisionWorld, layers: readonly number[], spawns: readonly { x: number; y: number }[]) {
    if (spawns.length < 1 || spawns.length > 2) throw new Error("RSDKv5 movement requires one or two player spawns");
    this.layerIndices = [...layers];
    this.world.trace("floor", 0, 0, 0, 0, this.layerIndices);
    this.state = { frame: 0, players: spawns.map(({ x, y }) => ({
      x, y, vx: 0, vy: 0, grounded: false, angle: 0, plane: 0, pad: 0, jumping: false,
      rolling: false, spinCharge: 0, facing: 1, highPriority: false, controlLock: 0, groundObject: null,
      flying: false, flightTime: 0, speedTime: 0,
      underwater: false,
      grabObject: null, grabLock: 0,
    })) };
    this.restore(this.state);
  }

  capture(): V5MovementState {
    return { frame: this.state.frame, players: this.state.players.map((player) => ({ ...player })) };
  }

  get collisionLayers(): readonly number[] { return this.layerIndices; }

  restore(state: V5MovementState): void {
    if (!state || !Number.isSafeInteger(state.frame) || state.frame < 0 || !Array.isArray(state.players)
      || state.players.length !== this.state.players.length || state.players.some((p, slot) => !p
        || ![p.x, p.y, p.vx, p.vy, p.angle, p.plane, p.pad, p.spinCharge, p.controlLock, p.flightTime, p.speedTime].every(Number.isInteger)
        || Math.abs(p.x) > 0x70000000 || Math.abs(p.y) > 0x70000000
        || Math.abs(p.vx) > MAX_FALL || Math.abs(p.vy) > MAX_FALL
        || typeof p.grounded !== "boolean" || typeof p.jumping !== "boolean" || p.angle < 0 || p.angle > 255
        || typeof p.rolling !== "boolean" || (p.facing !== -1 && p.facing !== 1)
        || typeof p.highPriority !== "boolean"
        || p.controlLock < 0 || p.controlLock > 16
        || (p.groundObject !== null && (!Number.isInteger(p.groundObject) || p.groundObject < 0 || p.groundObject > 65535))
        || typeof p.flying !== "boolean" || p.flightTime < 0 || p.flightTime > 480
        || (slot !== 1 && (p.flying || p.flightTime !== 0))
        || p.speedTime < 0 || p.speedTime > 1200
        || typeof p.underwater !== "boolean"
        || (p.grabObject !== null && (!Number.isInteger(p.grabObject) || p.grabObject < 0 || p.grabObject > 65535))
        || !Number.isInteger(p.grabLock) || p.grabLock < 0 || p.grabLock > 30
        || (p.grabObject !== null && (p.grounded || p.rolling || p.flying || p.groundObject !== null || p.grabLock > 0))
        || (p.flying && (p.grounded || p.rolling || p.jumping || p.flightTime === 0))
        || p.spinCharge < 0 || p.spinCharge > 8 * FIXED || (p.spinCharge > 0 && (!p.rolling || !p.grounded))
        || (p.plane !== 0 && p.plane !== 1) || p.pad < 0 || p.pad > 0xffff)) {
      throw new Error("invalid RSDKv5 movement snapshot");
    }
    this.state = { frame: state.frame, players: state.players.map((player) => ({ ...player })) };
  }

  tick(pads: readonly number[], platforms: readonly V5PlatformSurface[] = [], waterY: number | null = null): void {
    if (pads.length !== this.state.players.length || pads.some((pad) => !Number.isInteger(pad) || pad < 0 || pad > 0xffff)
      || this.state.frame >= Number.MAX_SAFE_INTEGER) throw new Error("invalid RSDKv5 movement inputs");
    if (waterY !== null && (!Number.isInteger(waterY) || Math.abs(waterY) > 0x70000000)) throw new Error("invalid v5 water level");
    if (platforms.some((p) => !Number.isInteger(p.id) || p.id < 0 || p.id > 65535
      || ![p.x, p.y, p.previousX, p.previousY].every((n) => Number.isInteger(n) && Math.abs(n) <= 0x70000000)
      || Math.abs(p.x - p.previousX) > 16 * FIXED || Math.abs(p.y - p.previousY) > 16 * FIXED
      || !Number.isInteger(p.halfWidth) || p.halfWidth < 1 || p.halfWidth > 2048
      || (p.plane !== null && p.plane !== 0 && p.plane !== 1))
      || platforms.some((p) => p.bottom !== undefined && (!Number.isInteger(p.bottom) || p.bottom <= p.y || p.bottom > 0x70000000))
      || platforms.some((p) => [p.ignoreTop, p.ignoreBottom, p.ignoreLeft, p.ignoreRight].some((v) => v !== undefined && typeof v !== "boolean"))
      || new Set(platforms.map((p) => p.id)).size !== platforms.length) throw new Error("invalid v5 moving platform surfaces");
    // Work on a copy so a failed collision query or coordinate overflow cannot leave half a tick applied.
    const next = this.capture();
    for (let slot = 0; slot < next.players.length; slot++) {
      this.updateWater(next.players[slot], waterY);
      if (next.players[slot].grabLock) next.players[slot].grabLock--;
      if (next.players[slot].grabObject !== null) {
        next.players[slot].pad = pads[slot];
        if (next.players[slot].speedTime) next.players[slot].speedTime--;
        continue;
      }
      const blocked = this.carry(next.players[slot], platforms);
      this.move(next.players[slot], pads[slot], blocked === null ? platforms : platforms.filter((p) => p.id !== blocked), slot === 1);
    }
    next.frame++;
    this.restore(next);
  }

  private nearest(hits: (V5CollisionHit | null)[], descending = false): V5CollisionHit | null {
    return hits.reduce<V5CollisionHit | null>((best, hit) => !hit ? best
      : !best || (descending ? hit.position > best.position : hit.position < best.position) ? hit : best, null);
  }

  private trace(side: V5Surface, perpendicular: number, from: number, to: number, player: V5PlayerState,
    platforms: readonly V5PlatformSurface[]): V5CollisionHit | null {
    const descending = side === "ceiling" || side === "rightWall";
    const hits = [this.world.trace(side, perpendicular, from, to, player.plane, this.layerIndices)];
    for (const box of platforms) {
      if ((side !== "floor" && box.bottom === undefined) || (box.plane !== null && box.plane !== player.plane)) continue;
      if ((side === "floor" && box.ignoreTop) || (side === "ceiling" && box.ignoreBottom) || (side === "leftWall" && box.ignoreLeft)
        || (side === "rightWall" && box.ignoreRight)) continue;
      const top = Math.floor(box.y / FIXED), bottom = box.bottom === undefined ? top : Math.floor(box.bottom / FIXED);
      const left = Math.floor(box.x / FIXED) - box.halfWidth, right = Math.floor(box.x / FIXED) + box.halfWidth;
      const position = side === "floor" ? top : side === "ceiling" ? bottom : side === "leftWall" ? left : right;
      const inRange = side === "ceiling" || side === "floor" ? perpendicular >= left && perpendicular < right : perpendicular >= top && perpendicular < bottom;
      if (inRange && position >= Math.min(from, to) && position <= Math.max(from, to)) {
        hits.push({ position, angle: side === "floor" ? 0 : side === "ceiling" ? 128 : side === "leftWall" ? 192 : 64, layer: -1, tile: box.id, flags: 0 });
      }
    }
    return this.nearest(hits, descending);
  }

  private floor(player: V5PlayerState, from: number, to: number, platforms: readonly V5PlatformSurface[] = []): V5CollisionHit | null {
    const x = Math.floor(player.x / FIXED);
    const hits = [-FOOT_OFFSET, FOOT_OFFSET].map((dx) => this.trace("floor", x + dx, from, to, player, platforms));
    return this.nearest(hits);
  }

  private carry(player: V5PlayerState, platforms: readonly V5PlatformSurface[]): number | null {
    const halfHeight = player.rolling ? BALL_HEIGHT : HALF_HEIGHT;
    if (!player.grounded && player.vy >= 0) {
      const foot = player.y + halfHeight * FIXED;
      const rising = platforms.filter((p) => !p.ignoreTop && (p.plane === null || p.plane === player.plane)
        && p.y < p.previousY && p.previousY >= foot && p.y <= foot
        && Math.abs(player.x - p.x) < (p.halfWidth + FOOT_OFFSET) * FIXED).sort((a, b) => b.y - a.y)[0];
      if (rising) {
        const head = Math.floor(player.y / FIXED) - halfHeight, targetHead = Math.floor(rising.y / FIXED) - 2 * halfHeight;
        const blocked = [-FOOT_OFFSET, FOOT_OFFSET].some((dx) => this.trace("ceiling",
          Math.floor(player.x / FIXED) + dx, head, targetHead, player, platforms));
        if (blocked) return rising.id;
        player.y = (Math.floor(rising.y / FIXED) - halfHeight) * FIXED;
        player.vy = 0; player.grounded = true; player.jumping = false; player.groundObject = rising.id;
        return null;
      }
    }
    const platform = platforms.find((p) => !p.ignoreTop && p.id === player.groundObject && (p.plane === null || p.plane === player.plane));
    if (!player.grounded || !platform) { player.groundObject = null; return null; }
    const foot = player.y + halfHeight * FIXED;
    if (Math.abs(foot - platform.previousY) > FIXED
      || Math.abs(player.x - platform.previousX) >= (platform.halfWidth + FOOT_OFFSET) * FIXED) {
      player.groundObject = null; return null;
    }
    const dx = platform.x - platform.previousX, dy = platform.y - platform.previousY;
    const obstacles = platforms.filter((p) => p.id !== platform.id);
    if (dx) {
      const edge = dx > 0 ? HALF_WIDTH : -HALF_WIDTH, y = Math.floor(player.y / FIXED);
      const wall = this.nearest([-halfHeight + 4, 0, halfHeight - 8].map((offset) =>
        this.trace(dx > 0 ? "leftWall" : "rightWall", y + offset,
          Math.floor(player.x / FIXED) + edge, Math.floor((player.x + dx) / FIXED) + edge, player, obstacles)), dx < 0);
      player.x = wall ? (wall.position - edge) * FIXED : player.x + dx;
    }
    if (dy) {
      const edge = dy > 0 ? halfHeight : -halfHeight, x = Math.floor(player.x / FIXED);
      const hit = this.nearest([-FOOT_OFFSET, FOOT_OFFSET].map((offset) =>
        this.trace(dy > 0 ? "floor" : "ceiling", x + offset,
          Math.floor(player.y / FIXED) + edge, Math.floor((player.y + dy) / FIXED) + edge, player, obstacles)), dy < 0);
      player.y = hit ? (hit.position - edge) * FIXED : player.y + dy;
      if (hit) { player.groundObject = null; player.grounded = false; player.spinCharge = 0; return platform.id; }
    }
    return null;
  }

  private curl(player: V5PlayerState): void {
    if (player.rolling) return;
    const normal = v5SurfaceNormal(player.grounded ? player.angle : 0);
    player.x += normal.x * (HALF_HEIGHT - BALL_HEIGHT) * FIXED;
    player.y += normal.y * (HALF_HEIGHT - BALL_HEIGHT) * FIXED;
    player.rolling = true;
  }

  private uncurl(player: V5PlayerState, platforms: readonly V5PlatformSurface[]): void {
    const normal = v5SurfaceNormal(player.grounded ? player.angle : 0);
    const vertical = normal.x === 0, direction = vertical ? -normal.y : -normal.x;
    const head = Math.floor((vertical ? player.y : player.x) / FIXED) + direction * BALL_HEIGHT;
    const perpendicular = Math.floor((vertical ? player.x : player.y) / FIXED);
    const expansion = 2 * (HALF_HEIGHT - BALL_HEIGHT);
    const blocked = [-FOOT_OFFSET, FOOT_OFFSET].some((offset) =>
      this.trace(vertical ? direction < 0 ? "ceiling" : "floor" : direction < 0 ? "rightWall" : "leftWall",
        perpendicular + offset, head, head + direction * expansion, player, platforms));
    if (blocked) return;
    player.x -= normal.x * (HALF_HEIGHT - BALL_HEIGHT) * FIXED;
    player.y -= normal.y * (HALF_HEIGHT - BALL_HEIGHT) * FIXED;
    player.rolling = false;
  }

  private updateWater(player: V5PlayerState, waterY: number | null): void {
    const underwater = waterY !== null && player.y > waterY;
    if (underwater !== player.underwater) {
      if (underwater) { player.vx = Math.trunc(player.vx / 2); player.vy = Math.trunc(player.vy / 4); }
      else if (player.vy < 0) player.vy = Math.max(-MAX_FALL, player.vy * 2);
      player.underwater = underwater;
    }
  }

  private move(player: V5PlayerState, pad: number, platforms: readonly V5PlatformSurface[], canFly: boolean): void {
    const underwater = player.underwater;
    const pressed = pad & ~player.pad;
    const locked = player.controlLock > 0;
    if (locked) player.controlLock--;
    const direction = locked ? 0 : Number(!!(pad & BTN.RIGHT)) - Number(!!(pad & BTN.LEFT));
    const wasGrounded = player.grounded, wasJumping = player.jumping;
    if (player.grounded && player.groundObject === null) { player.vx = v5GroundSpeed(player); player.vy = 0; }
    const speedBoost = player.speedTime > 0, maxSpeed = (speedBoost ? 12 * FIXED : MAX_SPEED) / (underwater ? 2 : 1);
    if (player.speedTime) player.speedTime--;
    const down = !!(pad & BTN.DOWN);
    let charging = false, released = false, jumped = false;
    if (player.grounded) {
      if (player.spinCharge > 0) {
        if (down) {
          player.spinCharge = Math.max(1, player.spinCharge - (player.spinCharge >>> 5));
          if (pressed & JUMP) player.spinCharge = Math.min(8 * FIXED, player.spinCharge + 2 * FIXED);
          charging = true;
        } else {
          player.vx = Math.trunc(player.facing * (8 * FIXED + Math.floor(player.spinCharge / 2)) / (underwater ? 2 : 1));
          player.spinCharge = 0; released = true;
        }
      } else if (down && Math.abs(player.vx) < 0x8000 && (pressed & JUMP)) {
        this.curl(player);
        player.spinCharge = 2 * FIXED; charging = true;
      } else if (down && Math.abs(player.vx) >= 0x8000) {
        this.curl(player);
      }
    }
    if (charging) {
      player.vx = 0;
    } else if (!locked && !released && player.grounded && player.rolling) {
      const friction = direction && player.vx * direction < 0 ? 0x2600 : 0x600;
      player.vx = Math.abs(player.vx) <= friction ? 0 : player.vx - Math.sign(player.vx) * friction;
    } else if (!released && direction) {
      player.facing = direction < 0 ? -1 : 1;
      const acceleration = (player.grounded && player.vx * direction < 0 ? 0x8000 : player.grounded ? (speedBoost ? 0x1800 : 0xc00) : 0x1800)
        / (underwater ? 2 : 1);
      if (player.vx * direction < maxSpeed) {
        player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx + direction * acceleration));
      }
    } else if (!locked && !released && player.grounded) {
      player.vx = Math.abs(player.vx) <= 0xc00 ? 0 : player.vx - Math.sign(player.vx) * 0xc00;
    }
    if (!charging && !released && player.grounded && (pressed & JUMP)) {
      this.curl(player);
      const along = v5SurfaceVelocity(player.vx, player.angle), away = v5SurfaceVelocity(underwater ? 0x38000 : 0x68000, (player.angle - 64) & 255);
      player.vx = Math.max(-MAX_FALL, Math.min(MAX_FALL, along.x + away.x));
      player.vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, along.y + away.y));
      player.grounded = false; player.jumping = true; jumped = true;
    }
    if (canFly && !player.grounded && !jumped && !player.flying && player.flightTime === 0 && (pressed & JUMP)) {
      if (player.rolling) this.uncurl(player, platforms);
      if (!player.rolling) { player.flying = true; player.jumping = false; }
    }
    const halfHeight = player.rolling ? BALL_HEIGHT : HALF_HEIGHT;
    if (!player.grounded) {
      if (player.flying) {
        if (player.flightTime < 480) {
          player.flightTime++;
          const flightSpeed = (underwater ? 1 : 2) * FIXED;
          player.vy = Math.max(-flightSpeed, Math.min(flightSpeed, player.vy + ((pad & JUMP) ? -0x2000 : 0x800)));
        } else player.vy = Math.min(MAX_FALL, player.vy + (underwater ? 0x1000 : 0x3800));
      } else {
        const cutoff = underwater ? -0x20000 : -0x40000;
        if (player.jumping && !(pad & JUMP) && player.vy < cutoff) player.vy = cutoff;
        player.vy = Math.min(MAX_FALL, player.vy + (underwater ? 0x1000 : 0x3800));
      }
    }
    if (!jumped && wasGrounded && player.groundObject === null) {
      moveV5Surface(player, (side, perpendicular, from, to) => this.trace(side, perpendicular, from, to, player, platforms), halfHeight);
      if (!player.grounded) { player.angle = 0; player.spinCharge = 0; }
      else {
        player.flying = false; player.flightTime = 0;
        if (player.rolling && !player.spinCharge && (wasJumping || Math.abs(v5GroundSpeed(player)) < 0x8000)) this.uncurl(player, platforms);
      }
      player.pad = pad;
      return;
    }
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(player.vx), Math.abs(player.vy)) / FIXED));
    const totalX = player.vx, totalY = player.vy;
    let landingSpeed: number | null = null;
    let movedX = 0, movedY = 0;
    for (let step = 1; step <= steps; step++) {
      const targetX = Math.trunc(totalX * step / steps), targetY = Math.trunc(totalY * step / steps);
      const dx = targetX - movedX, dy = targetY - movedY;
      movedX = targetX; movedY = targetY;
      const oldFoot = Math.floor(player.y / FIXED) + halfHeight;
      if (player.vx && dx) {
        const right = dx > 0;
        const edge = (right ? HALF_WIDTH : -HALF_WIDTH);
        const from = Math.floor(player.x / FIXED) + edge, to = Math.floor((player.x + dx) / FIXED) + edge;
        const y = Math.floor(player.y / FIXED);
        const wall = this.nearest([-halfHeight + 4, 0, halfHeight - 8].map((offset) =>
          this.trace(right ? "leftWall" : "rightWall", y + offset, from, to, player, platforms)), !right);
        if (wall) { player.x = (wall.position - edge) * FIXED; player.vx = 0; }
        else player.x += dx;
      }
      if (player.vy < 0 && dy < 0) {
        const from = Math.floor(player.y / FIXED) - halfHeight;
        const to = Math.floor((player.y + dy) / FIXED) - halfHeight;
        const x = Math.floor(player.x / FIXED);
        const roof = this.nearest([-FOOT_OFFSET, FOOT_OFFSET].map((offset) =>
          this.trace("ceiling", x + offset, from, to, player, platforms)), true);
        if (roof) { player.y = (roof.position + halfHeight) * FIXED; player.vy = 0; }
        else player.y += dy;
      } else if (player.vy > 0 && dy > 0) {
        const to = Math.floor((player.y + dy) / FIXED) + halfHeight;
        const ground = this.floor(player, oldFoot, to, platforms);
        if (ground) {
          const tangent = v5SurfaceVelocity(FIXED, ground.angle);
          landingSpeed = Math.max(-MAX_FALL, Math.min(MAX_FALL, Math.round((player.vx * tangent.x + player.vy * tangent.y) / FIXED)));
          player.y = (ground.position - halfHeight) * FIXED;
          player.vy = 0; player.grounded = true; player.jumping = false; player.angle = ground.angle;
          player.groundObject = ground.layer === -1 ? ground.tile : null;
        } else { player.y += dy; player.grounded = false; }
      }
      if (!jumped && (wasGrounded || player.grounded)) {
        const foot = Math.floor(player.y / FIXED) + halfHeight;
        const support = this.floor(player, foot - 2, foot + 2, platforms);
        if (support) {
          player.y = (support.position - halfHeight) * FIXED;
          player.vy = 0; player.grounded = true; player.jumping = false; player.angle = support.angle;
          player.groundObject = support.layer === -1 ? support.tile : null;
        } else player.grounded = false;
      }
    }
    if (!player.grounded) { player.angle = 0; player.spinCharge = 0; player.groundObject = null; }
    else {
      player.flying = false; player.flightTime = 0;
      if (player.rolling && !player.spinCharge && (wasJumping || Math.abs(player.vx) < 0x8000)) this.uncurl(player, platforms);
      if (landingSpeed !== null && player.groundObject === null) {
        const velocity = v5SurfaceVelocity(landingSpeed, player.angle);
        player.vx = velocity.x; player.vy = velocity.y;
      }
    }
    player.pad = pad;
  }
}
