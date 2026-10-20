// RetroEngine::LoadGameConfig (RSDKv3) and the global variable helpers.

import type { Engine3 } from "./engine.js";
import { FileReader } from "../core/reader.js";
import { STAGELIST_BONUS, STAGELIST_SPECIAL } from "./consts.js";

export interface GameConfig3 {
  objectNames: string[];
  scriptPaths: string[];
  sfxPaths: string[];
}

/** Global variables added by Ring Link for the co-op patches (games/soniccd/patches.ts). */
export const COOP_GLOBALS3: [string, number][] = [
  ["Coop.InfiniteLives", 1],
  ["Coop.TailsFlight", 1],
  ["Coop.PeelOut", 1],
];

export function LoadGameConfig(E: Engine3): GameConfig3 {
  const data = E.vfs.get("Data/Game/GameConfig.bin");
  if (!data) throw new Error("Data/Game/GameConfig.bin missing from the game data");
  const f = new FileReader(data);
  E.gameWindowText = f.str();
  f.str(); // "Data"
  E.gameDescriptionText = f.str();

  const objectCount = f.u8();
  const objectNames: string[] = [];
  for (let o = 0; o < objectCount; ++o) objectNames.push(f.str());
  const scriptPaths: string[] = [];
  for (let s = 0; s < objectCount; ++s) scriptPaths.push(f.str());

  const varCount = f.u8();
  E.globalVariableNames = [];
  for (let v = 0; v < varCount; ++v) {
    E.globalVariableNames.push(f.str());
    const b0 = f.u8(), b1 = f.u8(), b2 = f.u8(), b3 = f.u8();
    E.globalVariables[v] = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
  }

  const sfxCount = f.u8();
  const sfxPaths: string[] = [];
  for (let s = 0; s < sfxCount; ++s) sfxPaths.push(f.str());

  const plrCount = f.u8();
  E.playerNames = [];
  for (let p = 0; p < plrCount; ++p) E.playerNames.push(f.str());

  for (let c = 0; c < 4; ++c) {
    // Special stages are stored as category 2 in the file but are category 3 in the game.
    const cat = c === 2 ? STAGELIST_SPECIAL : c === 3 ? STAGELIST_BONUS : c;
    E.stageListCount[cat] = f.u8();
    E.stageList[cat] = [];
    for (let s = 0; s < E.stageListCount[cat]; ++s) {
      const folder = f.str();
      const id = f.str();
      const name = f.str();
      const highlighted = f.u8();
      E.stageList[cat].push({ folder, id, name, highlighted });
    }
  }

  // Ring Link's co-op settings (see GameSettings), after the game's own globals so their ids are unchanged.
  for (const [name, value] of COOP_GLOBALS3) {
    E.globalVariables[E.globalVariableNames.length] = value;
    E.globalVariableNames.push(name);
  }

  // Set by the decompilation's engine (RetroEngine::LoadGameConfig with the mod loader).
  SetGlobalVariableByName(E, "Options.DevMenuFlag", 0);
  SetGlobalVariableByName(E, "Engine.PlatformId", 0);
  SetGlobalVariableByName(E, "Engine.DeviceType", 0);
  SetGlobalVariableByName(E, "Engine.Standalone", 1);
  SetGlobalVariableByName(E, "game.hasPlusDLC", 1);
  E.usingOrigins = GetGlobalVariableID(E, "game.playMode") !== 0xff;
  return { objectNames, scriptPaths, sfxPaths };
}

export function GetGlobalVariableID(E: Engine3, name: string): number {
  const i = E.globalVariableNames.indexOf(name);
  return i < 0 ? 0xff : i;
}

export function GetGlobalVariableByName(E: Engine3, name: string): number {
  const i = E.globalVariableNames.indexOf(name);
  return i < 0 ? 0 : E.globalVariables[i];
}

export function SetGlobalVariableByName(E: Engine3, name: string, value: number): void {
  const i = E.globalVariableNames.indexOf(name);
  if (i >= 0) E.globalVariables[i] = value;
}
