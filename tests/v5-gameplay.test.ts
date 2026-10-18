import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

function fixture(objects: V5Object[]) {
  const { sim } = movementFixture();
  return new V5Gameplay(sim, objects, 512 * FP);
}
const ring = (id: number, x: number, plane: number | null = null): V5Object => ({ id, kind: "ring", x: x * FP, y: 100 * FP, plane });

describe("experimental v5 shared object behaviors", () => {
  it("lets either player collect rings with deterministic ownership and no duplicates", () => {
    const game = fixture([ring(1, 64), ring(2, 128)]);
    expect(game.tick([0, 0])).toEqual([{ type: "ring", player: 0, object: 1 }, { type: "ring", player: 1, object: 2 }]);
    expect(game.capture().players.map((p) => p.rings)).toEqual([1, 1]);
    expect(game.tick([0, 0])).toEqual([]);
    const shared = fixture([ring(3, 64)]);
    const state = shared.capture(); state.movement.players[1].x = 64 * FP; shared.restore(state);
    expect(shared.tick([0, 0])).toEqual([{ type: "ring", player: 0, object: 3 }]);
    expect(shared.capture().players.map((p) => p.rings)).toEqual([1, 0]);
  });

  it("honors object planes", () => {
    const game = fixture([ring(1, 64, 1)]);
    expect(game.tick([0, 0])).toEqual([]);
    const state = game.capture(); state.movement.players[0].plane = 1; game.restore(state);
    expect(game.tick([0, 0])).toEqual([{ type: "ring", player: 0, object: 1 }]);
  });

  it("activates individual checkpoints for either player and respawns only the fallen player", () => {
    const game = fixture([{ id: 10, kind: "checkpoint", x: 128 * FP, y: 100 * FP, plane: null }]);
    expect(game.tick([0, 0])).toEqual([{ type: "checkpoint", player: 1, object: 10 }]);
    const saved = game.capture();
    saved.movement.players[1].y = 600 * FP; game.restore(saved);
    expect(game.tick([0, 0])).toEqual([{ type: "respawn", player: 1, object: null }]);
    const state = game.capture();
    expect(state.players[1]).toMatchObject({ checkpoint: 10, deaths: 1, invincible: 180 });
    expect(state.players[0].deaths).toBe(0);
    expect(state.movement.players[1]).toMatchObject({ x: 128 * FP, y: 76 * FP });
    expect(game.tick([0, 0]).filter((e) => e.type === "checkpoint")).toEqual([]);
  });

  it("launches springs once per contact and does not truncate non-jump launches", () => {
    const game = fixture([{ id: 1, kind: "spring", x: 64 * FP, y: 100 * FP, plane: null, vx: 0, vy: -12 * FP }]);
    expect(game.tick([0, 0])).toEqual([{ type: "spring", player: 0, object: 1 }]);
    expect(game.capture().movement.players[0].vy).toBe(-12 * FP);
    expect(game.tick([0, 0])).toEqual([]);
    expect(game.capture().movement.players[0].vy).toBeLessThan(-11 * FP);
    const state = game.capture(); expect(state.contacts).toContain(0);
    game.restore(state);
    expect(game.tick([0, 0]).filter((e) => e.type === "spring")).toEqual([]);
  });

  it("loses rings on hazards, grants invulnerability and respawns without rings", () => {
    const hazard: V5Object = { id: 5, kind: "hazard", x: 64 * FP, y: 100 * FP, plane: null, halfWidth: 8, halfHeight: 8 };
    const game = fixture([ring(1, 64), hazard]);
    expect(game.tick([0, 0])).toEqual([{ type: "ring", player: 0, object: 1 }, { type: "hurt", player: 0, object: 5 }]);
    expect(game.capture().players[0]).toMatchObject({ rings: 0, deaths: 0, invincible: 120 });
    expect(game.tick([0, 0])).toEqual([]);
    const vulnerable = game.capture();
    vulnerable.players[0].invincible = 0;
    Object.assign(vulnerable.movement.players[0], { x: 64 * FP, y: 100 * FP, vx: 0, vy: 0 });
    game.restore(vulnerable);
    expect(game.tick([0, 0])).toEqual([{ type: "respawn", player: 0, object: 5 }]);
    expect(game.capture().players[0].deaths).toBe(1);
  });

  it("replays object ownership, spring latches, progress and movement exactly after rollback", () => {
    const objects: V5Object[] = [ring(1, 64), ring(2, 128),
      { id: 3, kind: "checkpoint", x: 200 * FP, y: 141 * FP, plane: null },
      { id: 4, kind: "spring", x: 256 * FP, y: 153 * FP, plane: null, vx: 0, vy: -10 * FP }];
    const a = fixture(objects), b = fixture(objects);
    for (let frame = 0; frame < 70; frame++) a.tick([BTN.RIGHT, BTN.RIGHT]);
    const snapshot = a.capture(); b.restore(snapshot);
    snapshot.players[0].rings = 999; snapshot.collected.length = 0;
    for (let frame = 0; frame < 180; frame++) {
      const pads = [frame % 60 < 20 ? BTN.RIGHT | BTN.A : BTN.RIGHT, BTN.RIGHT];
      expect(a.tick(pads)).toEqual(b.tick(pads));
      expect(a.capture()).toEqual(b.capture());
    }
  });

  it("rejects bad object state and invalid snapshots without partial mutation", () => {
    expect(() => fixture([ring(1, 64), ring(1, 128)])).toThrow("object");
    const game = fixture([ring(1, 64)]), before = game.capture();
    for (const change of [{ rings: -1 }, { deaths: NaN }, { checkpoint: 999 }, { spawnPlane: 2 }]) {
      const state = game.capture(); Object.assign(state.players[1], change);
      expect(() => game.restore(state)).toThrow("snapshot"); expect(game.capture()).toEqual(before);
    }
    const bad = game.capture(); bad.collected = [999];
    expect(() => game.restore(bad)).toThrow("snapshot");
    expect(() => game.tick([0, NaN])).toThrow("inputs");
    expect(game.capture()).toEqual(before);
  });
});
