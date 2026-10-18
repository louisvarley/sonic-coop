// Developer tool: run a stage headless and print what the players are doing.
//   tsx tools/dev/run-headless.ts sonic2 "EMERALD HILL ZONE 1" 600 [buttons]
import fs from "node:fs";
import path from "node:path";
import { Vfs } from "../../packages/engine/src/core/pak.js";
import { GameSim } from "../../packages/engine/src/game.js";
import { BTN } from "../../packages/engine/src/input.js";

const [game = "sonic2", stageName = "", framesArg = "600", hold = "right"] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const vfs = new Vfs();
vfs.addPak(new Uint8Array(fs.readFileSync(path.join(root, "data", game, "core.pak"))));
const logs: string[] = [];
const sim = new GameSim(vfs, {
  log: (m) => logs.push(m), playSfx() {}, stopSfx() {}, setSfxAttributes() {}, setMusicTrack() {}, playMusic() {}, stopMusic() {},
  pauseMusic() {}, resumeMusic() {}, swapMusicTrack() {}, setMusicVolume() {},
}, { headless: true, players: 1 });
const E = sim.E;
console.log("game:", E.gameWindowText, "| globals:", E.globalVariableNames.length, "| players:", E.playerNames.join(","));
console.log("regular stages:", E.stageList[1].map((s) => s.name).join(" | "));
const idx = stageName ? sim.findStage(stageName) : 0;
sim.startStage(1, idx < 0 ? 0 : idx, 0);
const pad = hold.split("+").reduce((m, k) => m | ((BTN as Record<string, number>)[k.toUpperCase()] ?? 0), 0);
const t0 = performance.now();
const frames = +framesArg;
for (let f = 0; f < frames; f++) {
  const ev = sim.tick([f > 60 ? pad : 0]);
  for (const e of ev) console.log(`f${f}:`, JSON.stringify(e));
  if (f % 60 === 0 || f === frames - 1) {
    const p = E.objectEntityList[0];
    console.log(`f${f}: P1 type ${p.type} (${E.typeNames[p.type]}) x=${p.xpos >> 16} y=${p.ypos >> 16} speed=${p.speed} state=${p.state} anim=${p.animation} cam=${E.xScrollOffset},${E.yScrollOffset} rings=${sim.global("player.rings")}`);
  }
}
console.log(`${frames} frames in ${(performance.now() - t0).toFixed(0)} ms`);
if (E.compiler.errors.length) console.log("compile errors:", E.compiler.errors.slice(0, 10));
console.log("warnings:", E.compiler.warnings.length, E.compiler.warnings.slice(0, 15).join("\n"));
console.log("log:", logs.slice(0, 30).join("\n"));
