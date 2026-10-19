import { describe, expect, it } from "vitest";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { V5Prediction } from "../packages/engine/src/v5/prediction.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

type Rock = Extract<V5Object, { kind: "rock" }>;
const rock = (change: Partial<Rock> = {}): Rock => ({
  id: 1, kind: "rock", x: 256 * FP, y: 144 * FP, plane: null, halfWidth: 23, top: -15, bottom: 16,
  smashTop: false, smashSides: false, restricted: false, sprite: 0, frame: 0, ...change,
});
function fixture(object = rock()) {
  return new V5Gameplay(movementFixture().sim, [object], 512 * FP);
}
function falling(game: V5Gameplay, slot = 0) {
  const state = game.capture();
  Object.assign(state.movement.players[slot], {
    x: 256 * FP, y: 114 * FP, vx: 0, vy: 2 * FP, rolling: true, jumping: true, grounded: false,
  });
  game.restore(state);
}
function rolling(game: V5Gameplay, slot = 0, speed = 5 * FP, direction = 1) {
  const state = game.capture();
  Object.assign(state.movement.players[slot], {
    x: (256 - direction * 33) * FP, y: 146 * FP, vx: direction * speed, vy: 0,
    rolling: true, jumping: false, grounded: true, facing: direction,
  });
  game.restore(state);
}

