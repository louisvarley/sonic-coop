// Game data on the server: the extracted packs are mounted read-only (never baked into the image).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Vfs, type GameId } from "@ringlink/engine";
import { readV5Level } from "../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../packages/engine/src/v5/movement.js";
import { V5Gameplay } from "../../../packages/engine/src/v5/gameplay.js";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");

const paks = new Map<GameId, Uint8Array>();

const PACK_FILES: Record<GameId, string> = { sonic1: "core.pak", sonic2: "core.pak", sonic3: "experimental.pak" };

export function availableGames(): GameId[] {
  return (Object.keys(PACK_FILES) as GameId[]).filter((g) => fs.existsSync(path.join(DATA_DIR, g, PACK_FILES[g])));
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

let sonic3Pack: { bytes: Uint8Array; hash: string } | null = null;

/** The exported Sonic 3 level pack and its MD5 (asset identity for client/server agreement, not authentication). */
export function loadSonic3Pack(): { bytes: Uint8Array; hash: string } {
  if (!sonic3Pack) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(DATA_DIR, "sonic3", PACK_FILES.sonic3)));
    sonic3Pack = { bytes, hash: createHash("md5").update(bytes).digest("hex") };
  }
  return sonic3Pack;
}

export function createSonic3Game(): V5Gameplay {
  const level = readV5Level(loadSonic3Pack().bytes);
  if (level.spawns.length !== 2) throw new Error("Sonic 3 needs two player spawns");
  return new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
    level.collisionLayers, level.spawns), level.objects, level.deathY);
}
