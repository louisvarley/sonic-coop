import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { v5SwingRopeAt, v5RopeVelocity, type V5SwingRope } from "../packages/engine/src/v5/ropes.js";
import { movementFixture, FP } from "./v5-test-fixtures.js";

const rope: V5SwingRope = { id: 20, kind: "swing-rope", x: 64 * FP, y: 16 * FP, plane: null, links: 4, phase: 0, sprite: 0 };
function fixture(objects: V5Object[] = [rope]) {
  const { sim, tiles } = movementFixture(), game = new V5Gameplay(sim, objects, 512 * FP);
  const state = game.capture(); state.movement.players[1].x = 68 * FP; game.restore(state);
  return { game, tiles };
}

describe("experimental v5 swinging rope interactions", () => {
  it("uses deterministic link lengths and phase-shifted endpoints", () => {
    expect(v5SwingRopeAt(rope, 0)).toEqual({ x: 64 * FP, y: 80 * FP, angle: 0 });
    expect(v5SwingRopeAt(rope, 128)).toEqual({ x: 128 * FP, y: 16 * FP, angle: 64 });
    expect(v5SwingRopeAt(rope, 384)).toEqual({ x: 0, y: 16 * FP, angle: 192 });
    expect(v5SwingRopeAt(rope, 512)).toEqual(v5SwingRopeAt(rope, 0));
    expect(v5SwingRopeAt({ ...rope, phase: 192 }, 0)).toEqual(v5SwingRopeAt(rope, 192));
  });

  it("lets both players grab, ride together and move with the same shared endpoint", () => {
    const { game } = fixture();
    game.tick([0, 0]);
    expect(game.capture().movement.players.every((p) => p.grabObject === 20)).toBe(true);
    for (let frame = 0; frame < 180; frame++) {
      game.tick([BTN.LEFT, BTN.RIGHT]);
      const state = game.capture(), handle = v5SwingRopeAt(rope, state.movement.frame);
      for (const player of state.movement.players) {
        expect(player).toMatchObject({ x: handle.x, y: handle.y + 19 * FP, grabObject: 20,
          grounded: false, rolling: false, flying: false });
      }
    }
  });

  it("jump releases only that player with tangential momentum and a regrab cooldown", () => {
    const { game } = fixture();
    for (let frame = 0; frame < 30; frame++) game.tick([0, 0]);
    const velocity = v5RopeVelocity(rope, 31);
    game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ grabObject: null, grabLock: 29,
      vx: velocity.vx, vy: velocity.vy - 0x68000 + 0x3800, jumping: true, rolling: true });
    expect(game.capture().movement.players[1].grabObject).toBe(20);
    for (let frame = 0; frame < 5; frame++) game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0].grabObject).toBeNull();
    expect(game.capture().movement.players[1].grabObject).toBe(20);
  });

  it("respects player planes, does not grab grounded players and does not trigger Tails flight on release", () => {
    const { game } = fixture([{ ...rope, plane: 1 }]);
    game.tick([0, 0]); expect(game.capture().movement.players.every((p) => p.grabObject === null)).toBe(true);
    const { game: shared } = fixture(); shared.tick([0, 0]); shared.tick([0, BTN.A]);
    expect(shared.capture().movement.players[1]).toMatchObject({ flying: false, jumping: true, grabObject: null });
    const state = game.capture(); state.movement.players.forEach((p) => {
      Object.assign(p, { plane: 1, grounded: true, y: 141 * FP });
    });
    game.restore(state); game.tick([0, 0]); expect(game.capture().movement.players.every((p) => p.grabObject === null)).toBe(true);
  });

  it("drops a rider rather than carrying through a tile wall or ceiling", () => {
    const { game, tiles } = fixture();
    game.tick([0, 0]); expect(game.capture().movement.players[0].grabObject).toBe(20);
    for (let y = 0; y < 10; y++) tiles[y * 64 + 5] = 0xf000;
    for (let frame = 0; frame < 30; frame++) game.tick([0, 0]);
    expect(game.capture().movement.players[0].grabObject).toBeNull();
    expect(game.capture().movement.players[0].x).toBeLessThanOrEqual(71 * FP);
  });

  it("clears a grabbed rope on damage and respawn, and continues counting powerup timers while attached", () => {
    const { game } = fixture(); game.tick([0, 0]);
    const state = game.capture(); state.movement.players[0].speedTime = 120;
    game.restore(state); game.tick([0, 0]);
    expect(game.capture().movement.players[0].speedTime).toBe(119);
    const hazard: V5Object = { id: 21, kind: "hazard", x: 64 * FP, y: 100 * FP, plane: null, halfWidth: 10, halfHeight: 10 };
    for (const rings of [0, 10]) {
      const { game: hurt } = fixture([rope, hazard]), initial = hurt.capture(); initial.players[0].rings = rings; hurt.restore(initial);
      hurt.tick([0, 0]); expect(hurt.capture().movement.players[0].grabObject).toBeNull();
    }
  });

  it("updates water state and air while riding and uses the weaker submerged release jump", () => {
    const water: V5Object = { id: 30, kind: "water", x: 0, y: 0, plane: null };
    const { game } = fixture([rope, water]); game.tick([0, 0]); game.tick([0, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ grabObject: 20, underwater: true });
    expect(game.capture().players[0].airFrames).toBe(1798);
    const velocity = v5RopeVelocity(rope, 3);
    game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ grabObject: null, vy: velocity.vy - 0x38000 + 0x1000 });
  });

  it("replays shared grabs, releases and airborne motion exactly and rejects invalid support ids", () => {
    const { game: a } = fixture(), { game: b } = fixture();
    for (let frame = 0; frame < 80; frame++) a.tick([0, 0]);
    b.restore(a.capture());
    for (let frame = 0; frame < 150; frame++) {
      const pads = [frame === 20 ? BTN.A : 0, frame === 40 ? BTN.A : 0];
      expect(a.tick(pads)).toEqual(b.tick(pads)); expect(a.capture()).toEqual(b.capture());
    }
    const before = a.capture(), invalid = a.capture(); invalid.movement.players[0].grabObject = 999;
    expect(() => a.restore(invalid)).toThrow("snapshot"); expect(a.capture()).toEqual(before);
  });
});
