import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { V5Prediction } from "../packages/engine/src/v5/prediction.js";
import { movementFixture, FP } from "./v5-test-fixtures.js";

function fixture(objects: V5Object[] = []) {
  const { sim } = movementFixture();
  return new V5Gameplay(sim, objects, 512 * FP);
}
describe("v5 client-side local input prediction", () => {
  it.each([0, 1])("predicts slot %i immediately, reconciles acknowledged inputs and replays only unacknowledged inputs", (slot) => {
    const authority = fixture(), local = fixture(), prediction = new V5Prediction(local, slot);
    const pads = [0, 0]; pads[slot] = BTN.RIGHT;
    for (let frame = 0; frame < 60; frame++) authority.tick([0, 0]);
    prediction.reset(authority.capture());
    const start = authority.capture().movement.players[slot].x;
    prediction.advance(1, BTN.RIGHT);
    expect(prediction.capture().movement.players[slot].x).toBeGreaterThan(start);
    expect(authority.capture().movement.players[slot].x).toBe(start);
    prediction.advance(2, BTN.RIGHT); prediction.advance(3, BTN.RIGHT);
    authority.tick(pads);
    prediction.reconcile(authority.capture(), 1);
    const expected = fixture(); expected.restore(authority.capture()); expected.tick(pads); expected.tick(pads);
    expect(prediction.capture()).toEqual(expected.capture());
    authority.tick(pads); authority.tick(pads);
    prediction.reconcile(authority.capture(), 3);
    expect(prediction.capture()).toEqual(authority.capture());
  });

  it("corrects speculative pickups without duplicating rewards or changing authoritative objects", () => {
    const objects: V5Object[] = [{ id: 1, kind: "ring", x: 64 * FP, y: 100 * FP, plane: null }];
    const authority = fixture(objects), prediction = new V5Prediction(fixture(objects), 0);
    prediction.advance(1, 0);
    expect(prediction.capture().players[0].rings).toBe(1);
    expect(authority.capture().players[0].rings).toBe(0);
    const corrected = authority.capture();
    corrected.movement.frame = 1; corrected.players[1].rings = 1; corrected.collected = [1];
    prediction.reconcile(corrected, 1);
    expect(prediction.capture().players.map((player) => player.rings)).toEqual([0, 1]);
    expect(prediction.capture().collected).toEqual([1]);
  });

  it("handles missing input sequence numbers and acknowledges blur releases that were not predicted", () => {
    const authority = fixture(), prediction = new V5Prediction(fixture(), 0);
    prediction.advance(1, BTN.RIGHT); prediction.advance(3, BTN.RIGHT);
    authority.tick([0, 0]);
    prediction.reconcile(authority.capture(), 2);
    const expected = fixture(); expected.restore(authority.capture()); expected.tick([BTN.RIGHT, 0]);
    expect(prediction.capture()).toEqual(expected.capture());
    authority.tick([0, 0]); prediction.reconcile(authority.capture(), 4);
    expect(prediction.capture()).toEqual(authority.capture());
  });

  it("clears speculative history on restart without replaying old inputs into the new stage", () => {
    const authority = fixture(), prediction = new V5Prediction(fixture(), 0);
    prediction.advance(100, BTN.RIGHT); prediction.advance(101, BTN.RIGHT);
    prediction.reset(authority.capture());
    expect(prediction.capture()).toEqual(authority.capture());
    prediction.advance(102, 0); authority.tick([0, 0]);
    prediction.reconcile(authority.capture(), 102);
    expect(prediction.capture()).toEqual(authority.capture());
  });

  it("rejects malformed inputs and acknowledgements atomically and bounds the pending history", () => {
    const prediction = new V5Prediction(fixture(), 0), before = prediction.capture();
    expect(() => prediction.advance(0, -1)).toThrow("input"); expect(prediction.capture()).toEqual(before);
    prediction.advance(1, 0);
    expect(() => prediction.advance(1, 0)).toThrow("input");
    prediction.reconcile(prediction.capture(), 1);
    expect(() => prediction.reconcile(prediction.capture(), 0)).toThrow("acknowledgement");
    for (let seq = 2; seq <= 121; seq++) prediction.advance(seq, 0);
    expect(() => prediction.advance(122, 0)).toThrow("two seconds");
  });

  it("preserves complete shared rollback state when prediction is rebased with combat, rings and powerup state", () => {
    const objects: V5Object[] = [{ id: 10, kind: "saruder", x: 300 * FP, y: 141 * FP, plane: null, facing: -1, sprite: 0 }];
    const authority = fixture(objects), prediction = new V5Prediction(fixture(objects), 1), expected = fixture(objects);
    for (let frame = 0; frame < 65; frame++) authority.tick([0, 0]);
    expect(authority.capture().enemyWorld.projectiles.length).toBeGreaterThan(0);
    prediction.reset(authority.capture()); prediction.advance(1, BTN.A); prediction.advance(2, BTN.RIGHT);
    prediction.reconcile(authority.capture(), -1);
    expected.restore(authority.capture()); expected.tick([0, BTN.A]); expected.tick([0, BTN.RIGHT]);
    expect(prediction.capture()).toEqual(expected.capture());
  });

  it("rolls back speculative stage destruction without removing the authoritative world's collision", () => {
    const collapse: V5Object = { id: 20, kind: "collapse", x: 64 * FP, y: 176 * FP, plane: null,
      width: 64, height: 32, layer: 0, direction: 0, delay: 0, respawn: false };
    const authority = fixture([collapse]), local = fixture([collapse]), prediction = new V5Prediction(local, 0);
    const initial = authority.capture(); prediction.reset(initial);
    for (let seq = 1; seq <= 80; seq++) prediction.advance(seq, 0);
    expect(prediction.capture().collapses[0].started).not.toBeNull();
    expect(local.movement.world.trace("floor", 64, 150, 170, 0, [0])).toBeNull();
    expect(authority.movement.world.trace("floor", 64, 150, 170, 0, [0])?.position).toBe(160);
    const rejected = authority.capture(); rejected.movement.frame = 80;
    prediction.reconcile(rejected, 80);
    expect(prediction.capture().collapses[0].started).toBeNull();
    expect(local.movement.world.trace("floor", 64, 150, 170, 0, [0])?.position).toBe(160);
  });
});
