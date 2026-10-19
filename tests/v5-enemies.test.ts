import { describe, expect, it } from "vitest";
import { V5Gameplay } from "../packages/engine/src/v5/gameplay.js";
import { createV5Enemies, tickV5Enemies, type V5Enemy } from "../packages/engine/src/v5/enemies.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

const enemy = (change: Partial<V5Enemy> = {}): V5Enemy => ({
  id: 10, kind: "cyclone", x: 128 * FP, y: 141 * FP, plane: null, facing: -1, sprite: 0, ...change,
});
function fixture(objects: V5Enemy[] = [enemy()]) {
  const { sim, world, tiles } = movementFixture();
  return { game: new V5Gameplay(sim, objects, 512 * FP), world, tiles };
}

describe("experimental v5 Angel Island enemies", () => {
  it("activates patrols for either player and freezes enemies when both are out of range or on another plane", () => {
    const { world } = fixture(), objects = [enemy({ x: 640 * FP })], state = createV5Enemies(objects);
    const tick = (players: { x: number; y: number; plane: number }[]) => tickV5Enemies(state, objects, players, world, [0], 512 * FP);
    tick([{ x: 64 * FP, y: 141 * FP, plane: 0 }]);
    expect(state.enemies[0].x).toBe(640 * FP); expect(state.enemies[0].timer).toBe(0);
    tick([{ x: 64 * FP, y: 141 * FP, plane: 0 }, { x: 600 * FP, y: 141 * FP, plane: 0 }]);
    expect(state.enemies[0].x).toBe(638 * FP);
    const filtered = [enemy({ plane: 1 })], filteredState = createV5Enemies(filtered);
    tickV5Enemies(filteredState, filtered, [{ x: 64 * FP, y: 141 * FP, plane: 0 }], world, [0], 512 * FP);
    expect(filteredState.enemies[0].timer).toBe(0);
  });

  it("turns before walls, ledges and the end of its patrol without moving through them", () => {
    const { world, tiles } = fixture(), object = enemy({ x: 128 * FP, facing: 1 }), state = createV5Enemies([object]);
    for (let y = 0; y < 10; y++) tiles[y * 64 + 10] = 0xf000;
    for (let i = 0; i < 40; i++) {
      tickV5Enemies(state, [object], [{ x: 64 * FP, y: 141 * FP, plane: 0 }], world, [0], 512 * FP);
      expect(state.enemies[0].x).toBeLessThanOrEqual(144 * FP);
    }
    const ledge = createV5Enemies([object]); tiles[10 * 64 + 9] = 0xffff;
    for (let i = 0; i < 200; i++) {
      tickV5Enemies(ledge, [object], [{ x: 64 * FP, y: 141 * FP, plane: 0 }], world, [0], 512 * FP);
      expect(ledge.enemies[0].x).toBeLessThan(144 * FP);
      expect(Math.abs(ledge.enemies[0].x - object.x)).toBeLessThanOrEqual(96 * FP);
    }
  });

  it("destroys enemies with a spin attack exactly once, with deterministic simultaneous-player ownership", () => {
    const { game } = fixture(), state = game.capture();
    for (const player of state.movement.players) Object.assign(player, {
      x: 128 * FP, y: 146 * FP, vx: 2 * FP, vy: 0, grounded: true, rolling: true,
    });
    game.restore(state);
    expect(game.tick([0, 0])).toEqual([{ type: "enemy", player: 0, object: 10 }]);
    expect(game.capture().enemyWorld.enemies[0].defeated).toBe(true);
    expect(game.tick([0, 0])).toEqual([]);
    expect(game.capture().players.every((player) => player.deaths === 0)).toBe(true);
  });

  it("bounces a downward jump off an enemy and lets power invincibility destroy enemies without curling", () => {
    for (const powerInvincible of [0, 1200]) {
      const { game } = fixture(), state = game.capture();
      Object.assign(state.movement.players[0], { x: 128 * FP, y: 110 * FP, vy: 2 * FP, rolling: !powerInvincible, jumping: !powerInvincible });
      state.players[0].powerInvincible = powerInvincible;
      state.movement.players[1].x = 256 * FP;
      game.restore(state);
      expect(game.tick([0, 0])).toEqual([{ type: "enemy", player: 0, object: 10 }]);
      expect(game.capture().movement.players[0]).toMatchObject({ vy: -4 * FP, grounded: false, jumping: true });
    }
  });

  it("damages a vulnerable player and scatters rings, but a player with no protection respawns", () => {
    for (const rings of [0, 10]) {
      const { game } = fixture(), state = game.capture();
      Object.assign(state.movement.players[0], { x: 128 * FP, y: 141 * FP, grounded: true });
      state.movement.players[1].x = 256 * FP; state.players[0].rings = rings; game.restore(state);
      expect(game.tick([0, 0])).toEqual([{ type: rings ? "hurt" : "respawn", player: 0, object: 10 }]);
      expect(game.capture().droppedRings).toHaveLength(rings);
      expect(game.capture().enemyWorld.enemies[0].defeated).toBe(false);
      expect(game.capture().players[0].deaths).toBe(rings ? 0 : 1);
    }
  });

  it("throws coconuts toward the closest player and fires spike volleys only after proximity activation", () => {
    for (const kind of ["saruder", "tulippon"] as const) {
      const objects = [enemy({ kind, x: 640 * FP })], { world } = fixture(objects), state = createV5Enemies(objects);
      for (let i = 0; i < 100; i++) tickV5Enemies(state, objects, [{ x: 64 * FP, y: 141 * FP, plane: 0 }], world, [0], 512 * FP);
      expect(state.projectiles).toEqual([]);
      for (let i = 0; i < 59; i++) tickV5Enemies(state, objects, [{ x: 700 * FP, y: 141 * FP, plane: 0 }], world, [0], 512 * FP);
      expect(state.projectiles).toEqual([]);
      tickV5Enemies(state, objects, [{ x: 700 * FP, y: 141 * FP, plane: 0 }], world, [0], 512 * FP);
      expect(state.projectiles).toHaveLength(kind === "saruder" ? 1 : 3);
      expect(state.enemies[0].facing).toBe(1);
      if (kind === "saruder") expect(state.projectiles[0].vx).toBe(2 * FP);
      const initialVelocity = state.projectiles[0].vy;
      tickV5Enemies(state, objects, [], world, [0], 512 * FP);
      expect(state.projectiles[0].vy).toBe(initialVelocity + (kind === "saruder" ? 0x1800 : 0));
    }
  });

  it("treats projectiles as hazards even while rolling, removes consumed shots and respects shields and invincibility", () => {
    for (const protection of ["rings", "shield", "invincible"] as const) {
      const { game } = fixture([enemy({ kind: "saruder", x: 300 * FP })]), state = game.capture();
      Object.assign(state.movement.players[0], { x: 64 * FP, y: 141 * FP, grounded: true, rolling: true, vx: FP });
      if (protection === "rings") state.players[0].rings = 10;
      if (protection === "shield") state.players[0].shield = "fire";
      if (protection === "invincible") state.players[0].powerInvincible = 120;
      state.enemyWorld.nextProjectileId = 1;
      state.enemyWorld.projectiles = [{ id: 0, source: 10, x: 64 * FP, y: 141 * FP, vx: 0, vy: 0, age: 0 }];
      game.restore(state); const events = game.tick([0, 0]);
      expect(events).toEqual(protection === "invincible" ? [] : [{ type: "hurt", player: 0, object: 10 }]);
      expect(game.capture().enemyWorld.projectiles).toHaveLength(protection === "invincible" ? 1 : 0);
      if (protection === "shield") expect(game.capture().players[0].shield).toBe("none");
    }
  });

  it("expires projectiles at 180 ticks and removes projectiles on tile impact", () => {
    const objects = [enemy({ kind: "saruder" })], { world } = fixture(objects), state = createV5Enemies(objects);
    state.nextProjectileId = 1;
    state.projectiles = [{ id: 0, source: 10, x: 64 * FP, y: 100 * FP, vx: 0, vy: 0, age: 178 }];
    tickV5Enemies(state, objects, [], world, [0], 512 * FP);
    expect(state.projectiles[0].age).toBe(179);
    tickV5Enemies(state, objects, [], world, [0], 512 * FP); expect(state.projectiles).toEqual([]);
    state.projectiles = [{ id: 0, source: 10, x: 64 * FP, y: 158 * FP, vx: 0, vy: 4 * FP, age: 0 }];
    tickV5Enemies(state, objects, [], world, [0], 512 * FP); expect(state.projectiles).toEqual([]);
  });

  it("restores enemy defeat, attack timers and in-flight projectiles and replays deterministically", () => {
    const objects = [enemy({ kind: "saruder", x: 300 * FP }), enemy({ id: 11, kind: "tulippon", x: 350 * FP })];
    const { game: a } = fixture(objects), { game: b } = fixture(objects);
    for (let frame = 0; frame < 65; frame++) a.tick([0, 0]);
    expect(a.capture().enemyWorld.projectiles.length).toBeGreaterThan(0);
    b.restore(a.capture());
    for (let frame = 0; frame < 240; frame++) {
      expect(a.tick([0, 0])).toEqual(b.tick([0, 0])); expect(a.capture()).toEqual(b.capture());
    }
    const before = a.capture();
    const invalid = a.capture(); invalid.enemyWorld.enemies[0].timer = 180;
    expect(() => a.restore(invalid)).toThrow("enemy snapshot"); expect(a.capture()).toEqual(before);
    const invalidShot = a.capture(); invalidShot.enemyWorld.nextProjectileId = 1;
    invalidShot.enemyWorld.projectiles = [{ id: 0, source: 999, x: 0, y: 0, vx: 0, vy: 0, age: 0 }];
    expect(() => a.restore(invalidShot)).toThrow("enemy snapshot"); expect(a.capture()).toEqual(before);
  });
});
