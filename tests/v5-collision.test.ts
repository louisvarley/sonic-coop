import { describe, expect, it } from "vitest";
import { V5CollisionWorld, type V5CollisionMask, type V5Surface } from "../packages/engine/src/v5/collision.js";

function mask(heights = new Uint8Array(16).fill(8), direction = 0): V5CollisionMask {
  return { heights, solid: new Uint8Array(16).fill(1), direction,
    floorAngle: 32, roofAngle: 128, leftWallAngle: 192, rightWallAngle: 64, flags: 7 };
}

function world(tile = 0xf000, collision = mask()) {
  return new V5CollisionWorld([{ width: 1, height: 1, tiles: Uint16Array.of(tile) }],
    [Array.from({ length: 1024 }, () => collision), Array.from({ length: 1024 }, () => mask(new Uint8Array(16).fill(4)))]);
}

describe("RSDKv5 world-pixel collision", () => {
  it("finds floor, ceiling and both walls with consistent pixel-edge coordinates", () => {
    const w = world();
    expect(w.trace("floor", 4, -16, 32, 0, [0])).toMatchObject({ position: 8, angle: 32, flags: 7 });
    expect(w.trace("ceiling", 4, 32, -16, 0, [0])).toMatchObject({ position: 16, angle: 128 });
    expect(w.trace("leftWall", 12, -16, 32, 0, [0])).toMatchObject({ position: 0, angle: 192 });
    expect(w.trace("rightWall", 12, 32, -16, 0, [0])).toMatchObject({ position: 16, angle: 64 });
    expect(w.trace("leftWall", 4, -16, 32, 0, [0])).toBeNull();
  });

  it("distinguishes floor and other-side solidity independently on both collision planes", () => {
    for (let flags = 0; flags < 16; flags++) {
      const w = world(flags << 12);
      for (const plane of [0, 1]) {
        expect(w.trace("floor", 4, -16, 32, plane, [0]) !== null).toBe(!!(flags & (1 << (plane * 2))));
        expect(w.trace("ceiling", 4, 32, -16, plane, [0]) !== null).toBe(!!(flags & (2 << (plane * 2))));
        expect(w.trace("leftWall", 12, -16, 32, plane, [0]) !== null).toBe(!!(flags & (2 << (plane * 2))));
      }
    }
    expect(world().trace("floor", 4, -16, 32, 1, [0])?.position).toBe(4);
  });

  it("transforms asymmetric slopes and angles under both tile flips", () => {
    const heights = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(world(0xf000, mask(heights)).trace("floor", 3, 0, 16, 0, [0])).toMatchObject({ position: 3, angle: 32 });
    expect(world(0xf400, mask(heights)).trace("floor", 3, 0, 16, 0, [0])).toMatchObject({ position: 12, angle: 224 });
    expect(world(0xf800, mask(heights)).trace("ceiling", 3, 16, 0, 0, [0])).toMatchObject({ position: 13, angle: 96 });
    expect(world(0xfc00, mask(heights)).trace("ceiling", 3, 16, 0, 0, [0])).toMatchObject({ position: 4, angle: 160 });
    expect(world(0xf000, mask(heights, 1)).trace("ceiling", 3, 16, 0, 0, [0])?.position).toBe(4);
    expect(world(0xf800, mask(heights, 1)).trace("floor", 3, 0, 16, 0, [0])?.position).toBe(12);
  });

  it("respects disabled mask columns, empty tiles and layer selection", () => {
    const m = mask(); m.solid[4] = 0;
    expect(world(0xf000, m).trace("floor", 4, 0, 16, 0, [0])).toBeNull();
    expect(world(0xffff).trace("floor", 4, 0, 16, 0, [0])).toBeNull();
    expect(world().trace("floor", 4, 0, 16, 0, [])).toBeNull();
    expect(world().trace("floor", -1, 0, 16, 0, [0])).toBeNull();
    expect(world().trace("floor", 16, 0, 16, 0, [0])).toBeNull();
  });

  it("chooses the nearest surface across layers in either direction, independent of layer order", () => {
    const w = world();
    const combined = new V5CollisionWorld([
      { width: 1, height: 2, tiles: Uint16Array.of(0xffff, 0xf000) }, w.layers[0],
    ], w.paths);
    for (const indices of [[0, 1], [1, 0]]) {
      expect(combined.trace("floor", 4, -16, 40, 0, indices)?.position).toBe(8);
      expect(combined.trace("ceiling", 4, 40, -16, 0, indices)?.position).toBe(32);
    }
  });

  it("includes exact boundaries on adjacent tiles but never snaps outside the sweep", () => {
    const w = world();
    expect(w.trace("ceiling", 4, 16, 16, 0, [0])?.position).toBe(16);
    expect(w.trace("floor", 4, 8, 8, 0, [0])?.position).toBe(8);
    expect(w.trace("floor", 4, 0, 7, 0, [0])).toBeNull();
    expect(w.trace("floor", 4, 9, 10, 0, [0])).toBeNull();
    expect(w.trace("ceiling", 4, 15, 0, 0, [0])).toBeNull();
  });

  it("rejects invalid queries instead of silently disabling collision", () => {
    const w = world();
    expect(() => w.trace("floor", 1, 10, 0, 0, [0])).toThrow("direction");
    expect(() => w.trace("ceiling", 1, 0, 10, 0, [0])).toThrow("direction");
    for (const args of [
      ["floor", NaN, 0, 10, 0, [0]], ["floor", 1, 0, 5000, 0, [0]], ["floor", 1, 0, 10, 2, [0]],
      ["floor", 1, 0, 10, 0, [1]], ["floor", 1, 0, 10, 0, [-1]],
    ] as const) expect(() => w.trace(args[0], args[1], args[2], args[3], args[4], args[5])).toThrow("invalid");
  });

  it("agrees with a brute-force occupancy oracle for every pixel and flip", () => {
    const m = mask(Uint8Array.from({ length: 16 }, (_, i) => (i * 7) % 16));
    m.solid[6] = 0;
    for (const direction of [0, 1]) {
      m.direction = direction;
      for (const flip of [0, 0x400, 0x800, 0xc00]) {
        const w = world(0xf000 | flip, m);
        for (const side of ["floor", "ceiling", "leftWall", "rightWall"] as V5Surface[]) {
          for (let perpendicular = 0; perpendicular < 16; perpendicular++) {
            const vertical = side === "floor" || side === "ceiling";
            const descending = side === "ceiling" || side === "rightWall";
            let expected: number | null = null;
            for (let step = 0; step < 16; step++) {
              const axis = descending ? 15 - step : step;
              let x = vertical ? perpendicular : axis, y = vertical ? axis : perpendicular;
              if (flip & 0x400) x = 15 - x;
              if (flip & 0x800) y = 15 - y;
              if (m.solid[x] && (direction ? y <= m.heights[x] : y >= m.heights[x])) {
                expected = axis + (descending ? 1 : 0); break;
              }
            }
            expect(w.trace(side, perpendicular, descending ? 32 : -16, descending ? -16 : 32, 0, [0])?.position ?? null).toBe(expected);
          }
        }
      }
    }
  });
});
