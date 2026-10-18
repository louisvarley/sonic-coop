import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BTN } from "../packages/engine/src/input.js";
import { V5CollisionWorld } from "../packages/engine/src/v5/collision.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { readRsdkV5GameConfig } from "../tools/rsdkv5-config.js";
import { loadRsdkV5Stage } from "../tools/rsdkv5-stage.js";

import { FP, movementFixture as fixture } from "./v5-test-fixtures.js";
function settle(sim: V5Movement) { for (let frame = 0; frame < 60; frame++) sim.tick([0, 0]); }

describe("experimental v5 upright movement", () => {
  it("settles onto tiles, moves players independently and decelerates on the ground", () => {
    const { sim } = fixture();
    settle(sim);
    expect(sim.capture().players.map((p) => [p.y / FP, p.grounded])).toEqual([[141, true], [141, true]]);
    for (let i = 0; i < 60; i++) sim.tick([BTN.RIGHT, 0]);
    const moved = sim.capture();
    expect(moved.players[0].x).toBeGreaterThan(64 * FP);
    expect(moved.players[1].x).toBe(128 * FP);
    for (let i = 0; i < 150; i++) sim.tick([0, 0]);
    expect(sim.capture().players[0].vx).toBe(0);
    expect(sim.capture().players[0].grounded).toBe(true);
  });

  it("jumps on press edges, uses variable jump height and does not autojump while held", () => {
    const { sim: held } = fixture(), { sim: released } = fixture();
    settle(held); settle(released);
    held.tick([BTN.A, 0]); released.tick([BTN.A, 0]);
    let heldMin = Infinity, releasedMin = Infinity;
    for (let i = 0; i < 90; i++) {
      held.tick([BTN.A, 0]); released.tick([0, 0]);
      heldMin = Math.min(heldMin, held.capture().players[0].y);
      releasedMin = Math.min(releasedMin, released.capture().players[0].y);
    }
    expect(heldMin).toBeLessThan(releasedMin);
    expect(held.capture().players[0]).toMatchObject({ y: 141 * FP, grounded: true, vy: 0 });
    held.tick([0, 0]); held.tick([BTN.B, 0]);
    expect(held.capture().players[0].vy).toBeLessThan(0);
  });

  it("stops at walls and ceilings without tunneling through a tile", () => {
    const { sim, tiles } = fixture();
    for (let y = 0; y < 10; y++) tiles[y * 64 + 20] = 0xf000;
    settle(sim);
    for (let i = 0; i < 150; i++) sim.tick([BTN.RIGHT, 0]);
    expect(sim.capture().players[0].x / FP).toBe(20 * 16 - 9);
    expect(sim.capture().players[0].vx).toBe(0);
    const roof = fixture();
    for (let x = 0; x < 64; x++) roof.tiles[5 * 64 + x] = 0xf000;
    settle(roof.sim);
    let minimumY = Infinity;
    for (let i = 0; i < 40; i++) { roof.sim.tick([BTN.A, 0]); minimumY = Math.min(minimumY, roof.sim.capture().players[0].y); }
    expect(minimumY / FP).toBeGreaterThanOrEqual(96 + 19);
    expect(roof.sim.capture().players[0].grounded).toBe(true);
  });

  it("keeps top-only tiles one-way", () => {
    const { sim, tiles } = fixture();
    for (let x = 0; x < 64; x++) tiles[6 * 64 + x] = 0x1000;
    settle(sim);
    // Spawn starts below the one-way platform; an upward jump passes through it.
    expect(sim.capture().players[0].y / FP).toBe(141);
    let minimumY = Infinity;
    for (let i = 0; i < 90; i++) { sim.tick([BTN.A, 0]); minimumY = Math.min(minimumY, sim.capture().players[0].y); }
    expect(minimumY / FP).toBeLessThan(96 - 19);
    expect(sim.capture().players[0]).toMatchObject({ y: (96 - 19) * FP, grounded: true });
  });

  it("climbs an upright ramp and loses support after walking off a ledge", () => {
    const { world, sim, tiles } = fixture();
    const slope = { ...world.paths[0][0], heights: Uint8Array.from({ length: 16 }, (_, x) => 15 - x), floorAngle: 224 };
    const paths = world.paths.map((path) => path.map((mask, index) => index === 1 ? slope : mask));
    tiles[9 * 64 + 8] = 0xf001;
    for (let x = 9; x < 64; x++) tiles[9 * 64 + x] = 0xf000;
    const ramp = new V5Movement(new V5CollisionWorld(world.layers, paths), [0], [{ x: 96 * FP, y: 100 * FP }]);
    for (let i = 0; i < 60; i++) ramp.tick([0]);
    for (let i = 0; i < 70; i++) ramp.tick([BTN.RIGHT]);
    expect(ramp.capture().players[0].x).toBeGreaterThan(160 * FP);
    expect(ramp.capture().players[0]).toMatchObject({ y: 125 * FP, grounded: true });
    // Reset the shared fixture into a platform ending at x=128.
    for (let x = 8; x < 64; x++) { tiles[9 * 64 + x] = 0xffff; tiles[10 * 64 + x] = 0xffff; }
    settle(sim);
    for (let i = 0; i < 80; i++) sim.tick([BTN.RIGHT, 0]);
    expect(sim.capture().players[0].grounded).toBe(false);
    expect(sim.capture().players[0].y).toBeGreaterThan(141 * FP);
  });

  it("replays exactly after snapshot restore including jump-edge state and both players", () => {
    const { sim: a } = fixture(), { sim: b } = fixture();
    settle(a); settle(b);
    const inputs = Array.from({ length: 300 }, (_, i) => [
      (i < 90 ? BTN.RIGHT : i < 150 ? BTN.LEFT : 0) | (i % 70 < 20 ? BTN.A : 0),
      (i % 80 < 30 ? BTN.RIGHT : 0) | (i % 110 < 50 ? BTN.B : 0),
    ]);
    for (const pads of inputs.slice(0, 105)) a.tick(pads);
    const snapshot = a.capture();
    b.restore(snapshot);
    snapshot.players[0].x = 0;
    for (const pads of inputs.slice(105)) { a.tick(pads); b.tick(pads); expect(b.capture()).toEqual(a.capture()); }
  });

  it("validates inputs and snapshots atomically", () => {
    const { sim } = fixture();
    const before = sim.capture();
    for (const pads of [[], [1], [1, NaN], [0, 0x10000], [0, -1]]) {
      expect(() => sim.tick(pads)).toThrow("inputs");
      expect(sim.capture()).toEqual(before);
    }
    for (const change of [{ x: NaN }, { plane: 2 }, { vy: 99 * FP }, { pad: -1 }]) {
      const invalid = sim.capture(); Object.assign(invalid.players[1], change);
      expect(() => sim.restore(invalid)).toThrow("snapshot");
      expect(sim.capture()).toEqual(before);
    }
  });
});

