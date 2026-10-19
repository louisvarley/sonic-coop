import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writePak, type PakEntry } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { readV5Level } from "../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../packages/engine/src/v5/collision.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { BTN } from "../packages/engine/src/input.js";
import { V5Gameplay, v5PlatformAt } from "../packages/engine/src/v5/gameplay.js";
import { renderV5Tiles } from "../packages/engine/src/v5/render.js";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { exportV5AngelIsland } from "../tools/export-rsdkv5.js";
import { readRsdkV5Gif } from "../tools/rsdkv5-tileset.js";
import { readRsdkV5Animation } from "../tools/rsdkv5-animation.js";
import { cos256LookupTable, sin256LookupTable } from "../packages/engine/src/math.js";
import { v5SwingRopeAt } from "../packages/engine/src/v5/ropes.js";

function fixture(change: Record<string, unknown> = {}, missing?: string) {
  const entries: PakEntry[] = [];
  const add = (name: string, data: Uint8Array) => {
    if (name !== missing) entries.push({ key: rsdkPathKey(name), data });
  };
  const metadata = {
    version: 6, title: "Fixture", background: { r: 1, g: 2, b: 3 },
    layers: [{ width: 1, height: 1, visible: true, drawGroup: 1 }], collisionLayers: [0],
    spawns: [{ x: 0, y: 0 }], deathY: 1024 * 65536, objects: [], unsupported: [], sprites: [], objectSprites: [], missingAssets: [],
    ...change,
  };
  add("meta.json", new TextEncoder().encode(JSON.stringify(metadata)));
  add("tiles.bin", new Uint8Array(1024 * 256)); add("palette.rgb", new Uint8Array(768));
  add("layer0.bin", Uint8Array.of(255, 255));
  add("collision0.bin", new Uint8Array(1024 * 38)); add("collision1.bin", new Uint8Array(1024 * 38));
  return writePak(entries);
}

