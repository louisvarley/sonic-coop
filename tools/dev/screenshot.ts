// Developer tool: render frames of a stage to PNG files (no browser needed).
//   tsx tools/dev/screenshot.ts sonic1 "GREEN HILL ZONE 1" 300,400 out/ghz [right]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Vfs } from "../../packages/engine/src/core/pak.js";
import { GameSim } from "../../packages/engine/src/game.js";
import { nullHost } from "../../packages/engine/src/host.js";
import { SoftwareRenderer } from "../../packages/engine/src/render/drawing.js";
import { BTN } from "../../packages/engine/src/input.js";

export function writePng(file: string, w: number, h: number, rgba: Uint8Array): void {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Uint8Array) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(Buffer.from(type, "latin1"), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
}

const [game = "sonic1", stageName = "", framesArg = "300", outBase = "out/shot", hold = "right"] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const vfs = new Vfs();
vfs.addPak(new Uint8Array(fs.readFileSync(path.join(root, "data", game, "core.pak"))));
const sim = new GameSim(vfs, { ...nullHost, log: (m) => console.log(m) }, { headless: false, players: 1 });
const r = new SoftwareRenderer(424);
sim.E.draw = r;
const idx = stageName ? sim.findStage(stageName) : 0;
sim.startStage(1, idx < 0 ? 0 : idx, 0);
const shots = new Set(framesArg.split(",").map(Number));
const last = Math.max(...shots);
const pad = hold.split("+").reduce((m, k) => m | ((BTN as Record<string, number>)[k.toUpperCase()] ?? 0), 0);
fs.mkdirSync(path.dirname(path.resolve(root, outBase)), { recursive: true });
const rgba = new Uint32Array(424 * 240);
const t0 = performance.now();
for (let f = 0; f <= last; f++) {
  sim.tick([f > 120 ? pad : 0]);
  if (shots.has(f)) {
    r.toRGBA(rgba);
    const file = path.resolve(root, `${outBase}-${f}.png`);
    writePng(file, 424, 240, new Uint8Array(rgba.buffer));
    const p = sim.E.objectEntityList[0];
    console.log(`frame ${f}: ${file} (P1 ${p.xpos >> 16},${p.ypos >> 16})`);
  }
}
console.log(`${last + 1} frames rendered in ${(performance.now() - t0).toFixed(0)} ms`);
