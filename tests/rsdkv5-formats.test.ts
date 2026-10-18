import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { readRsdkV5GameConfig } from "../tools/rsdkv5-config.js";
import { readRsdkV5Scene } from "../tools/rsdkv5-scene.js";
import { Writer } from "./rsdkv5-fixtures.js";

function configFixture(filters = true) {
  const w = new Writer();
  w.bytes([67, 70, 71, 0]);
  w.str("Test Game"); w.str("Subtitle"); w.str("1.0");
  w.u8(1); w.u16(0);
  w.u8(1); w.str("Player");
  w.u16(0x8001);
  w.bytes(new Uint8Array(48).fill(23));
  w.bytes(new Uint8Array(48).fill(42));
  for (let i = 1; i < 8; i++) w.u16(0);
  w.u8(1); w.str("Global/Jump.wav"); w.u8(2);
  const sceneCountOffset = w.data.length;
  w.u16(2); w.u8(2);
  for (const name of ["Menus", "Stages"]) {
    w.str(name); w.u8(1);
    w.str("Act 1"); w.str("AIZ"); w.str("1");
    if (filters) w.u8(0x81);
  }
  w.u8(1);
  const globalOffset = w.data.length;
  w.u32(123); w.u32(2); w.u32(-1); w.u32(0x7fffffff);
  return { data: w.finish(), sceneCountOffset, globalOffset };
}

function sceneFixture() {
  const w = new Writer();
  w.bytes([83, 67, 78, 0]);
  w.u8(3); w.bytes([1, 2, 3, 255, 4, 5, 6, 128]);
  w.bytes(new Uint8Array(7)); w.str("StampList.bin"); w.u8(4);
  w.u8(1);
  w.u8(1); w.str("Foreground\0"); w.u8(0); w.u8(2);
  w.u16(2); w.u16(1); w.u16(256); w.u16(-128);
  w.u16(1); w.u16(128); w.u16(-32); w.u8(1); w.u8(0);
  const compressedOffset = w.compressed(new Uint8Array(16));
  const tileOffset = w.compressed(Uint8Array.of(0xff, 0xff, 0x23, 0xb1));
  w.u8(1); w.bytes(new Uint8Array(16).fill(0x12));
  const filterCountOffset = w.data.length;
  w.u8(13);
  let typeOffset = 0;
  for (let type = 0; type < 12; type++) {
    w.bytes(new Uint8Array(16).fill(type));
    if (type === 0) typeOffset = w.data.length;
    w.u8(type);
  }
  const entityCountOffset = w.data.length;
  w.u16(1); w.u16(7); w.u32(-65536); w.u32(131072);
  w.u8(255); w.u16(65535); w.u32(0xffffffff);
  w.u8(-128); w.u16(-32768); w.u32(-2147483648); w.u32(-2);
  w.u32(1);
  w.u16(2); w.u16(0x03bb); w.u16(0x20ac);
  w.u32(65536); w.u32(-65536);
  w.u32(0x3fc00000); // 1.5 as an IEEE 754 single
  w.bytes([1, 2, 3, 4]);
  return { data: w.finish(), compressedOffset, tileOffset, typeOffset, filterCountOffset, entityCountOffset };
}

describe("RSDKv5 game configuration", () => {
  it("parses objects, sparse palette banks, sounds, scenes and signed globals", () => {
    const config = readRsdkV5GameConfig(configFixture().data);
    expect(config).toMatchObject({
      title: "Test Game", subtitle: "Subtitle", version: "1.0", startCategory: 1, startScene: 0,
      objects: ["Player"], soundFX: [{ path: "Global/Jump.wav", maxConcurrentPlay: 2 }],
      globalVariables: [{ index: 123, values: [-1, 0x7fffffff] }],
    });
    expect(config.palettes).toHaveLength(8);
    expect(config.palettes[0][0]).toEqual(new Uint8Array(48).fill(23));
    expect(config.palettes[0][15]).toEqual(new Uint8Array(48).fill(42));
    expect(config.palettes[0][1]).toBeNull();
    expect(config.palettes[7]).toEqual(new Array(16).fill(null));
    expect(config.categories[1]).toEqual({
      name: "Stages", scenes: [{ name: "Act 1", folder: "AIZ", id: "1", filter: 0x81 }],
    });
  });

  it("supports the explicitly selected pre-filter layout", () => {
    expect(readRsdkV5GameConfig(configFixture(false).data, false).categories[0].scenes[0].filter).toBeNull();
    expect(() => readRsdkV5GameConfig(configFixture(false).data)).toThrow();
  });

  it("supports Buffer subarrays and does not retain mutable palette views", () => {
    const data = configFixture().data;
    const padded = Buffer.concat([Buffer.alloc(7), Buffer.from(data)]);
    const config = readRsdkV5GameConfig(padded.subarray(7));
    config.palettes[0][0]!.fill(0);
    expect(readRsdkV5GameConfig(padded.subarray(7)).palettes[0][0]![0]).toBe(23);
  });

  it("rejects every truncated prefix and invalid signatures", () => {
    const { data } = configFixture();
    for (let end = 0; end < data.length; end++) expect(() => readRsdkV5GameConfig(data.subarray(0, end))).toThrow();
    data[0] = 0;
    expect(() => readRsdkV5GameConfig(data)).toThrow("not an RSDKv5 game configuration");
  });

  it("rejects inconsistent scene counts, global ranges and trailing data", () => {
    const { data, sceneCountOffset, globalOffset } = configFixture();
    const view = new DataView(data.buffer);
    view.setUint16(sceneCountOffset, 3, true);
    expect(() => readRsdkV5GameConfig(data)).toThrow("scene count");
    view.setUint16(sceneCountOffset, 2, true);
    view.setInt32(globalOffset + 4, -1, true);
    expect(() => readRsdkV5GameConfig(data)).toThrow("global variable range");
    view.setInt32(globalOffset + 4, 0x7fffffff, true);
    expect(() => readRsdkV5GameConfig(data)).toThrow("global variable range");
    view.setInt32(globalOffset + 4, 2, true);
    view.setInt32(globalOffset, -1, true);
    expect(() => readRsdkV5GameConfig(data)).toThrow("global variable range");
    expect(() => readRsdkV5GameConfig(Uint8Array.from([...configFixture().data, 0]))).toThrow("trailing bytes");
  });
});