describe("experimental v5 browser level pack", () => {
  it("roundtrips exact geometry and constructs the same shared gameplay engine", () => {
    const level = readV5Level(fixture());
    expect(level.title).toBe("Fixture");
    expect(level.layers[0].tiles).toEqual(Uint16Array.of(0xffff));
    expect(level.collision).toHaveLength(2);
    const gameplay = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    expect(gameplay.tick([0])).toEqual([]);
    expect(gameplay.capture().movement.frame).toBe(1);
    expect(renderV5Tiles(level, { x: 0, y: 0, width: 1, height: 1 })).toEqual(Uint8Array.of(1, 2, 3, 255));
  });

  it("checks the container signature, version, truncated tables and all resource ranges", () => {
    const bytes = fixture();
    for (const end of [0, 4, 11, 20, bytes.length - 1]) expect(() => readV5Level(bytes.subarray(0, end))).toThrow();
    const bad = bytes.slice(), view = new DataView(bad.buffer);
    view.setUint32(0, 0, true); expect(() => readV5Level(bad)).toThrow("header");
    view.setUint32(0, 0x4b504c52, true); view.setUint32(4, 2, true);
    expect(() => readV5Level(bad)).toThrow("header");
    view.setUint32(4, 1, true); view.setUint32(8, 1025, true);
    expect(() => readV5Level(bad)).toThrow("table");
    const range = bytes.slice(); new DataView(range.buffer).setUint32(28, bytes.length + 1, true);
    expect(() => readV5Level(range)).toThrow("entry");
    const duplicate = bytes.slice(); duplicate.set(duplicate.subarray(12, 28), 36);
    expect(() => readV5Level(duplicate)).toThrow("entry");
  });

  it("renders nonzero foreground pixels opaquely without covering players with empty pixels", () => {
    const level = readV5Level(fixture());
    level.layers[0].tiles[0] = 0;
    level.pixels[0] = 1; level.palette.set([90, 80, 70], 3);
    expect(renderV5Tiles(level, { x: 0, y: 0, width: 2, height: 1, transparent: true }))
      .toEqual(Uint8Array.of(90, 80, 70, 255, 0, 0, 0, 0));
  });

  it("rejects malformed metadata, unsupported versions and missing resources explicitly", () => {
    for (const change of [
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 7 }, { title: 1 }, { missingAssets: [0] }, { missingAssets: null },
      { layers: null }, { layers: [{ width: 1, height: 1, visible: 1, drawGroup: 0 }] },
      { spawns: [] }, { collisionLayers: [] }, { collisionLayers: [1] }, { background: { r: 256, g: 0, b: 0 } },
      { objects: [{ kind: "unknown", id: 1, x: 0, y: 0, plane: null }] },
      { objects: [{ kind: "fling-ramp", id: 1, x: 0, y: 0, plane: null, direction: 3 }] },
      { objects: [{ kind: "ring", id: 1, x: 0, y: 0, plane: 2 }] },
      { objects: [{ kind: "water", id: 1, x: 0, y: 0, plane: 0 }] },
      { objects: [{ kind: "water", id: 1, x: 0, y: 0, plane: null }, { kind: "water", id: 2, x: 0, y: 0, plane: null }] },
      { objects: [{ kind: "block", id: 1, x: 0, y: 0, plane: null, halfWidth: 1, halfHeight: 1,
        ignoreTop: 1, ignoreBottom: false, ignoreLeft: false, ignoreRight: false }] },
      { objects: [{ kind: "cyclone", id: 1, x: 0, y: 0, plane: null, facing: 0, sprite: 0 }] },
      { objects: [{ kind: "saruder", id: 1, x: 0, y: 0, plane: null, facing: -1, sprite: 0 }] },
      { objects: [{ kind: "spikes", id: 1, x: 0, y: 0, plane: null, direction: 4, count: 2, moving: true, stagger: 0, timer: 0 }] },
      { objects: [{ kind: "spikes", id: 1, x: 0, y: 0, plane: null, direction: 0, count: 2, moving: true, stagger: 0, timer: 64 }] },
      { objects: [{ kind: "platform", id: 1, x: 0, y: 0, plane: null,
        amplitudeX: 0, amplitudeY: 0, speed: 3, phase: 0, halfWidth: 32, top: -19, sprite: 0 }] },
      { objects: [{ kind: "rock", id: 1, x: 0, y: 0, plane: null, halfWidth: 23, top: -15, bottom: 16,
        smashTop: false, smashSides: false, restricted: false, sprite: 0, frame: 0 }] },
      { objects: [{ kind: "rock", id: 1, x: 0, y: 0, plane: null, halfWidth: 23, top: 16, bottom: 16,
        smashTop: false, smashSides: false, restricted: false, sprite: 0, frame: 0 }] },
    ]) expect(() => readV5Level(fixture(change))).toThrow();
    for (const name of ["meta.json", "layer0.bin", "tiles.bin", "palette.rgb", "collision0.bin", "collision1.bin"]) {
      expect(() => readV5Level(fixture({}, name))).toThrow("resource");
    }
  });

  it("rejects duplicate object ids and preserves diagnostics and static object parameters", () => {
    const object = { id: 1, kind: "spring", x: 123, y: -456, plane: null, vx: 0, vy: -655360 };
    const level = readV5Level(fixture({ objects: [object], unsupported: [{ name: "Boss", count: 1 }],
      missingAssets: ["Data/Music/3K/AngelIsland1.ogg"] }));
    expect(level.objects).toEqual([object]);
    expect(level.unsupported).toEqual([{ name: "Boss", count: 1 }]);
    expect(level.missingAssets).toEqual(["Data/Music/3K/AngelIsland1.ogg"]);
    expect(() => readV5Level(fixture({ objects: [object, object] }))).toThrow("duplicate");
  });
});

