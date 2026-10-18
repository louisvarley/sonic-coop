import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FileReader } from "../packages/engine/src/core/reader.js";
import { readGifHeader, ReadGifPictureData } from "../packages/engine/src/sprite.js";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { readRsdkV5GameConfig, type RsdkV5GameConfig } from "../tools/rsdkv5-config.js";
import { loadRsdkV5Stage, readRsdkV5StageConfig, readRsdkV5TileConfig, type RsdkV5Stage } from "../tools/rsdkv5-stage.js";
import { readRsdkV5Tileset } from "../tools/rsdkv5-tileset.js";
import { renderRsdkV5Stage } from "../tools/rsdkv5-render.js";
import { writePng } from "../tools/png.js";
import { Writer } from "./rsdkv5-fixtures.js";

function stageConfig(globals = true): Uint8Array {
  const w = new Writer();
  w.bytes([67, 70, 71, 0, +globals, 1]); w.str("StageObject");
  w.u16(2); w.bytes(new Uint8Array(48).fill(42));
  for (let i = 1; i < 8; i++) w.u16(0);
  w.u8(1); w.str("Stage/Sound.wav"); w.u8(3);
  return w.finish();
}

function collisionFixture(): Uint8Array {
  const raw = new Uint8Array(2 * 1024 * 38);
  raw.set([1, 2, 3], 0);
  raw[16] = 1;
  raw.set([1, 2, 3, 4, 5, 6], 32);
  raw[1024 * 38] = 15;
  const w = new Writer();
  w.bytes([84, 73, 76, 0]); w.compressed(raw);
  return w.finish();
}

function gifFixture(local = false, interlaced = false, special = false, growDictionary = false): Uint8Array {
  const w = new Writer();
  w.bytes(Buffer.from("GIF89a")); w.u16(16); w.u16(16384); w.u8(local ? 0 : 0x81); w.u16(0);
  const palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  if (!local) w.bytes(palette);
  w.bytes([0x21, 0xfe, 3, 0x2c, 0x3b, 0x21, 0]); // A comment containing marker bytes.
  w.u8(0x2c); w.u16(0); w.u16(0); w.u16(16); w.u16(16384); w.u8((local ? 0x81 : 0) | (interlaced ? 0x40 : 0));
  if (local) w.bytes(palette);
  w.u8(2);
  const encoded = new Uint8Array(500000);
  let bit = 0, width = 3, next = 6, previous = false;
  const code = (value: number) => {
    for (let i = 0; i < width; i++, bit++) encoded[bit >> 3] |= ((value >> i) & 1) << (bit & 7);
    if (value === 4) { width = 3; next = 6; previous = false; }
    else if (value !== 5) {
      if (previous && next < 4096 && ++next === (1 << width) && width < 12) width++;
      previous = true;
    }
  };
  let start = 0;
  if (special) { code(4); code(0); code(6); start = 3; } // Dictionary self-reference: 0, then 00.
  for (let i = start; i < 16 * 16384; i++) {
    if (!growDictionary || i % 10000 === 0) code(4);
    code(Math.floor(i / 16) % 4);
  }
  code(5);
  const input = encoded.subarray(0, Math.ceil(bit / 8));
  for (let pos = 0; pos < input.length; pos += 255) {
    const block = input.subarray(pos, pos + 255);
    w.u8(block.length); w.bytes(block);
  }
  w.u8(0); w.u8(0x3b);
  return w.finish();
}

function gameConfig(): RsdkV5GameConfig {
  return {
    title: "Test", subtitle: "", version: "", startCategory: 0, startScene: 0,
    objects: ["Player"], palettes: Array.from({ length: 8 }, () => new Array<Uint8Array | null>(16).fill(null)),
    soundFX: [], categories: [], globalVariables: [],
  };
}

