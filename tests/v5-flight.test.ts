import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

describe("experimental Tails flight", () => {
  it("requires a second jump press in midair and never enables flight for Sonic", () => {
    const { sim } = movementFixture();
    for (let frame = 0; frame < 60; frame++) sim.tick([0, 0]);
    sim.tick([BTN.A, BTN.A]);
    for (let frame = 0; frame < 5; frame++) sim.tick([BTN.A, BTN.A]);
    expect(sim.capture().players.every((p) => !p.flying)).toBe(true);
    sim.tick([0, 0]); sim.tick([BTN.A, BTN.A]);
    expect(sim.capture().players[0].flying).toBe(false);
    expect(sim.capture().players[1]).toMatchObject({ flying: true, rolling: false, jumping: false, grounded: false });
    for (let frame = 0; frame < 20; frame++) sim.tick([0, BTN.A]);
    expect(sim.capture().players[1].vy).toBe(-2 * FP);
  });

  it("expires after eight seconds, cannot restart in midair, and recharges on landing", () => {
    const { sim } = movementFixture(), state = sim.capture();
    state.players[1].y = -1000 * FP; sim.restore(state);
    sim.tick([0, BTN.A]);
    for (let frame = 0; frame < 479; frame++) sim.tick([0, BTN.A]);
    expect(sim.capture().players[1]).toMatchObject({ flying: true, flightTime: 480, vy: -2 * FP });
    const exhausted = sim.capture();
    sim.tick([0, 0]); sim.tick([0, BTN.A]);
    expect(sim.capture().players[1].flightTime).toBe(480);
    expect(sim.capture().players[1].vy).toBeGreaterThan(-2 * FP);
    for (let frame = 0; frame < 300; frame++) sim.tick([0, 0]);
    expect(sim.capture().players[1]).toMatchObject({ flying: false, flightTime: 0, grounded: true });
    sim.restore(exhausted); sim.tick([0, BTN.A]);
    expect(sim.capture().players[1].vy).toBeGreaterThan(-2 * FP);
  });

  it("does not pass through ceilings and replays stamina, flight inputs and landing exactly", () => {
    const { sim: a, tiles } = movementFixture(), { sim: b, tiles: otherTiles } = movementFixture();
    for (let x = 0; x < 64; x++) { tiles[4 * 64 + x] = 0xf000; otherTiles[4 * 64 + x] = 0xf000; }
    for (let frame = 0; frame < 60; frame++) a.tick([0, 0]);
    a.tick([0, BTN.A]); a.tick([0, 0]); a.tick([0, BTN.A]);
    b.restore(a.capture());
    for (let frame = 0; frame < 600; frame++) {
      const pads = [0, frame < 490 ? BTN.A : 0];
      a.tick(pads); b.tick(pads); expect(b.capture()).toEqual(a.capture());
      expect(a.capture().players[1].y / FP - 19).toBeGreaterThanOrEqual(80);
    }
    expect(a.capture().players[1].flying).toBe(false);
  });
});