describe("RSDKv5 scene", () => {
  it("parses editor metadata, compressed layers and all twelve entity variable types", () => {
    const scene = readRsdkV5Scene(sceneFixture().data);
    expect(scene.editor).toMatchObject({
      version: 3, background1: { r: 3, g: 2, b: 1, a: 255 }, stampName: "StampList.bin", stampType: 4,
    });
    expect(scene.layers[0]).toMatchObject({
      visible: true, name: "Foreground", type: 0, drawGroup: 2, width: 2, height: 1,
      parallaxFactor: 256, scrollSpeed: -128, tiles: Uint16Array.of(0xffff, 0xb123),
      lineScroll: new Uint8Array(16),
      scrolling: [{ parallaxFactor: 128, scrollSpeed: -32, deform: 1, unknown: 0 }],
    });
    expect(scene.objects[0].hash).toBe("12".repeat(16));
    expect(scene.objects[0].entities[0]).toEqual({
      slot: 7, x: -65536, y: 131072,
      values: [255, 65535, 0xffffffff, -128, -32768, -2147483648, -2, true,
        "\u03bb\u20ac", { x: 65536, y: -65536 }, 1.5, { r: 3, g: 2, b: 1, a: 4 }],
    });
  });

  it("rejects every truncated prefix, invalid signatures and trailing data", () => {
    const { data } = sceneFixture();
    for (let end = 0; end < data.length; end++) expect(() => readRsdkV5Scene(data.subarray(0, end))).toThrow();
    expect(() => readRsdkV5Scene(Uint8Array.from([...data, 0]))).toThrow("trailing bytes");
    data[0] = 0;
    expect(() => readRsdkV5Scene(data)).toThrow("not an RSDKv5 scene");
  });

  it("rejects unsupported variable types even if no entities use them", () => {
    const { data, typeOffset, entityCountOffset } = sceneFixture();
    new DataView(data.buffer).setUint16(entityCountOffset, 0, true);
    data[typeOffset] = 12;
    expect(() => readRsdkV5Scene(data.subarray(0, entityCountOffset + 2))).toThrow("unsupported RSDKv5 scene variable type");
  });

  it("rejects object definitions without the implicit filter variable", () => {
    const { data, filterCountOffset } = sceneFixture();
    data[filterCountOffset] = 0;
    expect(() => readRsdkV5Scene(data)).toThrow("implicit filter variable");
  });

  it("rejects corrupt zlib streams and output exceeding its declared size", () => {
    const { data, compressedOffset } = sceneFixture();
    data[compressedOffset + 8] = 0;
    expect(() => readRsdkV5Scene(data)).toThrow();
    const tooSmall = sceneFixture().data;
    new DataView(tooSmall.buffer).setUint32(compressedOffset + 4, 15, false);
    expect(() => readRsdkV5Scene(tooSmall)).toThrow();
  });

  it("supports empty scenes and Buffer subarrays", () => {
    const w = new Writer();
    w.bytes([83, 67, 78, 0, ...new Uint8Array(16)]);
    w.u8(0); w.u8(0); w.u8(0); w.u8(0);
    expect(readRsdkV5Scene(w.finish())).toMatchObject({ layers: [], objects: [] });
    const padded = Buffer.concat([Buffer.alloc(7), Buffer.from(sceneFixture().data)]);
    expect(readRsdkV5Scene(padded.subarray(7)).objects[0].entities[0].x).toBe(-65536);
  });

  it("validates compressed block sizes before allocating or reading", () => {
    const { data, compressedOffset, tileOffset } = sceneFixture();
    const view = new DataView(data.buffer);
    view.setUint32(compressedOffset, 3, true);
    expect(() => readRsdkV5Scene(data)).toThrow("compressed block size");
    const fresh = sceneFixture().data;
    new DataView(fresh.buffer).setUint32(compressedOffset + 4, 64 * 1024 * 1024 + 1, false);
    expect(() => readRsdkV5Scene(fresh)).toThrow("compressed block size");
    const wrongTiles = sceneFixture().data;
    new DataView(wrongTiles.buffer).setUint32(tileOffset + 4, 6, false);
    expect(() => readRsdkV5Scene(wrongTiles)).toThrow("compressed block size");
    const wrongOutput = sceneFixture().data;
    new DataView(wrongOutput.buffer).setUint32(compressedOffset + 4, 17, false);
    expect(() => readRsdkV5Scene(wrongOutput)).toThrow("decompressed size mismatch");
  });
});

const localArchive = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(localArchive))("local Sonic 3 formats", () => {
  it("discovers stages from the decrypted config and parses every available scene", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(localArchive));
    const config = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
    expect(config.title.length).toBeGreaterThan(0);
    let parsed = 0;
    for (const category of config.categories) {
      for (const scene of category.scenes) {
        const asset = `Data/Stages/${scene.folder}/Scene${scene.id}.bin`;
        if (!archive.has(asset)) continue;
        const data = readRsdkV5Scene(archive.read(asset));
        for (const layer of data.layers) expect(layer.tiles.length).toBe(layer.width * layer.height);
        parsed++;
      }
    }
    expect(parsed).toBeGreaterThan(0);
  });
});