describe("experimental shared rock piles", () => {
  it("blocks ordinary contact and supports a player without breaking", () => {
    const game = fixture();
    const state = game.capture();
    Object.assign(state.movement.players[0], { x: 256 * FP, y: 109 * FP, vy: 2 * FP });
    game.restore(state);
    for (let i = 0; i < 20; i++) game.tick([0, 0]);
    expect(game.capture().broken).toEqual([]);
    expect(game.capture().movement.players[0]).toMatchObject({ grounded: true, groundObject: 1, y: 110 * FP });
    game.restore(game.capture());
  });

  it("lets either human player break the top once, bounce and release every supported player", () => {
    for (const slot of [0, 1]) {
      const game = fixture(rock({ smashTop: true }));
      falling(game, slot);
      const state = game.capture();
      Object.assign(state.movement.players[1 - slot], {
        x: 256 * FP, y: 110 * FP, grounded: true, groundObject: 1, vx: 0, vy: 0,
      });
      game.restore(state);
      expect(game.tick([0, 0])).toContainEqual({ type: "rock", player: slot, object: 1 });
      expect(game.capture().broken).toEqual([1]);
      expect(game.capture().movement.players[slot]).toMatchObject({ vy: -3 * FP, rolling: true, grounded: false });
      expect(game.capture().movement.players.every((p) => p.groundObject === null)).toBe(true);
      falling(game, 1 - slot);
      expect(game.tick([0, 0]).some((event) => event.type === "rock")).toBe(false);
      expect(game.capture().players.map((p) => p.rings)).toEqual([0, 0]);
    }
  });

  it("requires rolling speed for side attacks, preserves momentum and works from either side for either player", () => {
    for (const slot of [0, 1]) for (const direction of [-1, 1]) {
      const slow = fixture(rock({ smashSides: true }));
      rolling(slow, slot, 0x48000 - 1, direction);
      expect(slow.tick([0, 0]).some((event) => event.type === "rock")).toBe(false);
      const fast = fixture(rock({ smashSides: true }));
      rolling(fast, slot, 0x48000, direction);
      expect(fast.tick([0, 0])).toContainEqual({ type: "rock", player: slot, object: 1 });
      expect(fast.capture().movement.players[slot].vx).toBe(direction * 0x48000);
      for (let i = 0; i < 25; i++) fast.tick([0, 0]);
      expect((fast.capture().movement.players[slot].x - 256 * FP) * direction).toBeGreaterThan(23 * FP);
    }
  });

  it("resolves simultaneous top hits as one shared destruction event", () => {
    const game = fixture(); falling(game, 0); falling(game, 1);
    expect(game.tick([0, 0]).filter((event) => event.type === "rock")).toEqual([{ type: "rock", player: 0, object: 1 }]);
    expect(game.capture().broken).toEqual([1]);
    expect(game.capture().movement.players.every((p) => p.groundObject === null)).toBe(true);
  });

  it("enforces attack faces, collision plane and character restrictions", () => {
    const topOnly = fixture(rock({ smashTop: true })); rolling(topOnly);
    expect(topOnly.tick([0, 0]).some((e) => e.type === "rock")).toBe(false);
    const sideOnly = fixture(rock({ smashSides: true })); falling(sideOnly);
    expect(sideOnly.tick([0, 0]).some((e) => e.type === "rock")).toBe(false);
    for (const slot of [0, 1]) {
      const restricted = fixture(rock({ restricted: true })); falling(restricted, slot);
      expect(restricted.tick([0, 0]).some((e) => e.type === "rock")).toBe(false);
      expect(restricted.capture().movement.players[slot].groundObject).toBe(1);
      const wrongPlane = fixture(rock({ plane: 1 })); falling(wrongPlane, slot);
      expect(wrongPlane.tick([0, 0]).some((e) => e.type === "rock")).toBe(false);
      expect(wrongPlane.capture().movement.players[slot].groundObject).toBeNull();
    }
  });

  it("allows an active Sonic fire dash but not an ordinary airborne roll to break a side", () => {
    for (const fire of [false, true]) {
      const game = fixture(); rolling(game);
      const state = game.capture();
      Object.assign(state.movement.players[0], { grounded: false, jumping: true, y: 130 * FP, controlLock: 10 });
      if (fire) Object.assign(state.players[0], { shield: "fire", shieldUsed: true });
      game.restore(state);
      expect(game.tick([0, 0]).some((e) => e.type === "rock")).toBe(fire);
    }
  });

  it("restores destruction atomically, rejects invalid broken IDs and keeps rollback deterministic", () => {
    const game = fixture(), mirror = fixture(); falling(game);
    const intact = game.capture();
    game.tick([0, 0]); mirror.restore(game.capture());
    for (let i = 0; i < 20; i++) {
      expect(game.tick([0, 0])).toEqual(mirror.tick([0, 0]));
      expect(game.capture()).toEqual(mirror.capture());
    }
    for (const broken of [[999], [1, 1]]) {
      const before = game.capture();
      expect(() => game.restore({ ...before, broken })).toThrow("snapshot");
      expect(game.capture()).toEqual(before);
    }
    game.restore(intact);
    expect(game.tick([0, 0])).toContainEqual({ type: "rock", player: 0, object: 1 });
    const restricted = fixture(rock({ restricted: true }));
    expect(() => restricted.restore({ ...restricted.capture(), broken: [1] })).toThrow("snapshot");
  });

  it("isolates speculative destruction and reconciles against intact or broken authority", () => {
    for (const slot of [0, 1]) {
      const authority = fixture(), predicted = fixture();
      falling(authority, slot);
      const intact = authority.capture(), prediction = new V5Prediction(predicted, slot);
      prediction.reset(intact); prediction.advance(0, 0);
      expect(prediction.capture().broken).toEqual([1]);
      expect(authority.capture()).toEqual(intact);
      prediction.reconcile(intact, -1);
      expect(prediction.capture().broken).toEqual([1]);
      authority.tick([0, 0]); prediction.reconcile(authority.capture(), 0);
      expect(prediction.capture()).toEqual(authority.capture());
      prediction.reset(intact);
      expect(prediction.capture().broken).toEqual([]);
    }
  });

  it("rejects invalid geometry, flags and sprite references at construction", () => {
    for (const change of [{ halfWidth: 0 }, { top: 16 }, { bottom: -20 }, { frame: 3 }, { sprite: -1 }]) {
      expect(() => fixture(rock(change))).toThrow();
    }
  });
});
