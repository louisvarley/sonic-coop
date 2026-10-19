import { cos256LookupTable, sin256LookupTable } from "../math.js";
import type { V5CollisionHit, V5Surface } from "./collision.js";
import type { V5PlayerState } from "./movement.js";

const FP = 65536;
const sides: V5Surface[] = ["floor", "rightWall", "ceiling", "leftWall"];
type Trace = (side: V5Surface, perpendicular: number, from: number, to: number) => V5CollisionHit | null;
export function v5CollisionMode(angle: number): number { return ((angle + 32) & 255) >>> 6; }
export function v5SurfaceNormal(angle: number): { x: number; y: number } {
  const mode = v5CollisionMode(angle);
  return { x: mode === 1 ? -1 : mode === 3 ? 1 : 0, y: mode === 0 ? 1 : mode === 2 ? -1 : 0 };
}
export function v5SurfaceVelocity(speed: number, angle: number): { x: number; y: number } {
  const cos = cos256LookupTable[angle], sin = sin256LookupTable[angle], length = Math.hypot(cos, sin);
  return { x: Math.round(speed * cos / length), y: Math.round(speed * sin / length) };
}
export function v5GroundSpeed(player: V5PlayerState): number {
  const cos = cos256LookupTable[player.angle], sin = sin256LookupTable[player.angle];
  return Math.round(Math.hypot(player.vx, player.vy)) * Math.sign(player.vx * cos + player.vy * sin);
}
export function v5PlayerHalfSize(player: V5PlayerState): { x: number; y: number } {
  const height = player.rolling ? 14 : 19, sideways = player.grounded && (v5CollisionMode(player.angle) & 1);
  return { x: sideways ? height : 9, y: sideways ? 9 : height };
}
const angleDistance = (a: number, b: number) => Math.abs(((a - b + 128) & 255) - 128);

function support(player: V5PlayerState, trace: Trace, height: number): V5CollisionHit | null {
  const mode = v5CollisionMode(player.angle), n = v5SurfaceNormal(player.angle), vertical = !(mode & 1);
  const edge = Math.floor((vertical ? player.y : player.x) / FP) + (vertical ? n.y : n.x) * height;
  const perpendicular = Math.floor((vertical ? player.x : player.y) / FP), direction = vertical ? n.y : n.x;
  const hits = [-6, 6].map((offset) => trace(sides[mode], perpendicular + offset,
    edge - direction * 14, edge + direction * 14))
    .filter((hit): hit is V5CollisionHit => hit !== null && angleDistance(hit.angle, player.angle) < 64);
  return hits.reduce<V5CollisionHit | null>((best, hit) => !best || direction * hit.position < direction * best.position ? hit : best, null);
}

/** Experimental four-quadrant tile grip; object platforms still use their separate upright solver. */
export function moveV5Surface(player: V5PlayerState, trace: Trace, height: number): void {
  const downhill = player.vx * sin256LookupTable[player.angle] >= 0;
  const slopeForce = (player.rolling ? downhill ? 0x5000 : 0x1400 : 0x2000) / (player.underwater ? 2 : 1);
  const speed = Math.max(-16 * FP, Math.min(16 * FP, player.vx + Math.trunc(sin256LookupTable[player.angle] * slopeForce / 256)));
  const steps = Math.max(1, Math.ceil(Math.abs(speed) / FP));
  player.vy = 0;
  for (let step = 0; step < steps; step++) {
    const velocity = v5SurfaceVelocity(speed, player.angle), dx = Math.trunc(velocity.x / steps), dy = Math.trunc(velocity.y / steps);
    const oldX = player.x, oldY = player.y;
    const mode = v5CollisionMode(player.angle), horizontal = Math.abs(dx) >= Math.abs(dy);
    const delta = horizontal ? dx : dy, edge = Math.sign(delta) * 9;
    const from = Math.floor((horizontal ? oldX : oldY) / FP) + edge;
    const to = Math.floor(((horizontal ? oldX : oldY) + delta) / FP) + edge;
    const obstacle = delta ? trace(horizontal ? delta > 0 ? "leftWall" : "rightWall" : delta > 0 ? "floor" : "ceiling",
      Math.floor((horizontal ? oldY : oldX) / FP), from, to) : null;
    if (obstacle && angleDistance(obstacle.angle, player.angle) >= 64) {
      if (horizontal) player.x = (obstacle.position - edge) * FP; else player.y = (obstacle.position - edge) * FP;
      player.vx = player.vy = 0;
      return;
    }
    player.x += dx; player.y += dy;
    const hit = support(player, trace, height);
    if (!hit) {
      player.grounded = false; player.vx = velocity.x; player.vy = velocity.y; return;
    }
    if (mode & 1) player.x = (hit.position - (mode === 1 ? -height : height)) * FP;
    else player.y = (hit.position - (mode === 0 ? height : -height)) * FP;
    player.angle = hit.angle;
    player.groundObject = mode === 0 && hit.layer === -1 ? hit.tile : null;
    if (v5CollisionMode(player.angle) !== mode) {
      const rotated = support(player, trace, height), normal = v5SurfaceNormal(player.angle);
      if (!rotated) { player.grounded = false; player.vx = velocity.x; player.vy = velocity.y; return; }
      if (normal.x) player.x = (rotated.position - normal.x * height) * FP;
      else player.y = (rotated.position - normal.y * height) * FP;
      player.angle = rotated.angle;
    }
    const projected = v5SurfaceVelocity(speed, player.angle);
    player.vx = projected.x; player.vy = projected.y;
    if (v5CollisionMode(player.angle) !== 0 && Math.abs(speed) < 0x28000) {
      player.grounded = false; player.controlLock = 16; return;
    }
  }
}
