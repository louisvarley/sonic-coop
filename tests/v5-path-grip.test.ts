import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { V5CollisionWorld, type V5CollisionMask } from "../packages/engine/src/v5/collision.js";
import { v5CollisionMode, v5SurfaceVelocity, v5GroundSpeed } from "../packages/engine/src/v5/path-grip.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

function loopFixture() {
  const width = 32, cx = 256, cy = 256, radius = 96, tiles = new Uint16Array(width * width);
  const masks = Array.from({ length: tiles.length }, (_, index): V5CollisionMask => {
    const tx = index % width, ty = Math.floor(index / width), direction = ty * 16 < cy ? 1 : 0;
    const heights = new Uint8Array(16), solid = new Uint8Array(16);
    for (let x = 0; x < 16; x++) {
      const ys = Array.from({ length: 16 }, (_, y) => y)
        .filter((y) => Math.hypot(tx * 16 + x + 0.5 - cx, ty * 16 + y + 0.5 - cy) >= radius);
      if (ys.length) { solid[x] = 1; heights[x] = direction ? Math.max(...ys) : Math.min(...ys); }
    }
    const angle = Math.round(Math.atan2(ty * 16 + 8 - cy, tx * 16 + 8 - cx) * 128 / Math.PI - 64) & 255;
    tiles[index] = 0xf000 | index;
    return { heights, solid, direction, floorAngle: angle, roofAngle: angle, leftWallAngle: angle, rightWallAngle: angle, flags: 0 };
  });
  const world = new V5CollisionWorld([{ width, height: width, tiles }], [masks, masks]);
  const sim = new V5Movement(world, [0], [{ x: cx * FP, y: (cy + radius - 19) * FP }]);
  const state = sim.capture(); Object.assign(state.players[0], { grounded: true, vx: 12 * FP }); sim.restore(state);
  return sim;
}

describe("experimental v5 four-quadrant surface grip", () => {
  it.each([-1, 1])("runs a complete loop in direction %i through all four quadrants without losing contact", (direction) => {
    const sim = loopFixture(), modes = new Set<number>();
    const initial = sim.capture(); initial.players[0].vx *= direction; sim.restore(initial);
    let rotation = 0, previous = 0;
    for (let frame = 0; frame < 100; frame++) {
      sim.tick([direction > 0 ? BTN.RIGHT : BTN.LEFT]); const player = sim.capture().players[0];
      expect(player.grounded, `lost loop grip at frame ${frame}: ${JSON.stringify(player)}`).toBe(true);
      modes.add(v5CollisionMode(player.angle));
      rotation += ((player.angle - previous + 128) & 255) - 128; previous = player.angle;
      expect(Math.hypot(player.x / FP - 256, player.y / FP - 256)).toBeLessThan(96);
    }
    expect([...modes].sort()).toEqual([0, 1, 2, 3]);
    expect(rotation * direction).toBeLessThan(-256);
  });

  it("jumps away from walls and ceilings along the surface normal", () => {
    for (const mode of [1, 2, 3]) {
      const sim = loopFixture();
      for (let frame = 0; frame < 100 && v5CollisionMode(sim.capture().players[0].angle) !== mode; frame++) sim.tick([BTN.RIGHT]);
      const previous = sim.capture().players[0];
      expect(v5CollisionMode(previous.angle)).toBe(mode);
      const tangent = v5SurfaceVelocity(v5GroundSpeed(previous), previous.angle);
      sim.tick([BTN.RIGHT | BTN.A]); const jumped = sim.capture().players[0];
      expect(jumped.grounded).toBe(false); expect(jumped.jumping).toBe(true);
      const deltaX = jumped.vx - tangent.x, deltaY = jumped.vy - tangent.y;
      if (mode === 1) expect(deltaX).toBeGreaterThan(4 * FP);
      if (mode === 2) expect(deltaY).toBeGreaterThan(4 * FP);
      if (mode === 3) expect(deltaX).toBeLessThan(-4 * FP);
    }
  });

  it("falls from walls when speed is too low instead of clinging indefinitely", () => {
    const sim = loopFixture();
    while (v5CollisionMode(sim.capture().players[0].angle) !== 3) sim.tick([BTN.RIGHT]);
    const state = sim.capture(), velocity = v5SurfaceVelocity(FP, state.players[0].angle);
    state.players[0].vx = velocity.x; state.players[0].vy = velocity.y; sim.restore(state);
    sim.tick([0]); expect(sim.capture().players[0]).toMatchObject({ grounded: false, controlLock: 16 });
  });

  it("loses momentum uphill and gains momentum downhill instead of treating slopes as flat ground", () => {
    const sim = loopFixture();
    while (v5CollisionMode(sim.capture().players[0].angle) !== 3) sim.tick([BTN.RIGHT]);
    const before = sim.capture(), speed = v5GroundSpeed(before.players[0]);
    sim.tick([0]); expect(v5GroundSpeed(sim.capture().players[0])).toBeLessThan(speed);
    before.players[0].vx *= -1; before.players[0].vy *= -1; sim.restore(before);
    sim.tick([0]); expect(v5GroundSpeed(sim.capture().players[0])).toBeLessThan(-speed);
  });

  it.each([-1, 1])("converts falling momentum into slope motion in direction %i", (direction) => {
    const { world, tiles } = movementFixture();
    const slope = { ...world.paths[0][0], heights: Uint8Array.from({ length: 16 }, (_, x) => direction === 1 ? x : 15 - x),
      floorAngle: direction === 1 ? 32 : 224 };
    const paths = world.paths.map((path) => path.map((mask, index) => index === 1 ? slope : mask));
    tiles[9 * 64 + 8] = 0xf001;
    const sim = new V5Movement(new V5CollisionWorld(world.layers, paths), [0], [{ x: 136 * FP, y: 90 * FP }]);
    const initial = sim.capture(); initial.players[0].vy = 5 * FP; sim.restore(initial);
    for (let frame = 0; frame < 20 && !sim.capture().players[0].grounded; frame++) sim.tick([0]);
    expect(sim.capture().players[0].grounded).toBe(true);
    expect(sim.capture().players[0].vx * direction).toBeGreaterThan(2 * FP);
    expect(sim.capture().players[0].vy).toBeGreaterThan(2 * FP);
  });

  it("does not turn a square wall into a climbable loop and replays loop transitions exactly", () => {
    const { sim, tiles } = movementFixture();
    for (let y = 0; y < 10; y++) tiles[y * 64 + 10] = 0xf000;
    for (let frame = 0; frame < 120; frame++) sim.tick([BTN.RIGHT, 0]);
    expect(sim.capture().players[0]).toMatchObject({ x: 151 * FP, grounded: true, vx: 0 });
    const a = loopFixture(), b = loopFixture();
    for (let frame = 0; frame < 25; frame++) a.tick([BTN.RIGHT]);
    b.restore(a.capture());
    for (let frame = 0; frame < 100; frame++) {
      a.tick([BTN.RIGHT]); b.tick([BTN.RIGHT]); expect(b.capture()).toEqual(a.capture());
    }
  });
});
