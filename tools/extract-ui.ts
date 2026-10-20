// Artwork for the web UI, rendered by the engine from the extracted packs (the user's own game data):
//
//   npm run extract:ui -- [--data data] [--out data/ui] [--game sonic1]
//
// For each game with a data/<game>/core.pak it writes, under <out>/<game>/:
//   cover.png             the game's title screen
//   demo.png              a moment of the title screen's attract-mode gameplay (Sonic 1 and 2)
//   chars/<id>.png        each playable character standing at the start of the first act
//   stages/<listPos>.png  every regular stage just after its title card (for the level picker)
//   ui.json               what was written
// Nothing is committed; the data folder stays local.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePng } from "./png.js";
import { Vfs } from "../packages/engine/src/core/pak.js";
import { createGameSim, type AnyGameSim } from "../packages/engine/src/sim.js";
import { nullHost } from "../packages/engine/src/host.js";
import { SoftwareRenderer } from "../packages/engine/src/render/drawing.js";
import { SoftwareRenderer3 } from "../packages/engine/src/v3/render.js";
import { CHARACTERS, isCharacterAvailable, type GameId } from "../packages/engine/src/net/protocol.js";

const W = 424, H = 240;

/** When the title screen shows its logo, and (Sonic 1 and 2) when the attract demo is playing. */
const SHOTS: Record<string, { cover: number; demo?: number }> = {
  sonic1: { cover: 900, demo: 1500 },
  sonic2: { cover: 900, demo: 1500 },
  soniccd: { cover: 1200 },
};

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

class Shooter {
  readonly sim: AnyGameSim;
  private renderer: SoftwareRenderer | SoftwareRenderer3;
  constructor(readonly game: GameId, vfs: Vfs, character = 0) {
    this.sim = createGameSim(game, vfs, nullHost, { headless: false, players: 1 });
    this.sim.configurePlayers([character]);
    this.renderer = game === "soniccd" ? new SoftwareRenderer3(W) : new SoftwareRenderer(W);
    (this.sim.E as { draw: unknown }).draw = this.renderer;
  }

  run(frames: number): boolean {
    for (let f = 0; f < frames; f++) {
      const events = this.sim.tick([0]);
      if (events.some((e) => e.type === "scriptError")) return false;
    }
    return true;
  }

  frame(): Uint32Array {
    const px = new Uint32Array(W * H);
    this.renderer.toRGBA(px);
    return px;
  }
}

function save(file: string, w: number, h: number, px: Uint32Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writePng(file, w, h, new Uint8Array(px.buffer, px.byteOffset, w * h * 4));
}

function crop(px: Uint32Array, x0: number, y0: number, w: number, h: number): Uint32Array {
  x0 = Math.max(0, Math.min(W - w, x0));
  y0 = Math.max(0, Math.min(H - h, y0));
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) out.set(px.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w);
  return out;
}

/** Player 1's position on screen. */
function playerOnScreen(sim: AnyGameSim): { x: number; y: number } {
  const E = sim.E;
  if ("playerList" in E) return { x: E.playerList[0].screenXPos, y: E.playerList[0].screenYPos };
  const p = E.objectEntityList[0];
  E.setCamera(0);
  return { x: (p.xpos >> 16) - E.xScrollOffset, y: (p.ypos >> 16) - E.yScrollOffset };
}

export function exportUi(game: GameId, pak: Uint8Array, outDir: string): Record<string, unknown> {
  const vfs = () => {
    const v = new Vfs();
    v.addPak(pak);
    return v;
  };
  const written: Record<string, unknown> = {};

  // title screen and attract demo
  const shots = SHOTS[game];
  const title = new Shooter(game, vfs());
  title.sim.startStage(0, 0);
  let t = 0;
  for (const [name, at] of [["cover", shots.cover], ["demo", shots.demo]] as const) {
    if (at === undefined) continue;
    if (!title.run(at - t)) break;
    t = at;
    save(path.join(outDir, `${name}.png`), W, H, title.frame());
    written[name] = `${name}.png`;
  }

  // characters, standing at the start of the first act
  const chars: Record<string, string> = {};
  for (const c of CHARACTERS) {
    if (!isCharacterAvailable(game, c.id)) continue;
    const s = new Shooter(game, vfs(), c.id);
    s.sim.startStage(1, 0);
    if (!s.run(240)) continue;
    const { x, y } = playerOnScreen(s.sim);
    const file = `chars/${c.name.toLowerCase()}.png`;
    save(path.join(outDir, file), 64, 64, crop(s.frame(), x - 30, y - 36, 64, 64));
    chars[c.id] = file;
  }
  written.chars = chars;

  // every regular stage, once its title card has gone
  const stages: Record<string, string> = {};
  const lister = new Shooter(game, vfs());
  const count = lister.sim.E.stageList[1].length;
  for (let i = 0; i < count; i++) {
    const s = new Shooter(game, vfs());
    try {
      s.sim.startStage(1, i);
      if (!s.run(game === "soniccd" ? 200 : 320)) continue; // until the title card has gone
    } catch {
      continue;
    }
    const file = `stages/${i}.png`;
    save(path.join(outDir, file), W, H, s.frame());
    stages[i] = file;
  }
  written.stages = stages;
  fs.writeFileSync(path.join(outDir, "ui.json"), JSON.stringify(written, null, 1));
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = path.resolve(arg("data", "data"));
  const out = path.resolve(arg("out", path.join(data, "ui")));
  const only = arg("game", "");
  for (const game of ["sonic1", "sonic2", "soniccd"] as const) {
    if (only && only !== game) continue;
    const file = path.join(data, game, "core.pak");
    if (!fs.existsSync(file)) {
      console.warn(`skipping ${game}: no ${file}`);
      continue;
    }
    const t0 = Date.now();
    const dir = path.join(out, game);
    fs.rmSync(dir, { recursive: true, force: true });
    const w = exportUi(game, new Uint8Array(fs.readFileSync(file)), dir);
    console.log(`${game}: cover${w.demo ? ", demo" : ""}, ${Object.keys(w.chars as object).length} characters, ${Object.keys(w.stages as object).length} stages in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
