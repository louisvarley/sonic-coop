import { cos256LookupTable, sin256LookupTable } from "../math.js";
import type { V5CollisionWorld } from "./collision.js";
import type { V5PlayerState } from "./movement.js";

const FP = 65536;
export interface V5SwingRope {
  id: number;
  kind: "swing-rope";
  x: number;
  y: number;
  plane: number | null;
  links: number;
  phase: number;
  sprite: number;
}
export function v5SwingRopeAt(object: V5SwingRope, frame: number): { x: number; y: number; angle: number } {
  const angle = Math.trunc(sin256LookupTable[Math.floor(((frame % 512) + object.phase) / 2) & 255] / 4) & 255;
  return { x: object.x + sin256LookupTable[angle] * object.links * 4096,
    y: object.y + cos256LookupTable[angle] * object.links * 4096, angle };
}

export function v5RopeVelocity(object: V5SwingRope, frame: number): { vx: number; vy: number } {
  const now = v5SwingRopeAt(object, frame), previous = v5SwingRopeAt(object, Math.max(0, frame - 1));
  return { vx: Math.max(-16 * FP, Math.min(16 * FP, now.x - previous.x)),
    vy: Math.max(-16 * FP, Math.min(16 * FP, now.y - previous.y)) };
}

export function v5RopeBlocked(world: V5CollisionWorld, layers: readonly number[], player: V5PlayerState, x: number, y: number): boolean {
  const dx = x - player.x, dy = y - player.y;
  if (dx) {
    const edge = dx > 0 ? 9 : -9;
    if ([-15, 0, 15].some((offset) => world.trace(dx > 0 ? "leftWall" : "rightWall", Math.floor(player.y / FP) + offset,
      Math.floor(player.x / FP) + edge, Math.floor(x / FP) + edge, player.plane, layers))) return true;
  }
  if (dy) {
    const edge = dy > 0 ? 19 : -19;
    if ([-6, 6].some((offset) => world.trace(dy > 0 ? "floor" : "ceiling", Math.floor(x / FP) + offset,
      Math.floor(player.y / FP) + edge, Math.floor(y / FP) + edge, player.plane, layers))) return true;
  }
  return false;
}
