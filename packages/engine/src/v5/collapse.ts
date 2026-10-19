import type { V5CollisionLayer } from "./collision.js";
import type { V5PlayerState } from "./movement.js";
import { v5CollisionMode } from "./path-grip.js";

const FP = 65536;
export interface V5Collapse {
  id: number;
  kind: "collapse";
  x: number;
  y: number;
  plane: number | null;
  width: number;
  height: number;
  layer: number;
  direction: 0 | 1;
  delay: number;
  respawn: boolean;
}
export interface V5CollapseState { id: number; started: number | null }
export interface V5RemovedTile { layer: number; index: number }

export function v5CollapseTiles(object: V5Collapse, layers: readonly V5CollisionLayer[], started: number | null, frame: number):
  (V5RemovedTile & { fallTime: number })[] {
  if (started === null) return [];
  const layer = layers[object.layer], columns = object.width / 16, rows = object.height / 16;
  const left = Math.floor(object.x / FP / 16) - Math.floor(columns / 2);
  const top = Math.floor(object.y / FP / 16) - Math.floor(rows / 2);
  const tiles = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const wave = 3 * (rows + 2 * (object.direction === 0 ? x : columns - x) - y);
    const fallTime = frame - started - object.delay - wave;
    const index = (top + y) * layer.width + left + x;
    if (fallTime >= 0 && layer.tiles[index] !== 0xffff) tiles.push({ layer: object.layer, index, fallTime });
  }
  return tiles;
}

export function validateV5Collapses(objects: readonly V5Collapse[], layers: readonly V5CollisionLayer[]): void {
  const occupied = new Set<string>();
  for (const object of objects) {
    const layer = layers[object.layer];
    if (!Number.isInteger(object.width) || object.width < 16 || object.width > 512 || object.width % 16
      || !Number.isInteger(object.height) || object.height < 16 || object.height > 512 || object.height % 16
      || !Number.isInteger(object.layer) || !layer || (object.direction !== 0 && object.direction !== 1)
      || !Number.isInteger(object.delay) || object.delay < 0 || object.delay > 3600 || typeof object.respawn !== "boolean") {
      throw new Error("invalid v5 collapsing platform");
    }
    const left = Math.floor(object.x / FP / 16) - Math.floor(object.width / 32);
    const top = Math.floor(object.y / FP / 16) - Math.floor(object.height / 32);
    if (left < 0 || top < 0 || left + object.width / 16 > layer.width || top + object.height / 16 > layer.height) {
      throw new Error("v5 collapsing platform outside layer");
    }
    for (const tile of v5CollapseTiles(object, layers, 0, 10000)) {
      const key = `${tile.layer}:${tile.index}`;
      if (occupied.has(key)) throw new Error("overlapping v5 collapsing platforms");
      occupied.add(key);
    }
  }
}

export function validateV5CollapseState(state: readonly V5CollapseState[], objects: readonly V5Collapse[], frame: number): void {
  if (!Array.isArray(state) || state.length !== objects.length || state.some((entry, i) =>
    !entry || entry.id !== objects[i].id || (entry.started !== null
      && (!Number.isSafeInteger(entry.started) || entry.started < 0 || entry.started > frame)))) {
    throw new Error("invalid v5 collapse snapshot");
  }
}

export function tickV5Collapses(state: V5CollapseState[], objects: readonly V5Collapse[], players: readonly V5PlayerState[], frame: number): void {
  state.forEach((entry, index) => {
    const object = objects[index];
    if (entry.started !== null) {
      const complete = frame - entry.started > object.delay + 3 * (object.height / 16 + 2 * object.width / 16) + 120;
      if (object.respawn && complete && players.every((p) => Math.abs(p.x - object.x) > 512 * FP || Math.abs(p.y - object.y) > 384 * FP)) {
        entry.started = null;
      }
      return;
    }
    if (players.some((p) => p.grounded && v5CollisionMode(p.angle) === 0 && (object.plane === null || p.plane === object.plane)
      && Math.abs(p.x - object.x) <= (object.width / 2 + 6) * FP
      && p.y + (p.rolling ? 14 : 19) * FP >= object.y - (object.height / 2 + 16) * FP
      && p.y - (p.rolling ? 14 : 19) * FP <= object.y + object.height / 2 * FP)) entry.started = frame;
  });
}
