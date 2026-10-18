// RSDKv5 GameConfig.bin layout:
// https://github.com/RSDKModding/RetroED/blob/master/RetroEDv2/dependencies/libRSDK/formats/RSDKv5/gameconfigv5.hpp

import { RsdkV5Reader } from "./rsdkv5-reader.js";

export interface RsdkV5Scene {
  name: string;
  folder: string;
  id: string;
  /** Absent in the pre-filter revision of the format. */
  filter: number | null;
}

export interface RsdkV5GameConfig {
  title: string;
  subtitle: string;
  version: string;
  startCategory: number;
  startScene: number;
  objects: string[];
  /** Eight banks, each containing sixteen optional rows of sixteen RGB colors. */
  palettes: (Uint8Array | null)[][];
  soundFX: { path: string; maxConcurrentPlay: number }[];
  categories: { name: string; scenes: RsdkV5Scene[] }[];
  globalVariables: { index: number; values: number[] }[];
}

export function readRsdkV5Palettes(reader: RsdkV5Reader): (Uint8Array | null)[][] {
  return Array.from({ length: 8 }, () => {
    const mask = reader.u16();
    return Array.from({ length: 16 }, (_, row) => (mask & (1 << row)) ? reader.bytes(48) : null);
  });
}

/** Filter bytes were added after the initial v5 release; callers must select the older layout explicitly. */
export function readRsdkV5GameConfig(data: Uint8Array, sceneFilters = true): RsdkV5GameConfig {
  const reader = new RsdkV5Reader(data, "RSDKv5 game configuration");
  if (String.fromCharCode(...reader.bytes(4)) !== "CFG\0") throw new Error("not an RSDKv5 game configuration");
  const title = reader.str(), subtitle = reader.str(), version = reader.str();
  const startCategory = reader.u8(), startScene = reader.u16();
  const objects = Array.from({ length: reader.u8() }, () => reader.str());
  const palettes = readRsdkV5Palettes(reader);
  const soundFX = Array.from({ length: reader.u8() }, () => ({ path: reader.str(), maxConcurrentPlay: reader.u8() }));
  const totalScenes = reader.u16();
  const categories = Array.from({ length: reader.u8() }, () => {
    const name = reader.str();
    const scenes = Array.from({ length: reader.u8() }, () => ({
      name: reader.str(), folder: reader.str(), id: reader.str(), filter: sceneFilters ? reader.u8() : null,
    }));
    return { name, scenes };
  });
  if (categories.reduce((count, category) => count + category.scenes.length, 0) !== totalScenes) {
    throw new Error("RSDKv5 game configuration scene count does not match its categories");
  }
  const globalVariables = Array.from({ length: reader.u8() }, () => {
    const index = reader.s32(), count = reader.s32();
    if (index < 0 || count < 0 || count > Math.floor(reader.remaining / 4)) {
      throw new Error("invalid RSDKv5 game configuration global variable range");
    }
    return { index, values: Array.from({ length: count }, () => reader.s32()) };
  });
  if (reader.remaining) throw new Error(`unexpected trailing bytes in RSDKv5 game configuration: ${reader.remaining}`);
  return { title, subtitle, version, startCategory, startScene, objects, palettes, soundFX, categories, globalVariables };
}
