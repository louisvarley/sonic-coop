import { describe, expect, it } from "vitest";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { V5Prediction } from "../packages/engine/src/v5/prediction.js";
import { BTN } from "../packages/engine/src/input.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

type Ramp = Extract<V5Object, { kind: "fling-ramp" }>;
const ramp: Ramp = { id: 1, kind: "fling-ramp", x: 256 * FP, y: 144 * FP, plane: null, direction: 0 };
function fixture(change: Partial<Ramp> = {}) {
  return new V5Gameplay(movementFixture().sim, [{ ...ramp, ...change }], 512 * FP);
}
function approach(game: V5Gameplay, slot: number, direction: -1 | 1, speed = 4 * FP) {
  const state = game.capture();
  Object.assign(state.movement.players[slot], { x: 256 * FP, y: 141 * FP, vx: speed * direction, vy: 0,
    facing: direction, grounded: true, groundObject: null, jumping: false });
  game.restore(state);
}

describe("experimental fling ramps", () => {
  it("launches either player from either allowed side with added horizontal speed and an upward impulse", () => {
    for (const slot of [0, 1]) for (const direction of [-1, 1] as const) {
      const game = fixture(); approach(game, slot, direction);
      expect(game.tick([0, 0])).toContainEqual({ type: "ramp", player: slot, object: 1 });
      expect(game.capture().movement.players[slot]).toMatchObject({
        vx: direction * 8 * FP, vy: -7 * FP + 0x3800, grounded: false, groundObject: null, jumping: false,
      });
      expect(game.tick([0, 0]).some((event) => event.type === "ramp")).toBe(false);
    }
  });

  it("enforces the exact speed threshold, facing and serialized direction", () => {
    for (const mode of [0, 1, 2]) for (const direction of [-1, 1] as const) {
      const game = fixture({ direction: mode }); approach(game, 0, direction);
      expect(game.tick([0, 0]).some((event) => event.type === "ramp")).toBe(
        mode === 0 || (mode === 1 ? direction === 1 : direction === -1));
    }
    for (const speed of [0, 4 * FP - 1]) {
      const game = fixture(); approach(game, 0, 1, speed);
      expect(game.tick([0, 0]).some((event) => event.type === "ramp")).toBe(false);
    }
    const backwards = fixture(); approach(backwards, 0, 1);
    const state = backwards.capture(); state.movement.players[0].facing = -1; backwards.restore(state);
    expect(backwards.tick([0, 0]).some((event) => event.type === "ramp")).toBe(false);
  });

  it("ignores airborne, distant and opposite-plane players", () => {
    for (const change of [{ grounded: false }, { x: 300 * FP }, { y: 100 * FP }, { plane: 1 }]) {
      const game = fixture({ plane: 0 }); approach(game, 0, 1);
      const state = game.capture(); Object.assign(state.movement.players[0], change); game.restore(state);
      expect(game.tick([0, 0]).some((event) => event.type === "ramp")).toBe(false);
    }
  });

  it("launches simultaneous players independently without a global trigger latch", () => {
    const game = fixture(); approach(game, 0, 1); approach(game, 1, -1);
    expect(game.tick([0, 0]).filter((event) => event.type === "ramp")).toEqual([
      { type: "ramp", player: 0, object: 1 }, { type: "ramp", player: 1, object: 1 },
    ]);
  });

  it("does not turn a jump pressed on launch into automatic Tails flight", () => {
    const game = fixture(); approach(game, 1, 1);
    expect(game.tick([0, BTN.A])).toContainEqual({ type: "ramp", player: 1, object: 1 });
    expect(game.capture().movement.players[1]).toMatchObject({ flying: false, flightTime: 0 });
    game.tick([0, 0]); game.tick([0, BTN.A]);
    expect(game.capture().movement.players[1].flying).toBe(true);
  });

  it("caps launch velocity and clears flight, charge and bubble-dive state", () => {
    const game = fixture(); approach(game, 0, 1, 16 * FP);
    const state = game.capture();
    Object.assign(state.movement.players[0], { spinCharge: 2 * FP, rolling: true });
    Object.assign(state.players[0], { shield: "bubble", shieldUsed: true, bubbleBounce: true });
    game.restore(state); game.tick([0, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ vx: 16 * FP, spinCharge: 0, flying: false, angle: 0 });
    expect(game.capture().players[0].bubbleBounce).toBe(false);
  });

  it("replays the same launch during prediction and reconciles exactly", () => {
    for (const slot of [0, 1]) {
      const authority = fixture(), predicted = fixture(); approach(authority, slot, 1);
      const state = authority.capture(), prediction = new V5Prediction(predicted, slot);
      prediction.reset(state); prediction.advance(0, 0);
      expect(authority.capture()).toEqual(state);
      authority.tick([0, 0]); prediction.reconcile(authority.capture(), 0);
      expect(prediction.capture()).toEqual(authority.capture());
    }
  });

  it("rejects invalid directions rather than silently enabling a ramp", () => {
    for (const direction of [-1, 3, 0.5, NaN]) expect(() => fixture({ direction })).toThrow();
  });
});
