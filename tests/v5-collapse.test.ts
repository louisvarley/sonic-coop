import { describe, expect, it } from "vitest";
import { V5Gameplay } from "../packages/engine/src/v5/gameplay.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { V5CollisionWorld } from "../packages/engine/src/v5/collision.js";
import { v5CollapseTiles, type V5Collapse } from "../packages/engine/src/v5/collapse.js";
import { renderV5Tiles } from "../packages/engine/src/v5/render.js";
import { movementFixture, FP } from "./v5-test-fixtures.js";

const platform: V5Collapse = { id: 20, kind: "collapse", x: 64 * FP, y: 144 * FP, plane: null,
  width: 64, height: 32, layer: 1, direction: 0, delay: 10, respawn: true };
function fixture(object = platform) {
  const base = movementFixture(), tiles = new Uint16Array(64 * 16).fill(0xffff);
  for (let y = 8; y < 10; y++) for (let x = 2; x < 6; x++) tiles[y * 64 + x] = 0xf000;
  const layers = [...base.world.layers, { width: 64, height: 16, tiles }];
  const world = new V5CollisionWorld(layers, base.world.paths), sim = new V5Movement(world, [0, 1],
    [{ x: 64 * FP, y: 100 * FP }, { x: 64 * FP, y: 100 * FP }]);
  return { game: new V5Gameplay(sim, [object], 512 * FP), world, tiles };
}

describe("v5 shared collapsing stage tiles", () => {
  it.each([0, 1])("triggers when player %i reaches it, without requiring the other player", (slot) => {
    const { game } = fixture(), state = game.capture();
    Object.assign(state.movement.players[slot], { y: 109 * FP, grounded: true });
    state.movement.players[1 - slot].x = 500 * FP;
    game.restore(state); game.tick([0, 0]);
    expect(game.capture().collapses).toEqual([{ id: 20, started: 1 }]);
  });

  it("does not trigger from airborne overlap or the wrong collision plane", () => {
    const { game } = fixture({ ...platform, plane: 1 });
    game.tick([0, 0]); expect(game.capture().collapses[0].started).toBeNull();
    const state = game.capture(); state.movement.players.forEach((p) => { p.grounded = true; }); game.restore(state);
    game.tick([0, 0]); expect(game.capture().collapses[0].started).toBeNull();
  });

  it("accepts uphill floor angles that wrap across zero rather than treating them as walls", () => {
    const { game } = fixture(), state = game.capture();
    Object.assign(state.movement.players[0], { grounded: true, y: 109 * FP, angle: 250 });
    state.movement.players[1].x = 500 * FP; game.restore(state); game.tick([0, 0]);
    expect(game.capture().collapses[0].started).toBe(1);
  });

  it("removes tiles in directional staggered waves after the configured delay", () => {
    const { world } = fixture();
    expect(v5CollapseTiles(platform, world.layers, 0, 12)).toEqual([]);
    expect(v5CollapseTiles(platform, world.layers, 0, 13)).toEqual([{ layer: 1, index: 9 * 64 + 2, fallTime: 0 }]);
    expect(v5CollapseTiles(platform, world.layers, 0, 16).map((tile) => tile.index)).toContain(8 * 64 + 2);
    const reversed = { ...platform, direction: 1 as const };
    expect(v5CollapseTiles(reversed, world.layers, 0, 19)).toEqual([{ layer: 1, index: 9 * 64 + 5, fallTime: 0 }]);
  });

  it("removes collision without modifying base assets and restores collision exactly on rollback", () => {
    const { game, world, tiles } = fixture(), original = tiles.slice(), initial = game.capture();
    const collapsed = game.capture(); collapsed.movement.frame = 100; collapsed.collapses[0].started = 0;
    game.restore(collapsed);
    expect(world.trace("floor", 64, 0, 159, 0, [1])).toBeNull();
    expect(tiles).toEqual(original);
    game.restore(initial);
    expect(world.trace("floor", 64, 0, 159, 0, [1])?.position).toBe(128);
    expect(tiles).toEqual(original);
  });

  it("drops both riders as shared support disappears and does not regenerate underneath nearby players", () => {
    const { game } = fixture();
    for (let frame = 0; frame < 250; frame++) game.tick([0, 0]);
    expect(game.capture().movement.players.every((p) => p.y === 141 * FP && p.grounded)).toBe(true);
    expect(game.capture().collapses[0].started).not.toBeNull();
    const away = game.capture(); away.movement.players.forEach((p) => { p.x = 800 * FP; }); game.restore(away);
    game.tick([0, 0]); expect(game.capture().collapses[0].started).toBeNull();
    expect(game.movement.world.trace("floor", 64, 0, 159, 0, [1])?.position).toBe(128);
  });

  it("keeps non-respawning collapse permanent and replays each wave exactly after restore", () => {
    const object = { ...platform, respawn: false }, { game: a } = fixture(object), { game: b } = fixture(object);
    for (let frame = 0; frame < 30; frame++) a.tick([0, 0]);
    b.restore(a.capture());
    for (let frame = 0; frame < 250; frame++) {
      expect(a.tick([0, 0])).toEqual(b.tick([0, 0])); expect(a.capture()).toEqual(b.capture());
    }
    const away = a.capture(); away.movement.players.forEach((p) => { p.x = 800 * FP; }); a.restore(away);
    a.tick([0, 0]); expect(a.capture().collapses[0].started).not.toBeNull();
  });

  it("renders falling tiles at their new position and leaves the background where collision was removed", () => {
    const { world } = fixture(), layer = world.layers[1], pixels = new Uint8Array(1024 * 256).fill(1),
      palette = new Uint8Array(768); palette.set([255, 0, 0], 3);
    const data = { layers: [{ ...layer, visible: true, drawGroup: 1 }], pixels, palette, background: { r: 0, g: 0, b: 0 } };
    const tile = 8 * 64 + 2;
    const before = renderV5Tiles(data, { x: 32, y: 120, width: 16, height: 64 });
    const falling = renderV5Tiles(data, { x: 32, y: 120, width: 16, height: 64,
      fallingTiles: [{ layer: 0, index: tile, fallTime: 16 }, { layer: 0, index: tile + 64, fallTime: 100 }] });
    expect(before[8 * 16 * 4]).toBe(255);
    expect(falling[8 * 16 * 4]).toBe(0);
    expect(falling[40 * 16 * 4]).toBe(255);
  });

  it("rejects malformed geometry and future trigger frames without changing the running world", () => {
    expect(() => fixture({ ...platform, width: 17 })).toThrow("collapsing");
    expect(() => fixture({ ...platform, x: 0 })).toThrow("outside");
    const { game } = fixture(), before = game.capture(), invalid = game.capture(); invalid.collapses[0].started = 1;
    expect(() => game.restore(invalid)).toThrow("collapse snapshot"); expect(game.capture()).toEqual(before);
    expect(() => game.movement.world.setRemovedTiles([{ layer: 9, index: 0 }])).toThrow("removed tile");
  });
});