const local = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(local))("real Sonic 3 offline-to-browser export", () => {
  it("exports and launches either player from the actual one-way fling ramp", () => {
    const level = readV5Level(exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(local))));
    const ramp = level.objects.find((object) => object.kind === "fling-ramp");
    expect(ramp).toMatchObject({ id: 159, x: 9168 * 65536, y: 1224 * 65536, direction: 1 });
    if (!ramp) throw new Error("missing actual fling ramp");
    expect(level.unsupported.some((object) => object.name === "FlingRamp")).toBe(false);
    for (const slot of [0, 1]) {
      const game = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
        level.collisionLayers, level.spawns), level.objects, level.deathY);
      const state = game.capture();
      Object.assign(state.movement.players[slot], { x: ramp.x - 8 * 65536, y: ramp.y - 19 * 65536,
        vx: 4 * 65536, vy: 0, grounded: true, facing: 1 });
      game.restore(state);
      expect(game.tick([0, 0])).toContainEqual({ type: "ramp", player: slot, object: ramp.id });
      expect(game.capture().movement.players[slot].grounded).toBe(false);
      expect(game.capture().movement.players[slot].vy).toBeLessThan(0);
    }
  });

  it("exports exact rock sprites and lets either player break every supported actual pile", () => {
    const level = readV5Level(exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(local))));
    const rocks = level.objects.filter((object) => object.kind === "rock");
    expect(rocks.map((object) => object.id)).toEqual([165, 166, 167, 168, 169, 170, 171, 172]);
    expect(level.unsupported.find((object) => object.name === "AIZRockPile")?.count).toBe(1);
    for (const object of rocks) {
      expect(level.objectSprites[object.sprite].animations[0].frames[object.frame]).toMatchObject(
        [{ width: 46, height: 31 }, { width: 46, height: 47 }, { width: 48, height: 79 }][object.frame]);
      for (const slot of [0, 1]) {
        const game = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
          level.collisionLayers, level.spawns), level.objects, level.deathY);
        const state = game.capture(), topAttack = object.smashTop || !object.smashSides;
        Object.assign(state.movement.players[slot], { x: object.x - (topAttack ? 0 : (object.halfWidth + 10) * 65536),
          y: object.y + (topAttack ? object.top - 15 : object.bottom - 14) * 65536,
          vx: topAttack ? 0 : 5 * 65536, vy: topAttack ? 2 * 65536 : 0,
          rolling: true, jumping: topAttack, grounded: !topAttack });
        game.restore(state);
        expect(game.tick([0, 0]), `pile ${object.id}, player ${slot}`).toContainEqual({ type: "rock", player: slot, object: object.id });
        expect(game.capture().broken).toContain(object.id);
      }
    }
  });

  it("traverses the actual stage with combat and pickups while restoring the complete shared world", () => {
    const level = readV5Level(exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(local))));
    const create = () => new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    const game = create(), mirror = create(), events = new Set<string>();
    let maxX = level.spawns[0].x;
    for (let frame = 0; frame < 2400; frame++) {
      const pads = [BTN.RIGHT | (frame % 60 < 20 ? BTN.A : 0), BTN.RIGHT | (frame % 75 < 40 ? BTN.A : 0)];
      for (const event of game.tick(pads)) events.add(event.type);
      const state = game.capture(); maxX = Math.max(maxX, state.movement.players[0].x);
      if (frame % 100 === 0) {
        mirror.restore(state);
        expect(mirror.capture()).toEqual(state);
      }
    }
    expect(maxX / 65536).toBeGreaterThan(8000);
    expect(events.has("enemy")).toBe(true);
    expect(events.has("ring")).toBe(true);
    expect(game.capture().enemyWorld.enemies.some((enemy) => enemy.defeated)).toBe(true);
  });

  it("applies both sides of every actual stage plane switch for either player", () => {
    const level = readV5Level(exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(local))));
    const game = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    const initial = game.capture();
    for (const object of level.objects.filter((object) => object.kind === "plane-switch")) {
      for (const direction of [-1, 1]) {
        const flags = object.flags >>> (direction > 0 ? 2 : 0), plane = (flags >>> 1) & 1, priority = !!(flags & 1);
        for (let slot = 0; slot < 2; slot++) {
          const state = structuredClone(initial), player = state.movement.players[slot];
          Object.assign(player, {
            x: object.x + direction * 8 * cos256LookupTable[object.angle] * 256,
            y: object.y - direction * 8 * sin256LookupTable[object.angle] * 256,
            plane: 1 - plane, highPriority: !priority, grounded: true,
          });
          state.players[slot].invincible = 180; game.restore(state);
          expect(game.tick([0, 0]), `switch ${object.id}, side ${direction}, player ${slot}`)
            .toContainEqual({ type: "plane", player: slot, object: object.id });
          expect(game.capture().movement.players[slot]).toMatchObject({ plane, highPriority: priority });
        }
      }
    }
  });

  it("grabs every actual swinging rope with either player and releases independently", () => {
    const level = readV5Level(exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(local))));
    for (const object of level.objects.filter((entry) => entry.kind === "swing-rope")) {
      const world = new V5CollisionWorld(level.layers, level.collision), handle = v5SwingRopeAt(object, 0);
      const game = new V5Gameplay(new V5Movement(world, level.collisionLayers, [
        { x: handle.x, y: handle.y + 19 * 65536 }, { x: handle.x + 4 * 65536, y: handle.y + 19 * 65536 },
      ]), [object], level.deathY);
      game.tick([0, 0]);
      expect(game.capture().movement.players.map((p) => p.grabObject), `both players grab actual rope ${object.id}`)
        .toEqual([object.id, object.id]);
      game.tick([BTN.A, 0]);
      expect(game.capture().movement.players.map((p) => p.grabObject)).toEqual([null, object.id]);
    }
  });

  it("lands both players on each actual collapsing platform, removes collision and restores its original tiles", () => {
    const level = readV5Level(exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(local))));
    for (const object of level.objects.filter((entry) => entry.kind === "collapse")) {
      const world = new V5CollisionWorld(level.layers, level.collision), top = Math.floor(object.y / 65536 - object.height / 2);
      const x = Math.floor(object.x / 65536), support = world.trace("floor", x, top - 16, top + object.height, 0, [object.layer]);
      expect(support, `actual collapsing platform ${object.id} needs collidable tiles`).not.toBeNull();
      expect(level.layers[object.layer].visible).toBe(true);
      const original = level.layers[object.layer].tiles.slice();
      const game = new V5Gameplay(new V5Movement(world, [object.layer], [
        { x: object.x, y: (top - 40) * 65536 }, { x: object.x + 4 * 65536, y: (top - 40) * 65536 },
      ]), [object], level.deathY);
      const initial = game.capture(), landed = [false, false];
      for (let frame = 0; frame < 150; frame++) {
        game.tick([0, 0]);
        game.capture().movement.players.forEach((player, slot) => { landed[slot] ||= player.grounded; });
      }
      expect(landed, `both players must land on actual collapse ${object.id}`).toEqual([true, true]);
      expect(game.capture().collapses[0].started).not.toBeNull();
      expect(world.trace("floor", x, top - 16, top + object.height, 0, [object.layer])).toBeNull();
      expect(level.layers[object.layer].tiles).toEqual(original);
      game.restore(initial);
      expect(world.trace("floor", x, top - 16, top + object.height, 0, [object.layer])).toEqual(support);
    }
  });

  it("exports actual player sprites, supported objects and foreground collision with explicit missing behavior", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(local));
    const bytes = exportV5AngelIsland(archive);
    const level = readV5Level(bytes);
    expect(level.sprites.map((sprite) => sprite.name)).toEqual(["Sonic", "Tails"]);
    for (const sprite of level.sprites) {
      expect(sprite.animations.map((animation) => animation.name)).toEqual(["Idle", "Walk", "Jump", "Crouch", "Spindash", "HangGimmick",
        ...(sprite.name === "Tails" ? ["Fly", "Fly Tired"] : [])]);
      expect(sprite.pixels.length).toBe(sprite.width * sprite.height);
      const animations = readRsdkV5Animation(archive.read(`Data/Sprites/3K_Players/${sprite.name}.bin`));
      const sheet = readRsdkV5Gif(archive.read(`Data/Sprites/${animations.sheets[0]}`));
      expect(sprite.palette).toEqual(sheet.palette);
    }
    expect(level.objects.filter((o) => o.kind === "ring")).toHaveLength(104);
    expect(level.objects.some((o) => o.kind === "checkpoint")).toBe(true);
    expect(level.objects.some((o) => o.kind === "spring")).toBe(true);
    expect(level.objects.filter((o) => o.kind === "spring")).toHaveLength(12);
    expect(level.objects.filter((o) => o.kind === "spikes")).toHaveLength(9);
    expect(level.objects.some((o) => o.kind === "spring" && o.vx === -10 * 65536)).toBe(true);
    expect(level.objects.some((o) => o.kind === "spring" && o.vx === 16 * 65536)).toBe(true);
    expect(level.objects.filter((o) => o.kind === "spikes" && o.moving)).toHaveLength(2);
    expect(level.objects.filter((o) => o.kind === "platform")).toHaveLength(3);
    expect(level.objects.filter((o) => o.kind === "monitor")).toHaveLength(11);
    expect(level.objects.filter((o) => o.kind === "rock")).toHaveLength(8);
    expect(level.objects.filter((o) => o.kind === "block")).toHaveLength(2);
    expect(level.objects.filter((o) => o.kind === "cyclone")).toHaveLength(3);
    expect(level.objects.filter((o) => o.kind === "saruder")).toHaveLength(5);
    expect(level.objects.filter((o) => o.kind === "tulippon")).toHaveLength(2);
    expect(level.objects.filter((o) => o.kind === "water")).toHaveLength(1);
    expect(level.objects.filter((o) => o.kind === "collapse")).toHaveLength(4);
    expect(level.objects.filter((o) => o.kind === "swing-rope")).toHaveLength(4);
    expect(level.unsupported.some((o) => o.name === "SwingRope")).toBe(false);
    expect(level.unsupported.some((o) => o.name === "CollapsingPlatform")).toBe(false);
    expect(level.unsupported.some((o) => o.name === "Water")).toBe(false);
    expect(level.unsupported.some((o) => ["Cyclone", "Saruder", "Tulippon"].includes(o.name))).toBe(false);
    expect(level.unsupported.some((o) => o.name === "InvisibleBlock")).toBe(false);
    expect(level.unsupported.some((o) => o.name === "ItemBox")).toBe(false);
    expect(level.objectSprites[0].animations[0].frames[0]).toMatchObject({ width: 64, height: 39, pivotX: -32, pivotY: -25 });
    expect(level.unsupported.some((o) => o.name === "Platform")).toBe(false);
    expect(level.unsupported.some((o) => o.name === "Spring" || o.name === "Spikes")).toBe(false);
    expect(level.unsupported.some((o) => o.name === "PlaneSwitch")).toBe(false);
    expect(level.objects.filter((o) => o.kind === "plane-switch")).toHaveLength(14);
    expect(level.missingAssets).toContain("Data/Music/3K/AngelIsland1.ogg");
    const sim = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    const initial = sim.capture();
    for (let i = 0; i < 120; i++) sim.tick([0, 0]);
    expect(sim.capture().movement.players.every((p) => p.grounded)).toBe(true);
    sim.restore(initial);
    expect(sim.capture()).toEqual(initial);
    for (const platform of level.objects.filter((object) => object.kind === "platform")) {
      const position = v5PlatformAt(platform, 0), state = sim.capture();
      for (let slot = 0; slot < state.movement.players.length; slot++) {
        Object.assign(state.movement.players[slot], { x: position.x + (slot ? 8 : -8) * 65536,
          y: position.y + (platform.top - 60) * 65536, vx: 0, vy: 0, grounded: false, groundObject: null });
      }
      sim.restore(state);
      const landed = [false, false];
      for (let frame = 0; frame < 90; frame++) {
        sim.tick([0, 0]);
        sim.capture().movement.players.forEach((p, slot) => { landed[slot] ||= p.groundObject === platform.id; });
      }
      expect(landed, `Both players must land on actual Angel Island platform ${platform.id}`).toEqual([true, true]);
      sim.restore(initial);
    }
  });
});
