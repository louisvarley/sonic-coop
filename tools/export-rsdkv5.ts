// Offline experimental Angel Island export; source data and output must never be committed.
// npm run export:sonic3 -- [archive] [output pack]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { RsdkV5Archive } from "./rsdkv5.js";
import { readRsdkV5GameConfig } from "./rsdkv5-config.js";
import { loadRsdkV5Stage } from "./rsdkv5-stage.js";
import { readRsdkV5Animation } from "./rsdkv5-animation.js";
import { readRsdkV5Gif } from "./rsdkv5-tileset.js";
import { writePak, type PakEntry } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { readV5Level, type V5Sprite } from "../packages/engine/src/v5/level.js";
import type { V5Object } from "../packages/engine/src/v5/gameplay.js";

export function exportV5AngelIsland(archive: RsdkV5Archive): Uint8Array {
  const game = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
  const stage = loadRsdkV5Stage(archive, game, "Data/Stages/3K_AIZ1/Scene1.bin");
  if (!stage.collision) throw new Error("Angel Island has no collision data");
  const player = stage.scene.objects.find((_, i) => stage.objectNames[i] === "Player")?.entities[0];
  if (!player) throw new Error("Angel Island has no player marker");
  const collisionLayers = stage.scene.layers.flatMap((layer, index) => ["FG Low", "FG High"].includes(layer.name) ? [index] : []);
  if (collisionLayers.length !== 2) throw new Error("Angel Island foreground collision layers are missing");
  const entries: PakEntry[] = [];
  const add = (name: string, data: Uint8Array) => entries.push({ key: rsdkPathKey(name), data });
  const palette = Uint8Array.from(stage.tileset.palette);
  for (const bank of [game.palettes[0], stage.config.palettes[0]]) bank.forEach((row, i) => { if (row) palette.set(row, i * 48); });
  add("tiles.bin", stage.tileset.pixels); add("palette.rgb", palette);
  stage.scene.layers.forEach((layer, index) => {
    const data = new Uint8Array(layer.tiles.length * 2), view = new DataView(data.buffer);
    layer.tiles.forEach((tile, i) => view.setUint16(i * 2, tile, true));
    add(`layer${index}.bin`, data);
  });
  stage.collision.forEach((plane, index) => {
    const data = new Uint8Array(plane.length * 38);
    plane.forEach((mask, i) => {
      const offset = i * 38;
      data.set(mask.heights, offset); data.set(mask.solid, offset + 16);
      data.set([mask.direction, mask.floorAngle, mask.leftWallAngle, mask.rightWallAngle, mask.roofAngle, mask.flags], offset + 32);
    });
    add(`collision${index}.bin`, data);
  });
  const objects: V5Object[] = [], unsupported = new Map<string, number>();
  const hash = (name: string) => createHash("md5").update(name).digest("hex");
  stage.scene.objects.forEach((object, index) => {
    const name = stage.objectNames[index] ?? object.hash;
    const fields = new Map(object.variables.map((v, i) => [v.hash, i]));
    for (const entity of object.entities) {
      const get = (name: string) => {
        const at = fields.get(hash(name));
        if (at === undefined) throw new Error(`missing ${name} variable in ${stage.objectNames[index]}`);
        return entity.values[at];
      };
      const base = { id: entity.slot, x: entity.x, y: entity.y, plane: null };
      if (name === "Ring" && get("type") === 0 && get("planeFilter") === 0 && get("speed") === 0) {
        objects.push({ ...base, kind: "ring" });
      } else if (name === "StarPost") {
        objects.push({ ...base, kind: "checkpoint" });
      } else if (name === "Spring" && get("type") === 0 && get("flipFlag") === 0 && get("planeFilter") === 0) {
        objects.push({ ...base, kind: "spring", vx: 0, vy: -10 * 65536 });
      } else if (name === "Spikes" && get("type") === 0 && get("moving") === false && get("planeFilter") === 0) {
        const count = get("count");
        if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 64) throw new Error("invalid static spike count");
        objects.push({ ...base, kind: "hazard", halfWidth: count * 16, halfHeight: 8 });
      } else if (name !== "Player" && name !== "Blank Object") unsupported.set(name, (unsupported.get(name) ?? 0) + 1);
    }
  });
  const sprites = ["Sonic", "Tails"].map((name, index): Omit<V5Sprite, "pixels" | "palette"> => {
    const animation = readRsdkV5Animation(archive.read(`Data/Sprites/3K_Players/${name}.bin`));
    if (animation.sheets.length !== 1) throw new Error(`expected one sheet for experimental ${name} renderer`);
    const sheet = readRsdkV5Gif(archive.read(`Data/Sprites/${animation.sheets[0]}`));
    add(`sprite${index}.bin`, sheet.pixels);
    // This standalone experiment has no character palette-swapping logic; preserve the sheet's own colors.
    add(`sprite${index}.rgb`, sheet.palette);
    return { name, width: sheet.width, height: sheet.height, animations: ["Idle", "Walk", "Jump"].map((name) => {
      const entry = animation.animations.find((entry) => entry.name === name);
      if (!entry || !entry.frames.length || entry.frames.some((frame) => frame.sheet !== 0 || frame.duration < 1)) {
        throw new Error(`missing or unsupported ${name} animation`);
      }
      return { name, speed: entry.speed, loopIndex: entry.loopIndex, frames: entry.frames.map((frame) => ({
        x: frame.x, y: frame.y, width: frame.width, height: frame.height, pivotX: frame.pivotX, pivotY: frame.pivotY, duration: frame.duration,
      })) };
    }) };
  });
  const metadata = {
    version: 1, title: "Angel Island Act 1 - experimental", background: stage.scene.editor.background1,
    layers: stage.scene.layers.map(({ width, height, visible, drawGroup }) => ({ width, height, visible, drawGroup })),
    collisionLayers, spawns: [{ x: player.x, y: player.y }, { x: player.x + 32 * 65536, y: player.y }],
    deathY: Math.max(...collisionLayers.map((i) => stage.scene.layers[i].height)) * 16 * 65536 + 128 * 65536,
    objects, unsupported: [...unsupported].map(([name, count]) => ({ name, count })), sprites,
  };
  add("meta.json", new TextEncoder().encode(JSON.stringify(metadata)));
  const bytes = writePak(entries);
  readV5Level(bytes);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source = "Sonic3ku.rsdk", out = path.join("data", "sonic3", "experimental.pak"), ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("usage: npm run export:sonic3 -- [archive] [output pack]");
    const bytes = exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(source)));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, bytes);
    const level = readV5Level(bytes);
    console.log(JSON.stringify({ out, bytes: bytes.length, playable: false, experimental: true, objects: level.objects.length,
      unsupported: level.unsupported, browser: "Open /sonic3.html on the client development server" }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
