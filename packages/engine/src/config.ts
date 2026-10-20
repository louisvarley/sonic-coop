// RetroEngine::LoadGameConfig plus this project's additions (co-op globals).

import type { Engine } from "./engine.js";
import { FileReader } from "./core/reader.js";
import { SetPaletteEntry } from "./palette.js";
import { STAGELIST_SPECIAL, STAGELIST_BONUS, GLOBALVAR_COUNT } from "./c.js";

export interface GameConfig {
  windowText: string;
  description: string;
  palette: Uint8Array;
  objectNames: string[];
  scriptPaths: string[];
  sfxNames: string[];
  sfxPaths: string[];
}

/**
 * Global variables added by Ring Link. The co-op script patches read these; they are appended after the game's
 * own globals so the original variable ids are unchanged.
 */
export const COOP_GLOBALS: [string, number][] = [
  ["coop.enabled", 0], // 1 when more than one human player is in the level
  ["coop.playerCount", 1],
  ["coop.p2Character", 0], // character ids as in the GameConfig player list (0 Sonic, 1 Tails, 2 Knuckles)
  ["coop.p2Lives", 3], // Sonic 1 keeps one lives counter (player 1's); this is player 2's
  ["coop.respawnRule", 1], // 0: next to the partner, 1: at the last checkpoint (the partner when that is out of reach)
  ["coop.infiniteLives", 1], // lives never run out (the engine keeps them topped up) and the HUD shows ∞
  ["coop.tailsFlight", 1], // Tails can fly
  ["coop.knuxClimb", 1], // Knuckles can climb walls (otherwise he drops off them)
  ["coop.spawnX", 0], // where the act started: the respawn point before any checkpoint
  ["coop.spawnY", 0],
];

/** Native functions in registration order (their id is their position; scripts see them as globals of that name). */
export const NATIVE_FUNCTIONS = [
  "SetAchievement", "SetLeaderboard", "HapticEffect", "Connect2PVS", "Disconnect2PVS", "SendEntity", "SendValue", "ReceiveEntity",
  "ReceiveValue", "TransmitGlobal", "ShowPromoPopup", "NativePlayerWaitingAds", "NativeWaterPlayerWaitingAds", "NotifyCallback",
];

export function getGlobalVariableID(E: Engine, name: string): number {
  return E.globalVariableNames.indexOf(name);
}

export function setGlobalVariableByName(E: Engine, name: string, value: number): void {
  const id = getGlobalVariableID(E, name);
  if (id >= 0) E.globalVariables[id] = value;
}

export function getGlobalVariableByName(E: Engine, name: string): number {
  const id = getGlobalVariableID(E, name);
  return id >= 0 ? E.globalVariables[id] : 0;
}

export function LoadGameConfig(E: Engine): GameConfig {
  const data = E.vfs.get("Data/Game/GameConfig.bin");
  if (!data) throw new Error("Data/Game/GameConfig.bin missing from the game data");
  const f = new FileReader(data);
  const cfg: GameConfig = { windowText: f.str(), description: f.str(), palette: new Uint8Array(0x60 * 3), objectNames: [], scriptPaths: [], sfxNames: [], sfxPaths: [] };
  for (let c = 0; c < 0x60; ++c) {
    const r = f.u8(), g = f.u8(), b = f.u8();
    cfg.palette.set([r, g, b], c * 3);
    SetPaletteEntry(E, 0xff, c, r, g, b);
  }
  const objectCount = f.u8();
  for (let o = 0; o < objectCount; ++o) cfg.objectNames.push(f.str());
  for (let o = 0; o < objectCount; ++o) cfg.scriptPaths.push(f.str());

  const varCount = f.u8();
  E.globalVariableNames = [];
  for (let v = 0; v < varCount; ++v) {
    E.globalVariableNames.push(f.str());
    E.globalVariables[v] = f.s32();
  }
  for (const [name, value] of COOP_GLOBALS) {
    if (E.globalVariableNames.length >= GLOBALVAR_COUNT) throw new Error("no room for co-op globals");
    E.globalVariables[E.globalVariableNames.length] = value;
    E.globalVariableNames.push(name);
  }

  const sfxCount = f.u8();
  for (let s = 0; s < sfxCount; ++s) cfg.sfxNames.push(f.str());
  for (let s = 0; s < sfxCount; ++s) cfg.sfxPaths.push(f.str());
  E.globalSFXCount = sfxCount;
  cfg.sfxNames.forEach((n, i) => {
    E.sfxNames[i] = n.replace(/ /g, "");
    E.sfxPaths[i] = cfg.sfxPaths[i];
    E.host.loadSfx?.(i, cfg.sfxPaths[i]);
  });

  const playerCount = f.u8();
  E.playerNames = [];
  for (let p = 0; p < playerCount; ++p) E.playerNames.push(f.str());

  for (let c = 0; c < 4; ++c) {
    // special stages are stored second-to-last in the file but are list 3 in the game
    const cat = c === 2 ? STAGELIST_SPECIAL : c === 3 ? STAGELIST_BONUS : c;
    const count = f.u8();
    E.stageListCount[cat] = count;
    E.stageList[cat] = [];
    for (let s = 0; s < count; ++s) {
      const folder = f.str();
      const id = f.str();
      const name = f.str();
      const highlighted = f.u8();
      E.stageList[cat].push({ folder, id, name, highlighted });
    }
  }

  E.gameWindowText = cfg.windowText;
  E.gameType = cfg.windowText.includes("Sonic 1") ? "sonic1" : "sonic2";
  setGlobalVariableByName(E, "engine.standalone", 1);
  setGlobalVariableByName(E, "game.hasPlusDLC", 0); // DLC content stays disabled (decompilation licence)

  E.nativeFunctionNames = [];
  NATIVE_FUNCTIONS.forEach((name, i) => {
    E.nativeFunctionNames[i] = name;
    setGlobalVariableByName(E, name, i);
  });
  E.musicVolume = 100;
  E.gameConfig = cfg;
  return cfg;
}
