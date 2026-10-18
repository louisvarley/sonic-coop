import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writePak, type PakEntry } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { readV5Level } from "../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../packages/engine/src/v5/collision.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { V5Gameplay } from "../packages/engine/src/v5/gameplay.js";
import { renderV5Tiles } from "../packages/engine/src/v5/render.js";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { exportV5AngelIsland } from "../tools/export-rsdkv5.js";
import { readRsdkV5Gif } from "../tools/rsdkv5-tileset.js";
import { readRsdkV5Animation } from "../tools/rsdkv5-animation.js";

function fixture(change: Record<string, unknown> = {}, missing?: string) {
  const entries: PakEntry[] = [];
  const add = (name: string, data: Uint8Array) => {
    if (name !== missing) entries.push({ key: rsdkPathKey(name), data });
  };
  const metadata = {
    version: 1, title: "Fixture", background: { r: 1, g: 2, b: 3 },
    layers: [{ width: 1, height: 1, visible: true, drawGroup: 1 }], collisionLayers: [0],
    spawns: [{ x: 0, y: 0 }], deathY: 1024 * 65536, objects: [], unsupported: [], sprites: [],
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

  it("rejects malformed metadata, unsupported versions and missing resources explicitly", () => {
    for (const change of [
      { version: 2 }, { title: 1 }, { layers: null }, { layers: [{ width: 1, height: 1, visible: 1, drawGroup: 0 }] },
      { spawns: [] }, { collisionLayers: [] }, { collisionLayers: [1] }, { background: { r: 256, g: 0, b: 0 } },
      { objects: [{ kind: "unknown", id: 1, x: 0, y: 0, plane: null }] },
      { objects: [{ kind: "ring", id: 1, x: 0, y: 0, plane: 2 }] },
    ]) expect(() => readV5Level(fixture(change))).toThrow();
    for (const name of ["meta.json", "layer0.bin", "tiles.bin", "palette.rgb", "collision0.bin", "collision1.bin"]) {
      expect(() => readV5Level(fixture({}, name))).toThrow("resource");
    }
  });

  it("rejects duplicate object ids and preserves diagnostics and static object parameters", () => {
    const object = { id: 1, kind: "spring", x: 123, y: -456, plane: null, vx: 0, vy: -655360 };
    const level = readV5Level(fixture({ objects: [object], unsupported: [{ name: "Boss", count: 1 }] }));
    expect(level.objects).toEqual([object]);
    expect(level.unsupported).toEqual([{ name: "Boss", count: 1 }]);
    expect(() => readV5Level(fixture({ objects: [object, object] }))).toThrow("duplicate");
  });
});

const local = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(local))("real Sonic 3 offline-to-browser export", () => {
  it("exports actual player sprites, supported objects and foreground collision with explicit missing behavior", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(local));
    const bytes = exportV5AngelIsland(archive);
    const level = readV5Level(bytes);
    expect(level.sprites.map((sprite) => sprite.name)).toEqual(["Sonic", "Tails"]);
    for (const sprite of level.sprites) {
      expect(sprite.animations.map((animation) => animation.name)).toEqual(["Idle", "Walk", "Jump"]);
      expect(sprite.pixels.length).toBe(sprite.width * sprite.height);
      const animations = readRsdkV5Animation(archive.read(`Data/Sprites/3K_Players/${sprite.name}.bin`));
      const sheet = readRsdkV5Gif(archive.read(`Data/Sprites/${animations.sheets[0]}`));
      expect(sprite.palette).toEqual(sheet.palette);
    }
    expect(level.objects.filter((o) => o.kind === "ring")).toHaveLength(104);
    expect(level.objects.some((o) => o.kind === "checkpoint")).toBe(true);
    expect(level.objects.some((o) => o.kind === "spring")).toBe(true);
    expect(level.objects.some((o) => o.kind === "hazard")).toBe(true);
    expect(level.unsupported.some((o) => o.name === "PlaneSwitch")).toBe(true);
    const sim = new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    const initial = sim.capture();
    for (let i = 0; i < 120; i++) sim.tick([0, 0]);
    expect(sim.capture().movement.players.every((p) => p.grounded)).toBe(true);
    sim.restore(initial);
    expect(sim.capture()).toEqual(initial);
  });
});
