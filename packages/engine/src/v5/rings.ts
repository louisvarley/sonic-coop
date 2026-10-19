import { sin256LookupTable, cos256LookupTable } from "../math.js";
import { V5CollisionWorld } from "./collision.js";

const FP = 65536;
export interface V5DroppedRing {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  plane: number;
  age: number;
}

export function scatterV5Rings(x: number, y: number, plane: number, count: number, firstId: number): V5DroppedRing[] {
  return Array.from({ length: Math.min(32, count) }, (_, index) => {
    const angle = (192 + (index % 16) * 16) & 255, speed = index < 16 ? 4 : 2;
    return { id: firstId + index, x, y, vx: cos256LookupTable[angle] * speed * 256,
      vy: sin256LookupTable[angle] * speed * 256, plane, age: 0 };
  });
}

export function tickV5DroppedRings(rings: readonly V5DroppedRing[], world: V5CollisionWorld,
  layers: readonly number[], deathY: number): V5DroppedRing[] {
  return rings.flatMap((ring) => {
    const next = { ...ring, age: ring.age + 1 };
    if (next.age >= 256 || next.y > deathY) return [];
    next.vy = Math.min(16 * FP, next.vy + 0x1800);
    const dx = next.vx, dy = next.vy, steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / FP));
    let oldX = 0, oldY = 0, horizontal = true, vertical = true;
    for (let step = 1; step <= steps; step++) {
      const moveX = Math.trunc(dx * step / steps), moveY = Math.trunc(dy * step / steps);
      if (horizontal && dx) {
        const edge = dx > 0 ? 4 : -4;
        const wall = world.trace(dx > 0 ? "leftWall" : "rightWall", Math.floor(next.y / FP),
          Math.floor(next.x / FP) + edge, Math.floor((next.x + moveX - oldX) / FP) + edge, next.plane, layers);
        if (wall) {
          next.x = (wall.position - edge) * FP; next.vx = -Math.trunc(next.vx * 3 / 4); horizontal = false;
        } else next.x += moveX - oldX;
      }
      if (vertical && dy) {
        const edge = dy > 0 ? 4 : -4;
        const hit = world.trace(dy > 0 ? "floor" : "ceiling", Math.floor(next.x / FP),
          Math.floor(next.y / FP) + edge, Math.floor((next.y + moveY - oldY) / FP) + edge, next.plane, layers);
        if (hit) {
          next.y = (hit.position - edge) * FP; next.vy = -Math.trunc(next.vy * 3 / 4); vertical = false;
        } else next.y += moveY - oldY;
      }
      oldX = moveX; oldY = moveY;
    }
    if (Math.abs(next.x) > 0x70000000 || Math.abs(next.y) > 0x70000000) throw new Error("v5 dropped ring coordinate overflow");
    return [next];
  });
}

export function validateV5DroppedRings(rings: unknown, nextId: unknown): asserts rings is V5DroppedRing[] {
  if (!Number.isSafeInteger(nextId) || Number(nextId) < 0 || !Array.isArray(rings) || rings.length > 2048
    || rings.some((ring: V5DroppedRing) => !ring || ![ring.id, ring.x, ring.y, ring.vx, ring.vy, ring.plane, ring.age].every(Number.isSafeInteger)
      || ring.id < 0 || ring.id >= Number(nextId) || Math.abs(ring.x) > 0x70000000 || Math.abs(ring.y) > 0x70000000
      || Math.abs(ring.vx) > 16 * FP || Math.abs(ring.vy) > 16 * FP || (ring.plane !== 0 && ring.plane !== 1)
      || ring.age < 0 || ring.age >= 256)
    || new Set(rings.map((ring: V5DroppedRing) => ring.id)).size !== rings.length) {
    throw new Error("invalid v5 dropped ring snapshot");
  }
}
