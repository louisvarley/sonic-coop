import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vfs } from "../packages/engine/src/core/pak.js";
import { GameSim } from "../packages/engine/src/game.js";
import { nullHost } from "../packages/engine/src/host.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Game data is extracted from the user's own files and is not part of the repository. */
export function hasData(game: string): boolean {
  return fs.existsSync(path.join(root, "data", game, "core.pak"));
}

const paks = new Map<string, Uint8Array>();
export function loadVfs(game: string): Vfs {
  let pak = paks.get(game);
  if (!pak) {
    pak = new Uint8Array(fs.readFileSync(path.join(root, "data", game, "core.pak")));
    paks.set(game, pak);
  }
  const vfs = new Vfs();
  vfs.addPak(pak);
  return vfs;
}

export function newSim(game: string, players = 1, headless = true): GameSim {
  return new GameSim(loadVfs(game), nullHost, { headless, players });
}

export function startStage(sim: GameSim, name: string, list = 1, player = 0): void {
  const idx = sim.findStage(name, list);
  if (idx < 0) throw new Error(`no stage ${name}`);
  sim.startStage(list, idx, player);
}
