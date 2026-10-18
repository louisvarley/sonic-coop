// Experimental upright movement only: not Sonic 3 path-grip, rolling, loops or object behavior.
import { BTN } from "../input.js";
import { V5CollisionWorld, type V5CollisionHit } from "./collision.js";

const FIXED = 65536;
const HALF_WIDTH = 9, HALF_HEIGHT = 19, FOOT_OFFSET = 6;
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
    })) };
    this.restore(this.state);
  }

  capture(): V5MovementState {
    return { frame: this.state.frame, players: this.state.players.map((player) => ({ ...player })) };
  }

  restore(state: V5MovementState): void {
    if (!state || !Number.isSafeInteger(state.frame) || state.frame < 0 || !Array.isArray(state.players)
      || state.players.length !== this.state.players.length || state.players.some((p) => !p
        || ![p.x, p.y, p.vx, p.vy, p.angle, p.plane, p.pad].every(Number.isInteger)
        || Math.abs(p.x) > 0x70000000 || Math.abs(p.y) > 0x70000000
        || Math.abs(p.vx) > MAX_FALL || Math.abs(p.vy) > MAX_FALL
        || typeof p.grounded !== "boolean" || typeof p.jumping !== "boolean" || p.angle < 0 || p.angle > 255
        || (p.plane !== 0 && p.plane !== 1) || p.pad < 0 || p.pad > 0xffff)) {
      throw new Error("invalid RSDKv5 movement snapshot");
    }
    this.state = { frame: state.frame, players: state.players.map((player) => ({ ...player })) };
  }

  tick(pads: readonly number[]): void {
    if (pads.length !== this.state.players.length || pads.some((pad) => !Number.isInteger(pad) || pad < 0 || pad > 0xffff)
      || this.state.frame >= Number.MAX_SAFE_INTEGER) throw new Error("invalid RSDKv5 movement inputs");
    // Work on a copy so a failed collision query or coordinate overflow cannot leave half a tick applied.
    const next = this.capture();
    for (let slot = 0; slot < next.players.length; slot++) this.move(next.players[slot], pads[slot]);
    next.frame++;
    this.restore(next);
  }

  private nearest(hits: (V5CollisionHit | null)[], descending = false): V5CollisionHit | null {
    return hits.reduce<V5CollisionHit | null>((best, hit) => !hit ? best
      : !best || (descending ? hit.position > best.position : hit.position < best.position) ? hit : best, null);
  }

  private floor(player: V5PlayerState, from: number, to: number): V5CollisionHit | null {
    const x = Math.floor(player.x / FIXED);
    return this.nearest([-FOOT_OFFSET, FOOT_OFFSET].map((dx) =>
      this.world.trace("floor", x + dx, from, to, player.plane, this.layerIndices)));
  }

  private move(player: V5PlayerState, pad: number): void {
    const pressed = pad & ~player.pad;
    const direction = Number(!!(pad & BTN.RIGHT)) - Number(!!(pad & BTN.LEFT));
    const wasGrounded = player.grounded;
    if (direction) {
      const acceleration = player.grounded && player.vx * direction < 0 ? 0x8000 : player.grounded ? 0xc00 : 0x1800;
      if (player.vx * direction < MAX_SPEED) {
        player.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, player.vx + direction * acceleration));
      }
    } else if (player.grounded) {
      player.vx = Math.abs(player.vx) <= 0xc00 ? 0 : player.vx - Math.sign(player.vx) * 0xc00;
    }
    let jumped = false;
    if (player.grounded && (pressed & JUMP)) {
      player.grounded = false; player.vy = -0x68000; player.jumping = true; jumped = true;
    }
    if (!player.grounded) {
      if (player.jumping && !(pad & JUMP) && player.vy < -0x40000) player.vy = -0x40000;
      player.vy = Math.min(MAX_FALL, player.vy + 0x3800);
    }
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(player.vx), Math.abs(player.vy)) / FIXED));
    const totalX = player.vx, totalY = player.vy;
    let movedX = 0, movedY = 0;
    for (let step = 1; step <= steps; step++) {
      const targetX = Math.trunc(totalX * step / steps), targetY = Math.trunc(totalY * step / steps);
      const dx = targetX - movedX, dy = targetY - movedY;
      movedX = targetX; movedY = targetY;
      const oldFoot = Math.floor(player.y / FIXED) + HALF_HEIGHT;
      if (player.vx && dx) {
        const right = dx > 0;
        const edge = (right ? HALF_WIDTH : -HALF_WIDTH);
        const from = Math.floor(player.x / FIXED) + edge, to = Math.floor((player.x + dx) / FIXED) + edge;
        const y = Math.floor(player.y / FIXED);
        const wall = this.nearest([-HALF_HEIGHT + 4, 0, HALF_HEIGHT - 8].map((offset) =>
          this.world.trace(right ? "leftWall" : "rightWall", y + offset, from, to, player.plane, this.layerIndices)), !right);
        if (wall) { player.x = (wall.position - edge) * FIXED; player.vx = 0; }
        else player.x += dx;
      }
      if (player.vy < 0 && dy < 0) {
        const from = Math.floor(player.y / FIXED) - HALF_HEIGHT;
        const to = Math.floor((player.y + dy) / FIXED) - HALF_HEIGHT;
        const x = Math.floor(player.x / FIXED);
        const roof = this.nearest([-FOOT_OFFSET, FOOT_OFFSET].map((offset) =>
          this.world.trace("ceiling", x + offset, from, to, player.plane, this.layerIndices)), true);
        if (roof) { player.y = (roof.position + HALF_HEIGHT) * FIXED; player.vy = 0; }
        else player.y += dy;
      } else if (player.vy > 0 && dy > 0) {
        const to = Math.floor((player.y + dy) / FIXED) + HALF_HEIGHT;
        const ground = this.floor(player, oldFoot, to);
        if (ground) {
          player.y = (ground.position - HALF_HEIGHT) * FIXED;
          player.vy = 0; player.grounded = true; player.jumping = false; player.angle = ground.angle;
        } else { player.y += dy; player.grounded = false; }
      }
      if (!jumped && (wasGrounded || player.grounded)) {
        const foot = Math.floor(player.y / FIXED) + HALF_HEIGHT;
        const support = this.floor(player, foot - 2, foot + 2);
        if (support) {
          player.y = (support.position - HALF_HEIGHT) * FIXED;
          player.vy = 0; player.grounded = true; player.jumping = false; player.angle = support.angle;
        } else player.grounded = false;
      }
    }
    if (!player.grounded) player.angle = 0;
    player.pad = pad;
  }
}