function renderStage(): RsdkV5Stage {
  const layer = {
    visible: true, name: "FG", type: 0, drawGroup: 1, width: 6, height: 1,
    parallaxFactor: 256, scrollSpeed: 0, scrolling: [], lineScroll: new Uint8Array(16),
    tiles: Uint16Array.of(0, 0x400, 0x800, 0xc00, 0xffff, 0xf000),
  };
  const pixels = new Uint8Array(1024 * 256);
  pixels[0] = 1; pixels[15] = 2; pixels[240] = 3; pixels[255] = 4;
  pixels.fill(5, 256, 512);
  const palette = new Uint8Array(768);
  for (let i = 1; i <= 5; i++) palette.set([i * 10, i * 20, i * 30], i * 3);
  return {
    scene: {
      editor: { version: 3, background1: { r: 9, g: 8, b: 7, a: 255 }, background2: { r: 0, g: 0, b: 0, a: 255 },
        unknown: new Uint8Array(7), stampName: "", stampType: 0 },
      layers: [layer], objects: [],
    },
    config: { loadGlobalObjects: true, objects: [], palettes: gameConfig().palettes, soundFX: [] },
    collision: null, tileset: { pixels, palette }, objectNames: [],
  };
}

describe("RSDKv5 stage configuration and tile collision", () => {
  it("reads stage objects, sparse palettes and sound limits", () => {
    const config = readRsdkV5StageConfig(stageConfig());
    expect(config).toMatchObject({ loadGlobalObjects: true, objects: ["StageObject"],
      soundFX: [{ path: "Stage/Sound.wav", maxConcurrentPlay: 3 }] });
    expect(config.palettes[0][0]).toBeNull();
    expect(config.palettes[0][1]).toEqual(new Uint8Array(48).fill(42));
    expect(readRsdkV5StageConfig(stageConfig(false)).loadGlobalObjects).toBe(false);
  });

  it("reads both collision paths without losing masks, angles or flags", () => {
    const paths = readRsdkV5TileConfig(collisionFixture());
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveLength(1024);
    expect(paths[0][0]).toMatchObject({
      heights: Uint8Array.from([1, 2, 3, ...new Array<number>(13).fill(0)]),
      direction: 1, floorAngle: 2, leftWallAngle: 3, rightWallAngle: 4, roofAngle: 5, flags: 6,
    });
    expect(paths[0][0].solid[0]).toBe(1);
    expect(paths[1][0].heights[0]).toBe(15);
    expect(paths[1][1023].heights).toEqual(new Uint8Array(16));
  });

  it("rejects truncated, wrongly signed and trailing stage resources", () => {
    for (const [data, read] of [[stageConfig(), readRsdkV5StageConfig], [collisionFixture(), readRsdkV5TileConfig]] as const) {
      for (let end = 0; end < data.length; end++) expect(() => read(data.subarray(0, end))).toThrow();
      expect(() => read(Uint8Array.from([...data, 0]))).toThrow("trailing");
      data[0] = 0;
      expect(() => read(data)).toThrow("not an RSDKv5");
    }
    const invalid = collisionFixture();
    new DataView(invalid.buffer).setUint32(8, 1, false);
    expect(() => readRsdkV5TileConfig(invalid)).toThrow("compressed block size");
  });

  it("loads resources together, resolves case-sensitive object hashes, and honors the global-object flag", () => {
    const w = new Writer();
    w.bytes([83, 67, 78, 0, ...new Uint8Array(16), 0, 0, 0]); w.u8(4);
    for (const name of ["Blank Object", "Player", "StageObject", "Unknown"]) {
      w.bytes(createHash("md5").update(name).digest()); w.u8(1); w.u16(0);
    }
    const files = new Map([
      ["Data/Stages/Test/Scene1.bin", w.finish()], ["Data/Stages/Test/StageConfig.bin", stageConfig()],
      ["Data/Stages/Test/16x16Tiles.gif", gifFixture()],
    ]);
    const archive = {
      has: (name: string) => files.has(name),
      read: (name: string) => { const data = files.get(name); if (!data) throw new Error(`missing: ${name}`); return data; },
    };
    const stage = loadRsdkV5Stage(archive, gameConfig(), "Data\\Stages\\Test\\Scene1.bin");
    expect(stage.objectNames).toEqual(["Blank Object", "Player", "StageObject", null]);
    expect(stage.collision).toBeNull();
    files.set("Data/Stages/Test/StageConfig.bin", stageConfig(false));
    expect(loadRsdkV5Stage(archive, gameConfig(), "Data/Stages/Test/Scene1.bin").objectNames[1]).toBeNull();
    files.set("Data/Stages/Test/TileConfig.bin", collisionFixture());
    expect(loadRsdkV5Stage(archive, gameConfig(), "Data/Stages/Test/Scene1.bin").collision).toHaveLength(2);
    files.delete("Data/Stages/Test/16x16Tiles.gif");
    expect(() => loadRsdkV5Stage(archive, gameConfig(), "Data/Stages/Test/Scene1.bin")).toThrow("missing");
    expect(() => loadRsdkV5Stage(archive, gameConfig(), "not-a-scene")).toThrow("invalid");
  });
});

