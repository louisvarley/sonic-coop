// Game data on the server: the extracted packs are mounted read-only (never baked into the image).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGameSim, Vfs, type GameId, type LobbyStage, type ScriptHost } from "@ringlink/engine";
import { readV5Level } from "../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../packages/engine/src/v5/movement.js";
import { V5Gameplay } from "../../../packages/engine/src/v5/gameplay.js";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");

const paks = new Map<GameId, Uint8Array>();

const PACK_FILES: Record<GameId, string> = { sonic1: "core.pak", sonic2: "core.pak", sonic3: "experimental.pak", soniccd: "core.pak" };

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

const stageLists = new Map<GameId, LobbyStage[]>();

function actLabel(id: string): string {
  const text = id.trim();
  if (/^\d+$/.test(text)) return `Act ${text}`;
  return text || "Act 1";
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Level and act for every start position the selected game offers. */
export function stageList(game: GameId): LobbyStage[] {
  let list = stageLists.get(game);
  if (!list) {
    if (game === "sonic3") list = [{ level: "Angel Island Zone", act: "Act 1" }];
    else {
      const noop = () => {};
      const host = { log: noop, playSfx: noop, stopSfx: noop, setSfxAttributes: noop, setMusicTrack: noop, playMusic: noop,
        stopMusic: noop, pauseMusic: noop, resumeMusic: noop, swapMusicTrack: noop, setMusicVolume: noop } as unknown as ScriptHost;
      const sim = createGameSim(game, loadVfs(game), host, { headless: true, players: 1 });
      const stages = sim.E.stageList[1];
      if (game === "soniccd") {
        // Sonic CD lists every time zone of an act ("PALMTREE PANIC ZONE 1 A", then "B", "C", "D"); offer the first
        // zone of each act (A, the present, or C for the third acts, which have only futures).
        list = [];
        for (let i = 0; i < stages.length; i++) {
          const m = /^(.*?)\s+(\d+)\s+([A-D])$/.exec(stages[i].name.trim());
          if (m) list.push({ level: m[1], act: `Act ${m[2]}${m[3] === "C" ? " (good future)" : ""}`, listPos: i });
        }
      } else {
        list = [];
        let level = "";
        for (const s of stages) {
          const name = s.name.trim();
          const m = /^(.*?)\s*(\d+)$/.exec(name);
          if (m && m[1]) { level = titleCase(m[1]); list.push({ level, act: `Act ${m[2]}` }); }
          else if (/^\d+$/.test(name) && level) list.push({ level, act: `Act ${name}` });
          else { level = titleCase(name); list.push({ level, act: actLabel(s.id) }); }
        }
      }
    }
    stageLists.set(game, list);
  }
  return list;
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
