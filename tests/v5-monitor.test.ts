import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

const monitor = (item = 0, x = 128): Extract<V5Object, { kind: "monitor" }> => ({
  id: 1, kind: "monitor", x: x * FP, y: 144 * FP, plane: null, item, sprite: 0,
});
function fixture(objects: V5Object[] = [monitor()]) {
  const { sim } = movementFixture();
  return new V5Gameplay(sim, objects, 512 * FP);
}
function attack(game: V5Gameplay, slot = 0, x = 128) {
  const state = game.capture();
  Object.assign(state.movement.players[slot], { x: x * FP, y: 113 * FP, vy: 2 * FP, rolling: true, jumping: true, grounded: false });
  game.restore(state);
  return game.tick([0, 0]);
}

describe("experimental shared item boxes", () => {
  it("is a solid box until attacked, rather than an automatic touch pickup", () => {
    const game = fixture(), initial = game.capture();
    initial.movement.players[1].x = 256 * FP; game.restore(initial);
    for (let frame = 0; frame < 180; frame++) game.tick([BTN.RIGHT, 0]);
    expect(game.capture().broken).toEqual([]);
    expect(game.capture().movement.players[0].x / FP).toBe(128 - 16 - 9);
    expect(game.capture().players[0].rings).toBe(0);
    game.tick([BTN.DOWN | BTN.A, 0]);
    expect(game.capture().broken).toEqual([1]);
    expect(game.capture().players[0].rings).toBe(10);
    for (let frame = 0; frame < 30; frame++) game.tick([BTN.RIGHT, 0]);
    expect(game.capture().players[0].rings).toBe(10);
  });

  it("bounces a falling attacker, rewards either player and never dispenses a shared box twice", () => {
    for (const slot of [0, 1]) {
      const game = fixture();
      expect(attack(game, slot)).toContainEqual({ type: "monitor", player: slot, object: 1 });
      expect(game.capture().movement.players[slot]).toMatchObject({ vy: -4 * FP, grounded: false, rolling: true, groundObject: null });
      expect(game.capture().players[slot].rings).toBe(10);
      expect(attack(game, 1 - slot).some((event) => event.type === "monitor")).toBe(false);
      expect(game.capture().players[1 - slot].rings).toBe(0);
    }
  });

  it("resolves simultaneous hits deterministically and drops another player supported by the broken box", () => {
    const game = fixture(), state = game.capture();
    for (const p of state.movement.players) Object.assign(p, {
      x: 128 * FP, y: 113 * FP, vy: 2 * FP, rolling: true, jumping: true, grounded: false,
    });
    game.restore(state);
    expect(game.tick([0, 0]).filter((event) => event.type === "monitor")).toEqual([{ type: "monitor", player: 0, object: 1 }]);
    expect(game.capture().players.map((p) => p.rings)).toEqual([10, 0]);
    expect(game.capture().movement.players.every((p) => p.groundObject === null)).toBe(true);
  });

  it("gives each shield type, absorbs a hit without losing rings and consumes the shield exactly once", () => {
    const shields = ["blue", "bubble", "fire", "lightning"];
    for (let item = 1; item <= 4; item++) {
      const hazard: V5Object = { id: 2, kind: "hazard", x: 300 * FP, y: 100 * FP, plane: null, halfWidth: 8, halfHeight: 8 };
      const game = fixture([monitor(item), hazard]);
      attack(game); expect(game.capture().players[0].shield).toBe(shields[item - 1]);
      const state = game.capture();
      state.players[0].rings = 20;
      Object.assign(state.movement.players[0], { x: 300 * FP, y: 100 * FP, vx: 0, vy: 0, groundObject: null });
      game.restore(state);
      expect(game.tick([0, 0])).toContainEqual({ type: "hurt", player: 0, object: 2 });
      expect(game.capture().players[0]).toMatchObject({ shield: "none", rings: 20, invincible: 120, deaths: 0 });
    }
  });

  it("applies exactly twenty seconds of invincibility or speed shoes, and extra lives for all character icons", () => {
    const invincible = fixture([monitor(5)]); attack(invincible);
    expect(invincible.capture().players[0].powerInvincible).toBe(1200);
    for (let frame = 0; frame < 1200; frame++) invincible.tick([0, 0]);
    expect(invincible.capture().players[0].powerInvincible).toBe(0);
    const fast = fixture([monitor(6)]); attack(fast);
    expect(fast.capture().movement.players[0].speedTime).toBe(1200);
    for (let frame = 0; frame < 100; frame++) fast.tick([BTN.RIGHT, 0]);
    expect(fast.capture().movement.players[0].vx).toBeGreaterThan(6 * FP);
    expect(fast.capture().movement.players[0].speedTime).toBe(1100);
    for (const item of [7, 8, 9]) {
      const game = fixture([monitor(item)]); attack(game);
      expect(game.capture().players[0].lives).toBe(4);
    }
  });

  it("protects invincible players from hazards but clears temporary powerups on falling death", () => {
    const hazard: V5Object = { id: 2, kind: "hazard", x: 300 * FP, y: 100 * FP, plane: null, halfWidth: 8, halfHeight: 8 };
    const game = fixture([monitor(5), hazard]); attack(game);
    const state = game.capture();
    Object.assign(state.movement.players[0], { x: 300 * FP, y: 100 * FP, vy: 0, speedTime: 100 });
    state.players[0].shield = "fire"; game.restore(state);
    expect(game.tick([0, 0]).filter((event) => event.type === "hurt" || event.type === "respawn")).toEqual([]);
    const fallen = game.capture(); fallen.movement.players[0].y = 600 * FP; game.restore(fallen);
    expect(game.tick([0, 0])).toContainEqual({ type: "respawn", player: 0, object: null });
    expect(game.capture().players[0]).toMatchObject({ shield: "none", powerInvincible: 0, lives: 2 });
    expect(game.capture().movement.players[0].speedTime).toBe(0);
    expect(game.capture().broken).toEqual([1]);
  });

  it("restores broken boxes, shield ownership and powerup timers atomically", () => {
    const a = fixture([monitor(4)]), b = fixture([monitor(4)]);
    attack(a, 1); b.restore(a.capture());
    for (let frame = 0; frame < 120; frame++) {
      const pads = [0, frame < 60 ? BTN.RIGHT : 0];
      expect(a.tick(pads)).toEqual(b.tick(pads)); expect(a.capture()).toEqual(b.capture());
    }
    const before = a.capture();
    for (const invalid of [999, 1]) {
      const bad = a.capture(); bad.broken.push(invalid);
      expect(() => a.restore(bad)).toThrow("snapshot"); expect(a.capture()).toEqual(before);
    }
    for (const value of [-1, 1201]) {
      const bad = a.capture(); bad.players[0].powerInvincible = value;
      expect(() => a.restore(bad)).toThrow("snapshot"); expect(a.capture()).toEqual(before);
    }
  });
});