describe("RSDKv5 indexed tileset GIF", () => {
  it("decodes palette indices, local tables, extensions and LZW self-references", () => {
    const global = readRsdkV5Tileset(gifFixture());
    const local = readRsdkV5Tileset(gifFixture(true));
    expect(global).toEqual(local);
    expect(global.pixels).toHaveLength(262144);
    for (let y = 0; y < 16384; y++) expect(global.pixels[y * 16]).toBe(y % 4);
    expect(global.palette.subarray(0, 12)).toEqual(Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]));
    expect(readRsdkV5Tileset(gifFixture(false, false, true))).toEqual(global);
  });

  it("deinterlaces all four passes", () => {
    const tileset = readRsdkV5Tileset(gifFixture(false, true));
    let source = 0;
    for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
      for (let y = start; y < 16384; y += step) expect(tileset.pixels[y * 16]).toBe(source++ % 4);
    }
  });

  it("grows through every code width, saturates the dictionary and resets it", () => {
    const actual = readRsdkV5Tileset(gifFixture(false, false, false, true));
    const expected = readRsdkV5Tileset(gifFixture());
    expect(Buffer.compare(Buffer.from(actual.pixels), Buffer.from(expected.pixels))).toBe(0);
  });

  it("rejects malformed headers, truncated blocks, bad LZW streams, and trailing data", () => {
    const data = gifFixture();
    for (const end of [0, 5, 12, 24, 40, data.length - 3, data.length - 2, data.length - 1]) {
      expect(() => readRsdkV5Tileset(data.subarray(0, end))).toThrow();
    }
    expect(() => readRsdkV5Tileset(Uint8Array.from([...data, 0]))).toThrow("trailing");
    const signature = data.slice(); signature[0] = 0;
    expect(() => readRsdkV5Tileset(signature)).toThrow("not an");
    const size = data.slice(); size[6] = 0;
    expect(() => readRsdkV5Tileset(size)).toThrow("dimensions");
    const depth = data.slice(); depth[42] = 12;
    expect(() => readRsdkV5Tileset(depth)).toThrow("LZW depth");
    const noClear = data.slice(); noClear[44] = 0;
    expect(() => readRsdkV5Tileset(noClear)).toThrow("initial clear");
    const earlyEnd = data.slice(); earlyEnd[44] = 4 | (5 << 3);
    expect(() => readRsdkV5Tileset(earlyEnd)).toThrow("pixel count");
  });
});

