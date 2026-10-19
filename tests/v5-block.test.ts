import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

const block = (change: Partial<Extract<V5Object, { kind: "block" }>> = {}): Extract<V5Object, { kind: "block" }> => ({
  id: 20, kind: "block", x: 128 * FP, y: 120 * FP, plane: null, halfWidth: 24, halfHeight: 40,
  ignoreTop: false, ignoreBottom: false, ignoreLeft: false, ignoreRight: false, ...change,
});
function fixture(object = block()) {
  const { sim } = movementFixture();
  return new V5Gameplay(sim, [object], 512 * FP);
}

describe("v5 invisible collision blocks", () => {
  it("blocks either player on the two side faces without rendering or awarding a pickup", () => {
    const game = fixture(), state = game.capture();
    state.movement.players[1].x = 200 * FP; game.restore(state);
    for (let frame = 0; frame < 120; frame++) expect(game.tick([BTN.RIGHT, BTN.LEFT])).toEqual([]);
    expect(game.capture().movement.players[0]).toMatchObject({ x: 95 * FP, vx: 0, grounded: true });
    expect(game.capture().movement.players[1]).toMatchObject({ x: 161 * FP, vx: 0, grounded: true });
  });

  it("honors independently ignored side faces and the individual collision plane", () => {
    for (const change of [{ ignoreLeft: true }, { plane: 1 }]) {
      const game = fixture(block(change)), state = game.capture();
      state.movement.players[1].x = 256 * FP; game.restore(state);
      for (let frame = 0; frame < 70; frame++) game.tick([BTN.RIGHT, 0]);
      expect(game.capture().movement.players[0].x).toBeGreaterThan(152 * FP);
    }
    const game = fixture(block({ ignoreRight: true })), state = game.capture();
    state.movement.players[1].x = 200 * FP; game.restore(state);
    for (let frame = 0; frame < 70; frame++) game.tick([0, BTN.LEFT]);
    expect(game.capture().movement.players[1].x).toBeLessThan(104 * FP);
  });

  it("supports players on the top unless ignored, and includes support in rollback state", () => {
    for (const ignoreTop of [false, true]) {
      const a = fixture(block({ ignoreTop })), b = fixture(block({ ignoreTop })), state = a.capture();
      state.movement.players[0].x = 128 * FP; state.movement.players[0].y = 20 * FP; a.restore(state);
      for (let frame = 0; frame < 60; frame++) a.tick([0, 0]);
      expect(a.capture().movement.players[0]).toMatchObject({
        groundObject: ignoreTop ? null : 20, y: (ignoreTop ? 141 : 61) * FP, grounded: true,
      });
      b.restore(a.capture());
      for (let frame = 0; frame < 90; frame++) {
        a.tick([BTN.RIGHT, 0]); b.tick([BTN.RIGHT, 0]); expect(b.capture()).toEqual(a.capture());
      }
    }
  });

  it("prevents head movement through the bottom unless that face is ignored", () => {
    for (const ignoreBottom of [false, true]) {
      const game = fixture(block({ y: 80 * FP, halfHeight: 8, ignoreBottom })), state = game.capture();
      Object.assign(state.movement.players[0], { x: 128 * FP, y: 141 * FP, grounded: true }); game.restore(state);
      let minimum = Infinity;
      for (let frame = 0; frame < 90; frame++) {
        game.tick([BTN.A, 0]); minimum = Math.min(minimum, game.capture().movement.players[0].y / FP);
      }
      expect(ignoreBottom ? minimum < 88 + 14 : minimum >= 88 + 14).toBe(true);
    }
  });
});
