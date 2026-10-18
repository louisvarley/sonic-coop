// Stage resources are data, not executable v5 game logic.
import { createHash } from "node:crypto";
import { readRsdkV5Palettes, type RsdkV5GameConfig } from "./rsdkv5-config.js";
import { RsdkV5Reader } from "./rsdkv5-reader.js";
import { readRsdkV5Scene, type RsdkV5SceneData } from "./rsdkv5-scene.js";
import type { RsdkV5Archive } from "./rsdkv5.js";
import { readRsdkV5Tileset, type RsdkV5Tileset } from "./rsdkv5-tileset.js";
import type { V5CollisionMask } from "../packages/engine/src/v5/collision.js";

export interface RsdkV5StageConfig {
  loadGlobalObjects: boolean;
  objects: string[];
  palettes: (Uint8Array | null)[][];
  soundFX: { path: string; maxConcurrentPlay: number }[];
}

export type RsdkV5CollisionMask = V5CollisionMask;

export function readRsdkV5StageConfig(data: Uint8Array): RsdkV5StageConfig {
  const reader = new RsdkV5Reader(data, "RSDKv5 stage configuration");
  if (String.fromCharCode(...reader.bytes(4)) !== "CFG\0") throw new Error("not an RSDKv5 stage configuration");
  const loadGlobalObjects = reader.u8() !== 0;
  const objects = Array.from({ length: reader.u8() }, () => reader.str());
  const palettes = readRsdkV5Palettes(reader);
  const soundFX = Array.from({ length: reader.u8() }, () => ({ path: reader.str(), maxConcurrentPlay: reader.u8() }));
  if (reader.remaining) throw new Error(`unexpected trailing bytes in RSDKv5 stage configuration: ${reader.remaining}`);
  return { loadGlobalObjects, objects, palettes, soundFX };
}

export function readRsdkV5TileConfig(data: Uint8Array): RsdkV5CollisionMask[][] {
  const reader = new RsdkV5Reader(data, "RSDKv5 tile configuration");
  if (String.fromCharCode(...reader.bytes(4)) !== "TIL\0") throw new Error("not an RSDKv5 tile configuration");
  const masks = new RsdkV5Reader(reader.compressed(2 * 1024 * 38), "RSDKv5 collision masks");
  const paths = Array.from({ length: 2 }, () => Array.from({ length: 1024 }, () => ({
    heights: masks.bytes(16), solid: masks.bytes(16), direction: masks.u8(),
    floorAngle: masks.u8(), leftWallAngle: masks.u8(), rightWallAngle: masks.u8(),
    roofAngle: masks.u8(), flags: masks.u8(),
  })));
  if (reader.remaining) throw new Error(`unexpected trailing bytes in RSDKv5 tile configuration: ${reader.remaining}`);
  return paths;
}

export interface RsdkV5Stage {
  scene: RsdkV5SceneData;
  config: RsdkV5StageConfig;
  /** Menus and other non-collision scenes may omit TileConfig.bin. */
  collision: RsdkV5CollisionMask[][] | null;
  tileset: RsdkV5Tileset;
  /** Aligned with scene.objects; unresolved hashes remain explicit. */
  objectNames: (string | null)[];
}

export function loadRsdkV5Stage(
  archive: Pick<RsdkV5Archive, "read" | "has">,
  gameConfig: RsdkV5GameConfig,
  scenePath: string,
): RsdkV5Stage {
  const normalized = scenePath.replace(/\\/g, "/");
  const match = /^Data\/Stages\/[^/]+\/Scene[^/]+\.bin$/i.exec(normalized);
  if (!match) throw new Error(`invalid RSDKv5 scene path: ${scenePath}`);
  const folder = normalized.slice(0, normalized.lastIndexOf("/") + 1);
  const scene = readRsdkV5Scene(archive.read(normalized));
  const config = readRsdkV5StageConfig(archive.read(`${folder}StageConfig.bin`));
  const names = ["Blank Object", ...(config.loadGlobalObjects ? gameConfig.objects : []), ...config.objects];
  const byHash = new Map(names.map((name) => [createHash("md5").update(name).digest("hex"), name]));
  const collisionPath = `${folder}TileConfig.bin`;
  return {
    scene, config,
    collision: archive.has(collisionPath) ? readRsdkV5TileConfig(archive.read(collisionPath)) : null,
    tileset: readRsdkV5Tileset(archive.read(`${folder}16x16Tiles.gif`)),
    objectNames: scene.objects.map((object) => byHash.get(object.hash) ?? null),
  };
}
