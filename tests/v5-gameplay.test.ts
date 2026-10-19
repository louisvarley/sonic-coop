import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, v5SpikesAt, type V5Object } from "../packages/engine/src/v5/gameplay.js";
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

  it("applies every plane-switch flag combination independently to either player", () => {
    for (let flags = 0; flags < 16; flags++) {
      const game = fixture([{ id: 1, kind: "plane-switch", x: 96 * FP, y: 100 * FP, plane: null,
        flags, size: 16, angle: 0, onPath: false }]);
      const state = game.capture();
      state.movement.players[0].x = 80 * FP; state.movement.players[1].x = 112 * FP; game.restore(state);
      game.tick([0, 0]);
      expect(game.capture().movement.players.map((p) => [p.plane, p.highPriority]))
        .toEqual([[(flags >>> 1) & 1, !!(flags & 1)], [(flags >>> 3) & 1, !!(flags & 4)]]);
    }
  });

  it("uses projected velocity at a switch, rotates horizontal switches and honors path-only switches", () => {
    const switchObject: V5Object = { id: 1, kind: "plane-switch", x: 64 * FP, y: 100 * FP, plane: null,
      flags: 12, size: 2, angle: 0, onPath: false };
    const game = fixture([switchObject]), state = game.capture();
    Object.assign(state.movement.players[0], { x: 63 * FP, vx: 2 * FP }); game.restore(state);
    expect(game.tick([0, 0])).toEqual([{ type: "plane", player: 0, object: 1 }]);
    expect(game.capture().movement.players[0]).toMatchObject({ plane: 1, highPriority: true });
    const horizontal = fixture([{ ...switchObject, angle: 192 }]), below = horizontal.capture();
    below.movement.players[0].y = 101 * FP; horizontal.restore(below);
    horizontal.tick([0, 0]);
    expect(horizontal.capture().movement.players[0]).toMatchObject({ plane: 1, highPriority: true });
    const grounded = fixture([{ ...switchObject, y: 141 * FP, size: 16, onPath: true }]);
    expect(grounded.tick([0, 0])).toEqual([]);
    const landed = grounded.capture();
    Object.assign(landed.movement.players[0], { y: 141 * FP, grounded: true }); grounded.restore(landed);
    expect(grounded.tick([0, 0])).toEqual([{ type: "plane", player: 0, object: 1 }]);
    expect(grounded.capture().movement.players[0]).toMatchObject({ plane: 1, highPriority: true });
  });

  it("does not trigger plane switches outside their exact width or length", () => {
    const object: V5Object = { id: 1, kind: "plane-switch", x: 64 * FP, y: 100 * FP, plane: null,
      flags: 15, size: 1, angle: 0, onPath: false };
    for (const [x, y] of [[88, 100], [40, 100], [64, 108], [64, 92]]) {
      const game = fixture([object]), state = game.capture();
      Object.assign(state.movement.players[0], { x: x * FP, y: y * FP }); game.restore(state);
      expect(game.tick([0, 0])).toEqual([]);
      expect(game.capture().movement.players[0]).toMatchObject({ plane: 0, highPriority: false });
    }
  });

  it("quantizes subpixel plane-switch projections consistently and rolls changes back on invalid input", () => {
    const game = fixture([{ id: 1, kind: "plane-switch", x: 64 * FP, y: 100 * FP, plane: null,
      flags: 8, size: 16, angle: 0, onPath: false }]);
    const state = game.capture();
    Object.assign(state.movement.players[0], { x: 64 * FP - 1, vx: 2 }); game.restore(state);
    game.tick([0, 0]);
    expect(game.capture().movement.players[0].plane).toBe(0);
    const before = game.capture();
    expect(() => game.tick([NaN, 0])).toThrow("inputs");
    expect(game.capture()).toEqual(before);
    game.tick([0, 0]);
    expect(game.capture().movement.players[0].plane).toBe(1);
  });

  it("activates individual checkpoints for either player and respawns only the fallen player", () => {
    const game = fixture([{ id: 10, kind: "checkpoint", x: 128 * FP, y: 100 * FP, plane: null }]);
    const start = game.capture();
    Object.assign(start.movement.players[1], { plane: 1, highPriority: true }); game.restore(start);
    expect(game.tick([0, 0])).toEqual([{ type: "checkpoint", player: 1, object: 10 }]);
    const saved = game.capture();
    saved.movement.players[1].y = 600 * FP; game.restore(saved);
    expect(game.tick([0, 0])).toEqual([{ type: "respawn", player: 1, object: null }]);
    const state = game.capture();
    expect(state.players[1]).toMatchObject({ checkpoint: 10, deaths: 1, invincible: 180 });
    expect(state.players[0].deaths).toBe(0);
    expect(state.movement.players[1]).toMatchObject({ x: 128 * FP, y: 76 * FP, plane: 1, highPriority: true });
    expect(game.tick([0, 0]).filter((e) => e.type === "checkpoint")).toEqual([]);
  });

  it("launches springs once per contact and does not truncate non-jump launches", () => {
    const game = fixture([{ id: 1, kind: "spring", x: 64 * FP, y: 108 * FP, plane: null, vx: 0, vy: -12 * FP }]);
    expect(game.tick([0, 0])).toEqual([{ type: "spring", player: 0, object: 1 }]);
    expect(game.capture().movement.players[0].vy).toBe(-12 * FP);
    expect(game.tick([0, 0])).toEqual([]);
    expect(game.capture().movement.players[0].vy).toBeLessThan(-11 * FP);
    const state = game.capture(); expect(state.contacts).toContain(0);
    game.restore(state);
    expect(game.tick([0, 0]).filter((e) => e.type === "spring")).toEqual([]);
  });

  it("preserves horizontal momentum on vertical springs and rejects their back face", () => {
    const spring: V5Object = { id: 1, kind: "spring", x: 64 * FP, y: 108 * FP, plane: null, vx: 0, vy: -16 * FP };
    const game = fixture([spring]), state = game.capture();
    state.movement.players[0].vx = 3 * FP; game.restore(state);
    expect(game.tick([0, 0])).toEqual([{ type: "spring", player: 0, object: 1 }]);
    expect(game.capture().movement.players[0]).toMatchObject({ vx: 3 * FP, vy: -16 * FP });
    const wrongSide = fixture([spring]), below = wrongSide.capture();
    below.movement.players[0].y = 120 * FP; wrongSide.restore(below);
    expect(wrongSide.tick([0, 0])).toEqual([]);
  });

  it("launches either player horizontally without erasing vertical momentum and locks direction briefly", () => {
    const game = fixture([{ id: 1, kind: "spring", x: 48 * FP, y: 100 * FP, plane: null, vx: 16 * FP, vy: 0 },
      { id: 2, kind: "spring", x: 144 * FP, y: 100 * FP, plane: null, vx: -10 * FP, vy: 0 }]);
    expect(game.tick([0, 0])).toEqual([{ type: "spring", player: 0, object: 1 }, { type: "spring", player: 1, object: 2 }]);
    expect(game.capture().movement.players[0]).toMatchObject({ vx: 16 * FP, vy: 0x3800, facing: 1, controlLock: 16 });
    expect(game.capture().movement.players[1]).toMatchObject({ vx: -10 * FP, facing: -1, controlLock: 16 });
    game.tick([BTN.LEFT, BTN.RIGHT]);
    expect(game.capture().movement.players[0].vx).toBe(16 * FP);
    expect(game.capture().movement.players[1].vx).toBe(-10 * FP);
    expect(game.capture().movement.players.every((p) => p.controlLock === 15)).toBe(true);
  });

  it("honors spring grounded-only activation and collision planes", () => {
    const spring: V5Object = { id: 1, kind: "spring", x: 48 * FP, y: 141 * FP, plane: 1, vx: 10 * FP, vy: 0, onGround: true };
    const game = fixture([spring]);
    for (let i = 0; i < 60; i++) expect(game.tick([0, 0])).toEqual([]);
    const state = game.capture(); state.movement.players[0].plane = 1; game.restore(state);
    expect(game.tick([0, 0])).toEqual([{ type: "spring", player: 0, object: 1 }]);
    expect(game.capture().movement.players[0]).toMatchObject({ grounded: true, vx: 10 * FP, vy: 0 });
  });

  it("derives retracting spikes at exact cycle boundaries for all orientations and staggered starts", () => {
    for (let direction = 0; direction < 4; direction++) {
      const spikes: Extract<V5Object, { kind: "spikes" }> = { id: 1, kind: "spikes", x: 64 * FP, y: 100 * FP,
        plane: null, direction, count: 2, moving: true, stagger: 0, timer: 0 };
      expect(v5SpikesAt(spikes, 0).active).toBe(false);
      expect(v5SpikesAt(spikes, 1).active).toBe(false);
      expect(v5SpikesAt(spikes, 2).active).toBe(true);
      expect(v5SpikesAt(spikes, 5)).toEqual({ x: spikes.x, y: spikes.y, active: true });
      expect(v5SpikesAt(spikes, 65)).toEqual({ x: spikes.x, y: spikes.y, active: true });
      expect(v5SpikesAt(spikes, 69).active).toBe(false);
      expect(v5SpikesAt(spikes, 133)).toEqual(v5SpikesAt(spikes, 5));
      expect(v5SpikesAt({ ...spikes, stagger: 1, timer: 12 }, 81)).toEqual(v5SpikesAt(spikes, 5));
      expect(v5SpikesAt({ ...spikes, moving: false }, 0)).toEqual({ x: spikes.x, y: spikes.y, active: true });
    }
  });

  it("does not damage players while spikes are fully retracted and replays their shared cycle", () => {
    const spikes: V5Object = { id: 1, kind: "spikes", x: 64 * FP, y: 100 * FP, plane: null,
      direction: 0, count: 2, moving: true, stagger: 0, timer: 0 };
    const a = fixture([spikes]), b = fixture([spikes]);
    expect(a.tick([0, 0])).toEqual([]);
    expect(a.tick([0, 0])).toEqual([{ type: "respawn", player: 0, object: 1 }]);
    b.restore(a.capture());
    for (let i = 0; i < 300; i++) {
      expect(a.tick([0, 0])).toEqual(b.tick([0, 0])); expect(a.capture()).toEqual(b.capture());
    }
  });

  it("interrupts flight on damage and springs and restores flight stamina on respawn", () => {
    for (const kind of ["hazard", "spring"] as const) {
      const object: V5Object = kind === "hazard"
        ? { id: 1, kind, x: 128 * FP, y: 108 * FP, plane: null, halfWidth: 8, halfHeight: 8 }
        : { id: 1, kind, x: 128 * FP, y: 108 * FP, plane: null, vx: 0, vy: -10 * FP };
      const game = fixture([object]), state = game.capture();
      Object.assign(state.movement.players[1], { flying: true, flightTime: 60, rolling: false, jumping: false });
      state.players[1].rings = 1; game.restore(state);
      expect(game.tick([0, 0]).some((event) => event.player === 1 && event.type === (kind === "hazard" ? "hurt" : "spring"))).toBe(true);
      expect(game.capture().movement.players[1].flying).toBe(false);
      const fallen = game.capture(); fallen.movement.players[1].y = 600 * FP; game.restore(fallen);
      game.tick([0, 0]);
      expect(game.capture().movement.players[1]).toMatchObject({ flying: false, flightTime: 0 });
    }
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

  it("cancels spindash charge on springs and damage, and resets ball state on respawn", () => {
    const spring: V5Object = { id: 1, kind: "spring", x: 64 * FP, y: 153 * FP, plane: null, vx: 0, vy: -10 * FP };
    const hazard: V5Object = { id: 2, kind: "hazard", x: 64 * FP, y: 153 * FP, plane: null, halfWidth: 8, halfHeight: 8 };
    for (const object of [spring, hazard]) {
      const game = fixture([object]), charged = game.capture();
      Object.assign(charged.movement.players[0], { y: 146 * FP, rolling: true, spinCharge: FP, grounded: true, facing: -1 });
      charged.players[0].rings = 1; game.restore(charged);
      expect(game.tick([BTN.DOWN, 0]).map((event) => event.type)).toEqual([object.kind === "spring" ? "spring" : "hurt"]);
      expect(game.capture().movement.players[0]).toMatchObject({ spinCharge: 0, grounded: false, jumping: false });
      const fallen = game.capture(); fallen.movement.players[0].y = 600 * FP; game.restore(fallen);
      game.tick([0, 0]);
      expect(game.capture().movement.players[0]).toMatchObject({ rolling: false, spinCharge: 0, facing: 1, vx: 0, vy: 0 });
    }
  });

  it("replays object ownership, spring latches, progress and movement exactly after rollback", () => {
    const objects: V5Object[] = [ring(1, 64), ring(2, 128),
      { id: 3, kind: "checkpoint", x: 200 * FP, y: 141 * FP, plane: null },
      { id: 4, kind: "spring", x: 256 * FP, y: 153 * FP, plane: null, vx: 0, vy: -10 * FP },
      { id: 5, kind: "plane-switch", x: 280 * FP, y: 141 * FP, plane: null, flags: 11, size: 16, angle: 0, onPath: false }];
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
