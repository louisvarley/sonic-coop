// Developer tool: render frames of a stage to PNG files (no browser needed).
//   tsx tools/dev/screenshot.ts sonic1 "GREEN HILL ZONE 1" 300,400 out/ghz [right]
import fs from "node:fs";
import path from "node:path";
import { writePng } from "../png.js";
import { Vfs } from "../../packages/engine/src/core/pak.js";
import { GameSim } from "../../packages/engine/src/game.js";
import { nullHost } from "../../packages/engine/src/host.js";
import { SoftwareRenderer } from "../../packages/engine/src/render/drawing.js";
import { BTN } from "../../packages/engine/src/input.js";

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