describe("RSDKv5 static viewport rendering", () => {
  it("renders all flip combinations, ignores collision bits and leaves empty tiles transparent", () => {
    const stage = renderStage();
    const rgba = renderRsdkV5Stage(stage, gameConfig(), { x: 0, y: 0, width: 96, height: 16 });
    const corners = [[0, 0], [15, 0], [0, 15], [15, 15]];
    for (let tile = 0; tile < 6; tile++) {
      for (let i = 0; i < 4; i++) {
        const [x, y] = corners[i];
        const offset = (y * 96 + tile * 16 + x) * 4;
        const value = (i ^ (tile < 4 ? tile : 0)) + 1;
        expect(rgba.subarray(offset, offset + 4)).toEqual(tile === 4
          ? Uint8Array.of(9, 8, 7, 255) : Uint8Array.of(value * 10, value * 20, value * 30, 255));
      }
    }
  });

  it("clips negative and partial viewports, and keeps out-of-map pixels as background", () => {
    const stage = renderStage();
    const config = gameConfig();
    const image = renderRsdkV5Stage(stage, config, { x: -1, y: -1, width: 3, height: 3 });
    expect(image.subarray(0, 4)).toEqual(Uint8Array.of(9, 8, 7, 255));
    expect(image.subarray(16, 20)).toEqual(Uint8Array.of(10, 20, 30, 255));
    expect(renderRsdkV5Stage(stage, config, { x: 10000, y: 10000, width: 1, height: 1 })).toEqual(Uint8Array.of(9, 8, 7, 255));
  });

  it("applies global then stage palette rows and respects layer visibility and draw groups", () => {
    const stage = renderStage(), config = gameConfig();
    const globalRow = new Uint8Array(48); globalRow.set([1, 2, 3], 3);
    config.palettes[0][0] = globalRow;
    expect(renderRsdkV5Stage(stage, config, { x: 0, y: 0, width: 1, height: 1 })).toEqual(Uint8Array.of(1, 2, 3, 255));
    const stageRow = new Uint8Array(48); stageRow.set([4, 5, 6], 3);
    stage.config.palettes[0][0] = stageRow;
    expect(renderRsdkV5Stage(stage, config, { x: 0, y: 0, width: 1, height: 1 })).toEqual(Uint8Array.of(4, 5, 6, 255));
    stage.scene.layers[0].visible = false;
    expect(renderRsdkV5Stage(stage, config, { x: 0, y: 0, width: 1, height: 1 })).toEqual(Uint8Array.of(9, 8, 7, 255));
    expect(renderRsdkV5Stage(stage, config, { x: 0, y: 0, width: 1, height: 1, layers: [0] })).toEqual(Uint8Array.of(4, 5, 6, 255));
    stage.scene.layers.push({ ...stage.scene.layers[0], drawGroup: 0, visible: true, tiles: new Uint16Array(6).fill(1) });
    stage.config.palettes = gameConfig().palettes; config.palettes = gameConfig().palettes;
    const image = renderRsdkV5Stage(stage, config, { x: 0, y: 0, width: 2, height: 1, layers: [0, 1] });
    expect(image).toEqual(Uint8Array.of(10, 20, 30, 255, 50, 100, 150, 255));
  });

  it("rejects invalid and excessive viewports and invalid layer indices", () => {
    const stage = renderStage(), config = gameConfig(), view = { x: 0, y: 0, width: 16, height: 16 };
    for (const invalid of [{ width: 0 }, { height: -1 }, { width: 2049 }, { x: NaN }, { y: 0.5 }, { x: Number.MAX_SAFE_INTEGER }]) {
      expect(() => renderRsdkV5Stage(stage, config, { ...view, ...invalid })).toThrow("viewport");
    }
    for (const layers of [[-1], [1], [0.5]]) expect(() => renderRsdkV5Stage(stage, config, { ...view, layers })).toThrow("layer");
  });
});

describe("shared PNG output", () => {
  it("writes exact RGBA pixels with correct dimensions and rejects malformed input", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spin-sync-png-"));
    try {
      const file = path.join(dir, "preview.png");
      const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 128);
      writePng(file, 2, 1, rgba);
      const png = fs.readFileSync(file);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(2); expect(png.readUInt32BE(20)).toBe(1);
      const compressedLength = png.readUInt32BE(33);
      expect(inflateSync(png.subarray(41, 41 + compressedLength))).toEqual(Buffer.from([0, ...rgba]));
      expect(() => writePng(file, 2, 1, rgba.subarray(1))).toThrow("invalid PNG");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const localArchive = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(localArchive))("local Sonic 3 stage resources", () => {
  it("loads all present stages and matches the existing decoder on their indexed graphics", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(localArchive));
    const config = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
    let count = 0;
    for (const category of config.categories) {
      for (const scene of category.scenes) {
        const asset = `Data/Stages/${scene.folder}/Scene${scene.id}.bin`;
        if (!archive.has(asset)) continue;
        const stage = loadRsdkV5Stage(archive, config, asset);
        const f = new FileReader(archive.read(`Data/Stages/${scene.folder}/16x16Tiles.gif`));
        const header = readGifHeader(f), pixels = new Uint8Array(header.width * header.height);
        ReadGifPictureData(f, header.width, header.height, header.interlaced, pixels, 0);
        expect(Buffer.compare(Buffer.from(stage.tileset.pixels), Buffer.from(pixels)), asset).toBe(0);
        if (scene.folder === "3K_AIZ1") {
          expect(stage.collision).toHaveLength(2);
          expect(stage.objectNames).toContain("Player");
          expect(stage.objectNames).toContain("S3K_AIZSetup");
          expect(stage.objectNames).not.toContain(null);
          const image = renderRsdkV5Stage(stage, config, { x: 4784, y: 782, width: 424, height: 240 });
          const colors = new Set<number>();
          for (let i = 0; i < image.length; i += 4) colors.add((image[i] << 16) | (image[i + 1] << 8) | image[i + 2]);
          expect(colors.size).toBeGreaterThan(1);
        }
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  }, 30000);
});
