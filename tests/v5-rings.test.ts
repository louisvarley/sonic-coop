import { describe, expect, it } from "vitest";
import { V5Gameplay, type V5Object } from "../packages/engine/src/v5/gameplay.js";
import { scatterV5Rings, tickV5DroppedRings } from "../packages/engine/src/v5/rings.js";
import { FP, movementFixture } from "./v5-test-fixtures.js";

function fixture() {
  const { sim, world } = movementFixture();
  const hazard: V5Object = { id: 1, kind: "hazard", x: 64 * FP, y: 100 * FP, plane: null, halfWidth: 8, halfHeight: 8 };
  const game = new V5Gameplay(sim, [hazard], 512 * FP);
  return { game, world };
}

describe("v5 dropped-ring recovery", () => {
  it("scatters at most 32 unique rings in two deterministic speed groups", () => {
    const rings = scatterV5Rings(64 * FP, 100 * FP, 1, 99, 10);
    expect(rings).toHaveLength(32);
    expect(rings[0]).toMatchObject({ id: 10, vx: 0, vy: -4 * FP, plane: 1, age: 0 });
    expect(rings[16]).toMatchObject({ id: 26, vx: 0, vy: -2 * FP });
    expect(new Set(rings.map((ring) => ring.id)).size).toBe(32);
  });

  it("scatters the damaged player's rings, not the partner's, without duplicating static ring state", () => {
    const { game } = fixture(), state = game.capture();
    state.players[0].rings = 50; state.players[1].rings = 10; game.restore(state);
    expect(game.tick([0, 0])).toEqual([{ type: "hurt", player: 0, object: 1 }]);
    expect(game.capture().players.map((p) => p.rings)).toEqual([0, 10]);
    expect(game.capture().droppedRings).toHaveLength(32);
    expect(game.capture().collected).toEqual([]);
    expect(game.capture().nextRingId).toBe(32);
  });

  it("grants a 32-tick pickup delay and lets either player recover shared rings exactly once", () => {
    const { game } = fixture(), state = game.capture();
    state.players[0].invincible = 120;
    state.nextRingId = 2;
    state.droppedRings = [
      { id: 0, x: 128 * FP, y: 100 * FP, vx: 0, vy: 0, plane: 0, age: 30 },
      { id: 1, x: 128 * FP, y: 100 * FP, vx: 0, vy: 0, plane: 1, age: 31 },
    ];
    game.restore(state);
    expect(game.tick([0, 0])).toEqual([]);
    expect(game.capture().droppedRings).toHaveLength(2);
    expect(game.tick([0, 0])).toEqual([{ type: "ring", player: 1, object: null }]);
    expect(game.capture().players[1].rings).toBe(1);
    expect(game.capture().droppedRings.map((ring) => ring.id)).toEqual([1]);
    const shared = game.capture();
    shared.movement.players[0].plane = 1; shared.movement.players[0].x = 128 * FP; game.restore(shared);
    expect(game.tick([0, 0])).toEqual([{ type: "ring", player: 0, object: null }]);
    expect(game.capture().droppedRings).toEqual([]);
  });

  it("bounces off floors, walls and ceilings without tunneling, and expires exactly at 256 ticks", () => {
    const { world } = fixture(), ring = scatterV5Rings(64 * FP, 150 * FP, 0, 1, 0)[0];
    Object.assign(ring, { vx: 0, vy: 16 * FP });
    const bounced = tickV5DroppedRings([ring], world, [0], 512 * FP);
    expect(bounced[0].y / FP).toBe(156); expect(bounced[0].vy).toBeLessThan(0);
    expect(tickV5DroppedRings([{ ...ring, age: 255 }], world, [0], 512 * FP)).toEqual([]);
    expect(tickV5DroppedRings([{ ...ring, age: 254 }], world, [0], 512 * FP)[0].age).toBe(255);
    const layer = world.layers[0];
    for (let y = 0; y < 10; y++) layer.tiles[y * layer.width + 10] = 0xf000;
    const wall = tickV5DroppedRings([{ ...ring, x: 150 * FP, y: 100 * FP, vx: 16 * FP, vy: 0 }], world, [0], 512 * FP)[0];
    expect(wall.x / FP).toBe(156); expect(wall.vx).toBeLessThan(0);
    for (let x = 0; x < layer.width; x++) layer.tiles[3 * layer.width + x] = 0xf000;
    const roof = tickV5DroppedRings([{ ...ring, y: 74 * FP, vx: 0, vy: -16 * FP }], world, [0], 512 * FP)[0];
    expect(roof.y / FP).toBe(68); expect(roof.vy).toBeGreaterThan(0);
  });

  it("does not scatter rings when a shield absorbs damage, and replays scattering/pickups exactly", () => {
    const { game: a } = fixture(), { game: b } = fixture(), shielded = a.capture();
    shielded.players[0].shield = "blue"; shielded.players[0].rings = 10; a.restore(shielded);
    a.tick([0, 0]);
    expect(a.capture().players[0].rings).toBe(10); expect(a.capture().droppedRings).toEqual([]);
    const vulnerable = a.capture();
    vulnerable.players[0].invincible = 0;
    Object.assign(vulnerable.movement.players[0], { x: 64 * FP, y: 100 * FP, vx: 0, vy: 0 });
    a.restore(vulnerable); a.tick([0, 0]); b.restore(a.capture());
    for (let frame = 0; frame < 300; frame++) {
      expect(a.tick([0, 0])).toEqual(b.tick([0, 0])); expect(a.capture()).toEqual(b.capture());
    }
  });

  it("rejects invalid ring snapshots atomically", () => {
    const { game } = fixture(), before = game.capture(), ring = scatterV5Rings(64 * FP, 100 * FP, 0, 1, 0)[0];
    for (const change of [{ id: 2 }, { age: 256 }, { plane: 2 }, { vx: 17 * FP }, { x: NaN }]) {
      const invalid = game.capture(); invalid.nextRingId = 1; invalid.droppedRings = [{ ...ring, ...change }];
      expect(() => game.restore(invalid)).toThrow("snapshot"); expect(game.capture()).toEqual(before);
    }
    const duplicate = game.capture(); duplicate.nextRingId = 1; duplicate.droppedRings = [ring, ring];
    expect(() => game.restore(duplicate)).toThrow("snapshot"); expect(game.capture()).toEqual(before);
  });
});
