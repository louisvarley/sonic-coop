import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

const water: V5Object = { id: 20, kind: "water", x: 0, y: 80 * FP, plane: null };
function fixture(objects: V5Object[] = []) {
  const { sim } = movementFixture();
  return new V5Gameplay(sim, objects, 512 * FP);
}
function settle(game: V5Gameplay) { for (let frame = 0; frame < 60; frame++) game.tick([0, 0]); }

describe("experimental v5 water and elemental shields", () => {
  it("slows entry velocity once, uses underwater gravity, and boosts an upward exit once", () => {
    const { sim } = movementFixture(), state = sim.capture();
    Object.assign(state.players[0], { y: 100 * FP, vx: 4 * FP, vy: 4 * FP });
    sim.restore(state); sim.tick([0, 0], [], 80 * FP);
    expect(sim.capture().players[0]).toMatchObject({ underwater: true, vx: 2 * FP, vy: FP + 0x1000 });
    sim.tick([0, 0], [], 80 * FP);
    expect(sim.capture().players[0]).toMatchObject({ vx: 2 * FP, vy: FP + 0x2000 });
    const exit = sim.capture();
    Object.assign(exit.players[0], { y: 70 * FP, vy: -3 * FP }); sim.restore(exit);
    sim.tick([0, 0], [], 80 * FP);
    expect(sim.capture().players[0]).toMatchObject({ underwater: false, vy: -6 * FP + 0x3800 });
    sim.tick([0, 0], [], 80 * FP);
    expect(sim.capture().players[0].vy).toBe(-6 * FP + 2 * 0x3800);
  });

  it("uses underwater running speed and jump strength, including integer spindash launches", () => {
    const game = fixture([water]); settle(game);
    for (let frame = 0; frame < 160; frame++) game.tick([BTN.RIGHT, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ underwater: true, vx: 3 * FP });
    game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0].vy).toBe(-0x38000 + 0x1000);
    const spin = fixture([water]); settle(spin);
    spin.tick([BTN.DOWN | BTN.A, 0]); spin.tick([BTN.DOWN, 0]); spin.tick([0, 0]);
    expect(spin.capture().movement.players[0].vx).toBeGreaterThan(4 * FP);
    expect(Number.isInteger(spin.capture().movement.players[0].vx)).toBe(true);
  });

  it("drowns exactly after 1800 submerged ticks, resets on respawn, and does not grant invincibility immunity", () => {
    const game = fixture([water]);
    for (let frame = 0; frame < 1799; frame++) game.tick([0, 0]);
    const last = game.capture(); expect(last.players[0].airFrames).toBe(1);
    last.players[0].powerInvincible = 1200; game.restore(last);
    expect(game.tick([0, 0])).toEqual([
      { type: "respawn", player: 0, object: 20 }, { type: "respawn", player: 1, object: 20 },
    ]);
    expect(game.capture().players[0]).toMatchObject({ airFrames: 1800, deaths: 1, powerInvincible: 0 });
  });

  it("replenishes air when the head leaves the water, and a bubble shield prevents drowning for either player", () => {
    const game = fixture([water]); settle(game);
    const state = game.capture();
    for (const player of state.players) { player.shield = "bubble"; player.airFrames = 1; }
    game.restore(state);
    for (let frame = 0; frame < 1900; frame++) game.tick([0, 0]);
    expect(game.capture().players.every((p) => p.deaths === 0 && p.airFrames === 1800)).toBe(true);
    const emerged = game.capture(); emerged.players[0].shield = "none"; emerged.players[0].airFrames = 1;
    emerged.movement.players[0].y = 85 * FP; emerged.movement.players[0].grounded = false; game.restore(emerged);
    game.tick([0, 0]); expect(game.capture().players[0].airFrames).toBe(1800);
  });

  it("extinguishes fire and lightning shields underwater but preserves blue and bubble shields", () => {
    for (const shield of ["blue", "bubble", "fire", "lightning"] as const) {
      const game = fixture([water]), state = game.capture(); state.players[0].shield = shield; game.restore(state);
      game.tick([0, 0]);
      expect(game.capture().players[0].shield).toBe(shield === "fire" || shield === "lightning" ? "none" : shield);
    }
  });

  it("double jumps once per flight with a lightning shield, not once per button press", () => {
    const game = fixture(); settle(game);
    const state = game.capture(); state.players[0].shield = "lightning"; game.restore(state);
    game.tick([BTN.A, 0]); game.tick([0, 0]); game.tick([BTN.A, 0]);
    expect(game.capture().players[0].shieldUsed).toBe(true);
    expect(game.capture().movement.players[0].vy).toBe(-0x58000 + 0x3800);
    game.tick([0, 0]); const previous = game.capture().movement.players[0].vy;
    game.tick([BTN.A, 0]); expect(game.capture().movement.players[0].vy).toBe(previous + 0x3800);
    settle(game); expect(game.capture().players[0].shieldUsed).toBe(false);
  });

  it("fire dashes in the facing direction without allowing repeated midair activation", () => {
    const game = fixture(); settle(game);
    const state = game.capture(); state.players[0].shield = "fire"; state.movement.players[0].facing = -1; game.restore(state);
    game.tick([BTN.A, 0]); game.tick([0, 0]); game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ vx: -8 * FP, controlLock: 15 });
    expect(game.capture().players[0].shieldUsed).toBe(true);
    game.tick([0, 0]); game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0].controlLock).toBe(13);
  });

  it("bubble dives, bounces on landing and rearms after the bounce; Tails keeps flight instead", () => {
    const game = fixture(); settle(game);
    const state = game.capture(); state.players[0].shield = "bubble"; state.players[1].shield = "bubble"; game.restore(state);
    game.tick([BTN.A, BTN.A]); game.tick([0, 0]); game.tick([BTN.A, BTN.A]);
    expect(game.capture().players[0]).toMatchObject({ bubbleBounce: true, shieldUsed: true });
    expect(game.capture().movement.players[0].vy).toBeGreaterThanOrEqual(8 * FP);
    expect(game.capture().movement.players[1].flying).toBe(true);
    let bounced = false;
    for (let frame = 0; frame < 20; frame++) {
      game.tick([BTN.A, BTN.A]); const current = game.capture();
      if (current.movement.players[0].vy === -0x78000) {
        expect(current.players[0]).toMatchObject({ bubbleBounce: false, shieldUsed: false });
        expect(current.movement.players[0]).toMatchObject({ rolling: true, grounded: false, jumping: true });
        bounced = true; break;
      }
    }
    expect(bounced).toBe(true);
  });

  it("rolls back water transitions, air and shield actions exactly and rejects malformed power state", () => {
    const a = fixture([water]), b = fixture([water]); settle(a);
    const state = a.capture(); state.players[0].shield = "bubble"; state.players[1].shield = "blue"; a.restore(state);
    a.tick([BTN.A, BTN.A]); a.tick([0, 0]); a.tick([BTN.A, BTN.A]); b.restore(a.capture());
    for (let frame = 0; frame < 300; frame++) {
      const pads = [frame % 40 < 20 ? BTN.RIGHT : BTN.A, frame % 30 < 15 ? BTN.A : 0];
      expect(a.tick(pads)).toEqual(b.tick(pads)); expect(a.capture()).toEqual(b.capture());
    }
    const before = a.capture(), invalid = a.capture(); invalid.players[0].airFrames = 0;
    expect(() => a.restore(invalid)).toThrow("snapshot"); expect(a.capture()).toEqual(before);
    invalid.players[0].airFrames = 1800; invalid.players[0].shield = "fire"; invalid.players[0].bubbleBounce = true;
    expect(() => a.restore(invalid)).toThrow("snapshot"); expect(a.capture()).toEqual(before);
  });
});
