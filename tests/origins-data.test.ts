import fs from "node:fs";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectRsdkPack, readRsdkV3Dirs } from "../tools/rsdk-detect.js";
import { readZip } from "../tools/zip.js";
import { cipher56, readAcb, readAfs2, decryptHca } from "../tools/criware.js";
import { parseOriginsAudio } from "../tools/origins-audio-map.js";
import { discoverPaths } from "../tools/rsdk-paths.js";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { Writer } from "./rsdkv5-fixtures.js";

/** A 2011-format (Sonic CD mobile/PC) pack header: directory names XORed with their inverted length. */
function v3Pack(dirs: string[]): Uint8Array {
  const w = new Writer();
  w.u32(0);
  w.u16(dirs.length);
  for (const dir of dirs) {
    w.u8(dir.length);
    w.bytes(Buffer.from(dir, "latin1").map((c) => c ^ (0xff - dir.length)));
    w.u32(0);
  }
  const bytes = w.finish();
  new DataView(bytes.buffer).setUint32(0, bytes.length, true);
  return bytes;
}

/** A zip with one stored and one deflated entry. */
function zip(entries: [string, Uint8Array, boolean][]): Uint8Array {
  const w = new Writer();
  const central: { name: string; method: number; size: number; raw: number; offset: number }[] = [];
  for (const [name, data, deflate] of entries) {
    const body = deflate ? zlib.deflateRawSync(data) : data;
    central.push({ name, method: deflate ? 8 : 0, size: body.length, raw: data.length, offset: w.data.length });
    w.u32(0x04034b50); w.u16(20); w.u16(0); w.u16(deflate ? 8 : 0); w.u32(0); w.u32(0);
    w.u32(body.length); w.u32(data.length); w.u16(name.length); w.u16(0);
    w.bytes(Buffer.from(name)); w.bytes(body);
  }
  const start = w.data.length;
  for (const e of central) {
    w.u32(0x02014b50); w.u16(20); w.u16(20); w.u16(0); w.u16(e.method); w.u32(0); w.u32(0);
    w.u32(e.size); w.u32(e.raw); w.u16(e.name.length); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u32(0); w.u32(e.offset);
    w.bytes(Buffer.from(e.name));
  }
  const size = w.data.length - start;
  w.u32(0x06054b50); w.u16(0); w.u16(0); w.u16(central.length); w.u16(central.length); w.u32(size); w.u32(start); w.u16(0);
  return w.finish();
}

