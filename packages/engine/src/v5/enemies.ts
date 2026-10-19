import { V5CollisionWorld } from "./collision.js";

const FP = 65536;
export interface V5Enemy {
  id: number;
  kind: "cyclone" | "saruder" | "tulippon";
  x: number;
  y: number;
  plane: number | null;
  facing: -1 | 1;
  sprite: number;
}
export interface V5EnemyState {
  id: number;
  x: number;
  y: number;
  facing: -1 | 1;
  timer: number;
  defeated: boolean;
}
export interface V5Projectile {
  id: number;
  source: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}
export interface V5EnemyWorld {
  enemies: V5EnemyState[];
  projectiles: V5Projectile[];
  nextProjectileId: number;
}

export function createV5Enemies(objects: readonly V5Enemy[]): V5EnemyWorld {
  return { enemies: objects.map(({ id, x, y, facing }) => ({ id, x, y, facing, timer: 0, defeated: false })),
    projectiles: [], nextProjectileId: 0 };
}

export function validateV5Enemies(state: V5EnemyWorld, objects: readonly V5Enemy[]): void {
  if (!state || !Array.isArray(state.enemies) || state.enemies.length !== objects.length
    || !Number.isSafeInteger(state.nextProjectileId) || state.nextProjectileId < 0
    || state.enemies.some((enemy, i) => !enemy || enemy.id !== objects[i].id
      || ![enemy.x, enemy.y, enemy.timer].every(Number.isInteger) || Math.abs(enemy.x - objects[i].x) > 96 * FP
      || (objects[i].kind !== "cyclone" && enemy.x !== objects[i].x)
      || enemy.y !== objects[i].y || (enemy.facing !== -1 && enemy.facing !== 1) || typeof enemy.defeated !== "boolean"
      || enemy.timer < 0 || enemy.timer >= 180)
    || !Array.isArray(state.projectiles) || state.projectiles.length > 512
    || state.projectiles.some((shot) => !shot || ![shot.id, shot.source, shot.x, shot.y, shot.vx, shot.vy, shot.age].every(Number.isSafeInteger)
      || shot.id < 0 || shot.id >= state.nextProjectileId || !objects.some((o) => o.id === shot.source && o.kind !== "cyclone")
      || Math.abs(shot.x) > 0x70000000 || Math.abs(shot.y) > 0x70000000
      || Math.abs(shot.vx) > 8 * FP || Math.abs(shot.vy) > 8 * FP || shot.age < 0 || shot.age >= 180)
    || new Set(state.projectiles.map((shot) => shot.id)).size !== state.projectiles.length) {
    throw new Error("invalid v5 enemy snapshot");
  }
}

/** Experimental stage behaviors: short patrols, proximity-triggered coconut throws and spike volleys. */
export function tickV5Enemies(state: V5EnemyWorld, objects: readonly V5Enemy[],
  players: readonly { x: number; y: number; plane: number }[], world: V5CollisionWorld, layers: readonly number[], deathY: number): void {
  state.projectiles = state.projectiles.filter((shot) => {
    const source = objects.find((object) => object.id === shot.source);
    if (!source) throw new Error("missing v5 projectile source");
    if (++shot.age >= 180 || shot.y > deathY) return false;
    const gravity = source.kind === "saruder" ? 0x1800 : 0;
    shot.vy = Math.min(8 * FP, shot.vy + gravity);
    const plane = source.plane ?? 0, x = Math.floor(shot.x / FP), y = Math.floor(shot.y / FP),
      nextX = Math.floor((shot.x + shot.vx) / FP), nextY = Math.floor((shot.y + shot.vy) / FP);
    if ((shot.vx && world.trace(shot.vx > 0 ? "leftWall" : "rightWall", y, x, nextX, plane, layers))
      || (shot.vy && world.trace(shot.vy > 0 ? "floor" : "ceiling", nextX, y, nextY, plane, layers))) return false;
    shot.x += shot.vx; shot.y += shot.vy;
    if (Math.abs(shot.x) > 0x70000000 || Math.abs(shot.y) > 0x70000000) throw new Error("v5 projectile coordinate overflow");
    return true;
  });
  state.enemies.forEach((enemy, index) => {
    if (enemy.defeated) return;
    const object = objects[index];
    const target = players.filter((p) => (object.plane === null || object.plane === p.plane)
      && Math.abs(p.x - enemy.x) <= 320 * FP && Math.abs(p.y - enemy.y) <= 192 * FP)
      .reduce<(typeof players)[number] | null>((best, p) => !best || Math.abs(p.x - enemy.x) < Math.abs(best.x - enemy.x) ? p : best, null);
    if (!target) return;
    enemy.timer = (enemy.timer + 1) % 180;
    if (object.kind === "cyclone") {
      const vx = enemy.facing * 2 * FP, from = Math.floor(enemy.x / FP) + enemy.facing * 16,
        to = Math.floor((enemy.x + vx) / FP) + enemy.facing * 16, y = Math.floor(enemy.y / FP), plane = object.plane ?? target.plane;
      const wall = world.trace(vx > 0 ? "leftWall" : "rightWall", y, from, to, plane, layers);
      const floor = world.trace("floor", to, y + 8, y + 24, plane, layers);
      if (wall || !floor || Math.abs(enemy.x + vx - object.x) > 96 * FP) enemy.facing = enemy.facing === 1 ? -1 : 1;
      else enemy.x += vx;
    } else {
      enemy.facing = target.x < enemy.x ? -1 : 1;
      if (enemy.timer === 60) {
        const velocities = object.kind === "saruder" ? [{ vx: enemy.facing * 2 * FP, vy: -3 * FP }]
          : [-1, 0, 1].map((direction) => ({ vx: direction * FP, vy: -3 * FP }));
        if (state.nextProjectileId > Number.MAX_SAFE_INTEGER - velocities.length) throw new Error("v5 projectile id overflow");
        for (const { vx, vy } of velocities) state.projectiles.push({ id: state.nextProjectileId++, source: enemy.id,
          x: enemy.x, y: enemy.y - (object.kind === "saruder" ? 24 : 30) * FP, vx, vy, age: 0 });
      }
    }
  });
}