const local = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(local))("local Angel Island locomotion", () => {
  it("lands both players on real foreground collision and simulates deterministic movement", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(local));
    const config = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
    const stage = loadRsdkV5Stage(archive, config, "Data/Stages/3K_AIZ1/Scene1.bin");
    if (!stage.collision) throw new Error("Angel Island collision data is missing");
    const world = new V5CollisionWorld(stage.scene.layers, stage.collision);
    const layers = stage.scene.layers.flatMap((layer, index) => layer.name === "FG Low" || layer.name === "FG High" ? [index] : []);
    expect(layers).toHaveLength(2);
    const player = stage.scene.objects.find((_, index) => stage.objectNames[index] === "Player")?.entities[0];
    if (!player) throw new Error("Angel Island player marker is missing");
    const spawns = [{ x: player.x, y: player.y }, { x: player.x + 32 * FP, y: player.y }];
    const a = new V5Movement(world, layers, spawns), b = new V5Movement(world, layers, spawns);
    let landed = [false, false];
    for (let frame = 0; frame < 300; frame++) {
      const pads = [frame > 60 ? BTN.RIGHT : 0, frame > 120 ? BTN.RIGHT : 0];
      a.tick(pads); b.tick(pads);
      a.capture().players.forEach((p, i) => { landed[i] ||= p.grounded; });
      expect(a.capture()).toEqual(b.capture());
    }
    expect(landed).toEqual([true, true]);
    expect(a.capture().players[0].x).toBeGreaterThan(player.x + 100 * FP);
    expect(a.capture().players[1].x).toBeGreaterThan(player.x + 100 * FP);
  });
});
