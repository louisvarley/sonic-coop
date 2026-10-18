import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { readRsdkIndex } from "../tools/rsdk.js";
import { readRsdkV5Index, RsdkV5Archive } from "../tools/rsdkv5.js";

function fixture(data: Uint8Array, encrypted = false, name = "Data/Test.bin"): Uint8Array {
  const pack = new Uint8Array(32 + data.length);
  pack.set(new TextEncoder().encode("RSDKv5"));
  const view = new DataView(pack.buffer);
  view.setUint16(6, 1, true);
  pack.set(Buffer.from(rsdkPathKey(name), "hex"), 8);
  view.setUint32(24, 32, true);
  view.setUint32(28, (data.length | (encrypted ? 0x80000000 : 0)) >>> 0, true);
  pack.set(data, 32);
  return pack;
}

describe("RSDKv5 asset reader", () => {
  it("reads the hashed index and supports nonzero byte offsets", () => {
    const pack = fixture(Uint8Array.of(1, 2, 3));
    const padded = new Uint8Array(pack.length + 7);
    padded.set(pack, 7);
    expect(readRsdkV5Index(padded.subarray(7))).toEqual([
      { key: rsdkPathKey("Data/Test.bin"), offset: 32, size: 3, encrypted: false },
    ]);
  });

  it("returns independent file bytes and normalizes path case and separators", () => {
    const archive = new RsdkV5Archive(Buffer.from(fixture(Uint8Array.of(1, 2, 3))));
    expect(archive.has("data\\TEST.bin")).toBe(true);
    const data = archive.read("data\\TEST.bin");
    expect(Array.from(data)).toEqual([1, 2, 3]);
    data[0] = 99;
    expect(archive.read("Data/Test.bin")[0]).toBe(1);
    expect(archive.has("Data/Missing.bin")).toBe(false);
    expect(() => archive.read("Data/Missing.bin")).toThrow("asset not found");
  });

  it("decrypts an independently generated vector across cipher key transitions without mutating the archive", () => {
    const ciphertext = Buffer.from(
      "b519bdf96877d58f88711ef74830c374260b2293b4e0272571baa44e757455f7c5b1" +
      "45a4bd017a7c82c0f0166197ef90d2988440f787022aebe5228c2680c65121a3" +
      "d93ea7e821fe66b5227ffc8f5b5df4c4e462efc40e0de41e5c9b4b4df8c8", "hex",
    );
    const pack = Buffer.from(fixture(ciphertext, true));
    const before = Buffer.from(pack);
    const archive = new RsdkV5Archive(pack);
    const expected = Uint8Array.from({ length: 96 }, (_, i) => i);
    expect(archive.read("DATA\\TEST.BIN")).toEqual(expected);
    expect(archive.read("Data/Test.bin")).toEqual(expected);
    expect(pack).toEqual(before);
  });

  it.each([false, true])("reads zero-length files (encrypted=%s)", (encrypted) => {
    expect(new RsdkV5Archive(fixture(new Uint8Array(), encrypted)).read("Data/Test.bin")).toEqual(new Uint8Array());
  });

  it("accepts an empty archive", () => {
    const pack = new TextEncoder().encode("RSDKv5\0\0");
    expect(readRsdkV5Index(pack)).toEqual([]);
  });

  it("does not confuse v4 and v5 archives", () => {
    const pack = fixture(new Uint8Array());
    expect(() => readRsdkIndex(pack)).toThrow("not an RSDKv4");
    pack[5] = "B".charCodeAt(0);
    expect(() => readRsdkV5Index(pack)).toThrow("not an RSDKv5");
  });

  it("rejects truncated headers and file tables explicitly", () => {
    expect(() => readRsdkV5Index(new Uint8Array(7))).toThrow("truncated RSDKv5 header");
    expect(() => readRsdkV5Index(fixture(new Uint8Array()).subarray(0, 31))).toThrow("truncated RSDKv5 file table");
  });

  it.each([0, 31, 34, 0xffffffff])("rejects invalid file offsets (%s)", (offset) => {
    const pack = fixture(Uint8Array.of(1));
    new DataView(pack.buffer).setUint32(24, offset, true);
    expect(() => readRsdkV5Index(pack)).toThrow("outside the archive data");
  });

  it("rejects truncated file contents", () => {
    const pack = fixture(Uint8Array.of(1));
    new DataView(pack.buffer).setUint32(28, 2, true);
    expect(() => readRsdkV5Index(pack)).toThrow("outside the archive data");
  });

  it("rejects duplicate path hashes", () => {
    const pack = new Uint8Array(56);
    pack.set(fixture(new Uint8Array()));
    const view = new DataView(pack.buffer);
    view.setUint16(6, 2, true);
    view.setUint32(24, 56, true);
    pack.set(pack.subarray(8, 32), 32);
    expect(() => readRsdkV5Index(pack)).toThrow("duplicate RSDKv5 path hash");
  });
});

const localArchive = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(localArchive))("local Sonic 3 archive", () => {
  it("indexes the user's archive and decrypts its RSDKv5 game configuration", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(path.resolve(localArchive)));
    expect(archive.files.length).toBeGreaterThan(0);
    const config = archive.read("Data/Game/GameConfig.bin");
    expect(Array.from(config.subarray(0, 4))).toEqual([0x43, 0x46, 0x47, 0]);
  });
});
