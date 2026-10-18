// Game data on the server: the extracted packs are mounted read-only (never baked into the image).

import fs from "node:fs";
import path from "node:path";
import { Vfs, type GameId } from "@ringlink/engine";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");

const paks = new Map<GameId, Uint8Array>();

export function availableGames(): GameId[] {
  return (["sonic1", "sonic2"] as GameId[]).filter((g) => fs.existsSync(path.join(DATA_DIR, g, "core.pak")));
}

export function loadVfs(game: GameId): Vfs {
  let pak = paks.get(game);
  if (!pak) {
    pak = new Uint8Array(fs.readFileSync(path.join(DATA_DIR, game, "core.pak")));
    paks.set(game, pak);
  }
  const vfs = new Vfs();
  vfs.addPak(pak);
  return vfs;
}
