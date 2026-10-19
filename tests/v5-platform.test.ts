import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, v5PlatformAt, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

const platform = (change: Partial<Extract<V5Object, { kind: "platform" }>> = {}): Extract<V5Object, { kind: "platform" }> => ({
  id: 9, kind: "platform", x: 80 * FP, y: 128 * FP, plane: null,
  amplitudeX: 0, amplitudeY: -32 * FP, speed: 3, phase: 0, halfWidth: 32, top: -19, sprite: 0, ...change,
});

function fixture(object = platform()) {
  const { sim, tiles } = movementFixture();
  const game = new V5Gameplay(sim, [object], 512 * FP);
  const state = game.capture();
  Object.assign(state.movement.players[0], { x: 64 * FP, y: 40 * FP });
  Object.assign(state.movement.players[1], { x: 96 * FP, y: 40 * FP });
  game.restore(state);
  return { game, tiles };
}

describe("experimental moving platforms", () => {
  it("uses quantized native amplitude, speed, phase and exact cycle extrema", () => {
    const object = platform({ speed: 1, amplitudeX: 64 * FP, amplitudeY: -32 * FP });
    expect(v5PlatformAt(object, 0)).toEqual({ x: 80 * FP, y: 128 * FP });
    expect(v5PlatformAt(object, 256)).toEqual({ x: 144 * FP, y: 96 * FP });
    expect(v5PlatformAt(object, 512)).toEqual({ x: 80 * FP, y: 128 * FP });
    expect(v5PlatformAt(object, 768)).toEqual({ x: 16 * FP, y: 160 * FP });
    expect(v5PlatformAt({ ...object, phase: 256 }, 0)).toEqual(v5PlatformAt(object, 256));
    expect(v5PlatformAt(object, 1024 * 1000000 + 256)).toEqual(v5PlatformAt(object, 256));
  });

  it("lands both players and carries them vertically without drift or losing support", () => {
    const object = platform(), { game } = fixture(object);
    for (let frame = 0; frame < 45; frame++) game.tick([0, 0]);
    expect(game.capture().movement.players.every((p) => p.groundObject === object.id)).toBe(true);
    for (let frame = 0; frame < 400; frame++) {
      game.tick([0, 0]);
      const state = game.capture(), surface = Math.floor(v5PlatformAt(object, state.movement.frame).y / FP) + object.top;
      for (const player of state.movement.players) {
        expect(player).toMatchObject({ grounded: true, groundObject: object.id, vy: 0 });
        expect(player.y / FP + 19).toBe(surface);
      }
    }
  });

  it("carries each player's horizontal offset, permits jumps and releases only the player who walks off", () => {
    const object = platform({ amplitudeX: 32 * FP, amplitudeY: 0 }), { game } = fixture(object);
    for (let frame = 0; frame < 45; frame++) game.tick([0, 0]);
    const before = game.capture();
    const offsets = before.movement.players.map((p) => p.x - v5PlatformAt(object, before.movement.frame).x);
    for (let frame = 0; frame < 120; frame++) {
      game.tick([0, 0]);
      const state = game.capture(), x = v5PlatformAt(object, state.movement.frame).x;
      expect(state.movement.players.map((p) => p.x - x)).toEqual(offsets);
    }
    game.tick([BTN.A, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ groundObject: null, grounded: false, jumping: true });
    expect(game.capture().movement.players[1].groundObject).toBe(object.id);
    for (let frame = 0; frame < 90; frame++) game.tick([BTN.RIGHT, 0]);
    expect(game.capture().movement.players[0].groundObject).toBeNull();
    expect(game.capture().movement.players[1].groundObject).toBe(object.id);
  });

  it("is one-way from below and respects individual collision planes", () => {
    const { game } = fixture(platform({ plane: 1, amplitudeY: 0 }));
    for (let frame = 0; frame < 60; frame++) game.tick([0, 0]);
    expect(game.capture().movement.players.every((p) => p.y === 141 * FP && p.groundObject === null)).toBe(true);
    const state = game.capture(); state.movement.players[0].plane = 1; game.restore(state);
    game.tick([BTN.A, 0]);
    let minY = Infinity;
    for (let frame = 0; frame < 90; frame++) {
      game.tick([BTN.A, 0]); minY = Math.min(minY, game.capture().movement.players[0].y);
    }
    expect(minY).toBeLessThan(70 * FP);
    expect(game.capture().movement.players[0]).toMatchObject({ grounded: true, groundObject: 9, y: 90 * FP });
    expect(game.capture().movement.players[1]).toMatchObject({ grounded: true, groundObject: null, y: 141 * FP });
  });

  it("catches a falling player when a rising platform crosses their feet between ticks", () => {
    const object = platform(), { game } = fixture(object), state = game.capture();
    state.movement.players[0].y = Math.trunc(89.5 * FP); game.restore(state);
    game.tick([0, 0]);
    expect(game.capture().movement.players[0]).toMatchObject({ grounded: true, groundObject: 9, vy: 0 });
    expect(game.capture().movement.players[0].y / FP + 19).toBe(Math.floor(v5PlatformAt(object, 1).y / FP) - 19);
  });

  it("does not carry players through tile walls or push their head through a ceiling", () => {
    const { game, tiles } = fixture(platform({ amplitudeY: 0, amplitudeX: 32 * FP }));
    for (let frame = 0; frame < 45; frame++) game.tick([0, 0]);
    for (let y = 0; y < 10; y++) tiles[y * 64 + 8] = 0xf000;
    for (let frame = 0; frame < 150; frame++) {
      game.tick([0, 0]);
      expect(game.capture().movement.players[1].x / FP).toBeLessThanOrEqual(128 - 9);
    }
    const vertical = fixture(platform({ speed: 1, amplitudeY: -32 * FP }));
    const standing = vertical.game.capture();
    for (const p of standing.movement.players) Object.assign(p, { y: 90 * FP, grounded: true, groundObject: 9 });
    vertical.game.restore(standing);
    for (let x = 0; x < 64; x++) vertical.tiles[3 * 64 + x] = 0xf000;
    for (let frame = 0; frame < 300; frame++) {
      vertical.game.tick([0, 0]);
      expect(vertical.game.capture().movement.players.every((p) => p.y / FP - 19 >= 64)).toBe(true);
    }
  });

  it("replays movement, support ownership, jumps and spindash on moving platforms exactly", () => {
    const { game: a } = fixture(), { game: b } = fixture();
    for (let frame = 0; frame < 60; frame++) a.tick([0, 0]);
    b.restore(a.capture());
    for (let frame = 0; frame < 300; frame++) {
      const pads = [frame < 20 ? BTN.DOWN | (frame % 2 ? BTN.A : 0) : 0, frame === 30 ? BTN.A : 0];
      expect(a.tick(pads)).toEqual(b.tick(pads)); expect(a.capture()).toEqual(b.capture());
    }
    const before = a.capture(), bad = a.capture(); bad.movement.players[0].groundObject = 999;
    expect(() => a.restore(bad)).toThrow("snapshot"); expect(a.capture()).toEqual(before);
  });
});
