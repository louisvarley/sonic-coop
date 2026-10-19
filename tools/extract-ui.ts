// Dumps a handful of the user's own sprite sheets to PNG for the web UI (title art, rings, characters).
//
//   npm run extract:ui -- [--source <folder>] [--out data/ui]
//
// Output: <out>/<game>/<sheet>.png, palette index 0 transparent. Nothing is committed; the data folder stays local.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRsdkIndex, decryptRsdkFile } from "./rsdk.js";
import { detectRsdkPacks, findPack } from "./rsdk-detect.js";
import { writePng } from "./png.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { FileReader } from "../packages/engine/src/core/reader.js";
import { readGifHeader, ReadGifPictureData } from "../packages/engine/src/sprite.js";

export const UI_SHEETS = [
  "Title/Title.gif", "Title/Back.gif", "Title/SonicTeam.gif", "Global/Display.gif", "Global/Items.gif", "Global/Items2.gif",
  "Players/Sonic.gif", "Players/Sonic1.gif", "Players/Sonic2.gif", "Players/Tails.gif", "Players/Tails1.gif", "Players/Tails2.gif",
  "Players/Knux.gif", "Players/Knux1.gif", "Players/Knux2.gif", "LevelSelect/Icons.gif",
  "Stages/GHZ/Backgrounds.gif", "Stages/GHZ/Objects.gif", "Stages/EHZ/Backgrounds.gif", "Stages/EHZ/Objects.gif",
];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

export function gifToRgba(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const f = new FileReader(data);
  const h = readGifHeader(f);
  const pixels = new Uint8Array(h.width * h.height);
  ReadGifPictureData(f, h.width, h.height, h.interlaced, pixels, 0);
  const rgba = new Uint8Array(h.width * h.height * 4);
  pixels.forEach((p, i) => {
    rgba[i * 4] = h.palette[p * 3]; rgba[i * 4 + 1] = h.palette[p * 3 + 1]; rgba[i * 4 + 2] = h.palette[p * 3 + 2];
    rgba[i * 4 + 3] = p === 0 ? 0 : 255;
  });
  return { width: h.width, height: h.height, rgba };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = path.resolve(arg("source", process.env.RSDK_DIR ?? "."));
  const out = path.resolve(arg("out", path.join("data", "ui")));
  const packs = detectRsdkPacks(source);
  for (const game of ["sonic1", "sonic2"] as const) {
    const found = findPack(packs, game);
    if (!found) { console.warn(`skipping ${game}: no pack found`); continue; }
    const pack = new Uint8Array(fs.readFileSync(found.file));
    const index = readRsdkIndex(pack);
    let count = 0;
    for (const sheet of UI_SHEETS) {
      const base = sheet.startsWith("Stages/") ? "Data/" : "Data/Sprites/";
      const entry = index.find((e) => e.key === rsdkPathKey(`${base}${sheet}`));
      if (!entry) continue;
      const { width, height, rgba } = gifToRgba(decryptRsdkFile(pack, entry));
      const file = path.join(out, game, sheet.replace(/\.gif$/i, ".png"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writePng(file, width, height, rgba);
      count++;
    }
    console.log(`${game}: wrote ${count} sheets to ${path.join(out, game)}`);
  }
}