describe("Sonic Origins and mobile data packs", () => {
  it("recognises Sonic CD's signature-less 2011 pack by its stage folders", () => {
    const pack = v3Pack(["Data/Game/", "Data/Stages/R11A/", "Data/Sprites/Global/"]);
    expect(readRsdkV3Dirs(pack)).toEqual(["Data/Game/", "Data/Stages/R11A/", "Data/Sprites/Global/"]);
    expect(detectRsdkPack(pack)).toMatchObject({ format: "v3", release: "mobile", game: "soniccd", supported: false });
    expect(readRsdkV3Dirs(new TextEncoder().encode("not a data pack at all"))).toBeNull();
  });

  it("reads stored and deflated entries from app packages", () => {
    const text = new TextEncoder().encode("Payload data ".repeat(50));
    const entries = readZip(zip([["a/stored.bin", Uint8Array.of(1, 2, 3), false], ["Payload/x.app/Data.rsdk", text, true]]));
    expect(entries.map((e) => e.name)).toEqual(["a/stored.bin", "Payload/x.app/Data.rsdk"]);
    expect(entries[0].read()).toEqual(Uint8Array.of(1, 2, 3));
    expect(entries[1].read()).toEqual(text);
  });

  it("builds an HCA type 56 cipher table that is a byte permutation keeping 0x00 and 0xFF", () => {
    const table = cipher56(6005974353133017519n);
    expect(new Set(table).size).toBe(256);
    expect([table[0], table[0xff]]).toEqual([0, 0xff]);
  });

  it("maps cue names to RSDK file names, pairing <br> lists and adding speed variants", () => {
    const map = parseOriginsAudio([
      "## Keycodes", "", "| Pack | Keycode |", "| --- | --- |", "| X_sfx.acb | 42 |", "| X_music.acb/awb | 7 |", "",
      "## X SFX (X_sfx.acb)", "", "| ID | CRIWARE Audio Name | RSDK Filename |", "| --- | --- | --- |",
      "| 3 | Ring_L<br>Ring_R | <br>Global/Ring.wav |",
      "| 4 | Landing | Global/Landing.wav |",
      "| 4 | Event | Global/Event.wav[^1] |",
      "| 5 | Unnamed | |", "",
      "### Unused Entries", "", "| CRIWARE Audio Name | RSDK Filename |", "| --- | --- |", "| Old | Global/Old.wav |", "",
      "## X Music (X_music.awb)", "", "| ID | CRIWARE Audio Name | RSDK Filename |", "| --- | --- | --- |",
      "| 0 | Zone1 | Zone1.ogg |", "", "### Fast Music", "", "| CRIWARE Audio Name | RSDK Filename |", "| --- | --- |",
      "| Zone1 | Zone1_F.ogg |",
    ].join("\n"));
    expect(map.X_sfx.keycode).toBe("42");
    expect(map.X_sfx.cues).toEqual({
      Ring_R: [{ name: "Global/Ring.wav" }],
      Landing: [{ name: "Global/Landing.wav" }],
      Event: [{ name: "Global/Event.wav" }],
    });
    expect(map.X_music.cues.Zone1).toEqual([{ name: "Zone1.ogg" }, { name: "Zone1_F.ogg", speed: 1.2 }]);
  });

  it("finds file names that run into a printable length byte", () => {
    const ani = Uint8Array.from([1, 18, ...Buffer.from("Players/Sonic3.gif"), 0x27, ...Buffer.from("Stopped")]);
    const files = new Map<string, Uint8Array>([["Data/Animations/Sonic.ani", ani], ["Data/Sprites/Players/Sonic3.gif", new Uint8Array(1)]]);
    const keys = new Map([...files.keys()].map((p) => [rsdkPathKey(p), p]));
    const found = discoverPaths({ has: (k) => keys.has(k), read: (p) => files.get(p)! }, ['LoadAnimation("Sonic.ani")']);
    expect([...found.values()].sort()).toEqual(["Data/Animations/Sonic.ani", "Data/Sprites/Players/Sonic3.gif"]);
  });
});

const local = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));
describe.skipIf(!fs.existsSync(local("STH1_music.acb")) || !fs.existsSync(local("STH1_music.awb")))("local Sonic Origins audio", () => {
  it("resolves cue names to waves and decrypts a looping track", () => {
    const acb = readAcb(new Uint8Array(fs.readFileSync(local("STH1_music.acb"))));
    expect(acb.name).toBe("STH1_music");
    expect(acb.waves.find((w) => w.cues.includes("81_z1_GreenHill"))?.id).toBe(7);
    const bank = readAfs2(new Uint8Array(fs.readFileSync(local("STH1_music.awb"))));
    const { info } = decryptHca(bank.entries.find((e) => e.id === 7)!.data, 6005974353133017519n);
    expect(info).toMatchObject({ channels: 2, sampleRate: 48000 });
    expect(info.loop!.start).toBeGreaterThan(0);
  });
});

describe.skipIf(!fs.existsSync(local("Sonic1u.rsdk")))("local Sonic Origins Sonic 1 pack", () => {
  it("is detected and its stage, sprite and animation files are discovered", () => {
    const bytes = new Uint8Array(fs.readFileSync(local("Sonic1u.rsdk")));
    expect(detectRsdkPack(bytes)).toMatchObject({ format: "v4", release: "origins", game: "sonic1", supported: true });
    const archive = new RsdkV5Archive(bytes);
    const keys = new Set(archive.files.map((f) => f.key));
    const paths = new Set(discoverPaths({ has: (k) => keys.has(k), read: (p) => archive.read(p) }, ['"Sonic.ani"']).values());
    for (const p of ["Data/Game/GameConfig.bin", "Data/Stages/Zone01/Act1.bin", "Data/Animations/Sonic.ani", "Data/Sprites/Players/Sonic3.gif"]) {
      expect(paths, p).toContain(p);
    }
  });
});
