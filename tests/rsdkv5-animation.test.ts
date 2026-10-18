import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRsdkV5Animation } from "../tools/rsdkv5-animation.js";
import { RsdkV5Archive } from "../tools/rsdkv5.js";
import { Writer } from "./rsdkv5-fixtures.js";

function fixture() {
  const w = new Writer();
  w.bytes([83, 80, 82, 0]); w.u32(1);
  w.u8(1); w.str("Players/Sonic.gif\0");
  w.u8(1); w.str("Outer Box\0"); w.u16(1);
  w.str("Idle\0"); w.u16(1); w.u16(-1);
  const loopOffset = w.data.length;
  w.u8(0); w.u8(2);
  const sheetOffset = w.data.length;
  w.u8(0); w.u16(256); w.u16(0x20ac);
  w.u16(12); w.u16(34); w.u16(32); w.u16(48); w.u16(-16); w.u16(-24);
  w.u16(-9); w.u16(-19); w.u16(9); w.u16(19);
  return { data: w.finish(), loopOffset, sheetOffset };
}

describe("RSDKv5 sprite animations", () => {
  it("reads NUL-terminated names, signed pivots, timing and named per-frame hitboxes", () => {
    expect(readRsdkV5Animation(fixture().data)).toEqual({
      sheets: ["Players/Sonic.gif"], hitboxTypes: ["Outer Box"],
      animations: [{ name: "Idle", speed: -1, loopIndex: 0, rotationStyle: 2,
        frames: [{ sheet: 0, duration: 256, unicodeChar: 0x20ac, x: 12, y: 34, width: 32, height: 48,
          pivotX: -16, pivotY: -24, hitboxes: [{ left: -9, top: -19, right: 9, bottom: 19 }] }] }],
    });
  });

  it("rejects every truncated prefix and trailing data", () => {
    const { data } = fixture();
    for (let end = 0; end < data.length; end++) expect(() => readRsdkV5Animation(data.subarray(0, end))).toThrow();
    expect(() => readRsdkV5Animation(Uint8Array.from([...data, 0]))).toThrow("trailing");
    data[0] = 0;
    expect(() => readRsdkV5Animation(data)).toThrow("not an");
  });

  it("preserves unresolved sheet references but rejects invalid loops and total frame counts", () => {
    const { data, loopOffset, sheetOffset } = fixture();
    data[sheetOffset] = 1;
    expect(readRsdkV5Animation(data).animations[0].frames[0].sheet).toBe(1);
    data[sheetOffset] = 0; data[loopOffset] = 1;
    expect(() => readRsdkV5Animation(data)).toThrow("loop index");
    data[loopOffset] = 0;
    new DataView(data.buffer).setUint32(4, 0, true);
    expect(() => readRsdkV5Animation(data)).toThrow("frame count");
    new DataView(data.buffer).setUint32(4, 2, true);
    expect(() => readRsdkV5Animation(data)).toThrow("total frame count");
  });
});

const local = fileURLToPath(new URL("../Sonic3ku.rsdk", import.meta.url));
describe.skipIf(!fs.existsSync(local))("local Sonic 3 player animations", () => {
  it("reads both available player animation sets and resolves their sprite sheets", () => {
    const archive = new RsdkV5Archive(fs.readFileSync(local));
    for (const name of ["Sonic", "Tails"]) {
      const animation = readRsdkV5Animation(archive.read(`Data/Sprites/3K_Players/${name}.bin`));
      expect(animation.animations.length).toBeGreaterThan(20);
      expect(animation.animations.some((entry) => entry.name.toLowerCase().includes("walk"))).toBe(true);
      expect(animation.hitboxTypes).toContain("Outer Box");
      for (const sheet of animation.sheets) expect(archive.has(`Data/Sprites/${sheet}`)).toBe(true);
      const unresolved = animation.animations.filter((entry) => entry.frames.some((frame) => frame.sheet >= animation.sheets.length));
      expect(unresolved.map((entry) => entry.name)).toEqual(name === "Tails" ? ["Continue"] : []);
    }
  });
});
