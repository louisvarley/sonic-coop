// Identifies RSDK data packs by content, so the files can have any name.
//
//   npm run detect -- [folder]      lists every *.rsdk in the folder and what it is
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRsdkIndex, decryptRsdkFile } from "./rsdk.js";
import { RsdkV5Archive } from "./rsdkv5.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";

export type RsdkGame = "sonic1" | "sonic2" | "sonic3" | "soniccd" | "mania" | "unknown";

export interface DetectedPack {
  file: string;
  format: "v4" | "v5" | "unknown";
  game: RsdkGame;
  title: string;
  /** Games this project can extract. */
  supported: boolean;
}

const SUPPORTED: RsdkGame[] = ["sonic1", "sonic2", "sonic3"];
const CONFIG = "Data/Game/GameConfig.bin";

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** RSDKv4 GameConfig.bin starts with a length-prefixed game title. */
function v4Title(config: Uint8Array): string {
  const length = config[0] ?? 0;
  return ascii(config, 1, 1 + length).replace(/[^\x20-\x7e]/g, "").trim();
}

function classifyV4(pack: Uint8Array): { game: RsdkGame; title: string } {
  const index = readRsdkIndex(pack);
  const configKey = rsdkPathKey(CONFIG);
  const entry = index.find((file) => file.key === configKey);
  if (entry) {
    const config = decryptRsdkFile(pack, entry);
    const title = v4Title(config);
    // The title usually names the game; the stage names in the config settle titles without a number.
    const text = `${title}\n${new TextDecoder("latin1").decode(config)}`;
    if (/sonic\s*cd|palmtree/i.test(text)) return { game: "soniccd", title };
    if (/sonic[^\n]*\b(2|ii)\b/i.test(title) || /emerald\s*hill/i.test(text)) return { game: "sonic2", title };
    if (/sonic[^\n]*\b1\b/i.test(title) || /green\s*hill/i.test(text)) return { game: "sonic1", title };
    return { game: "unknown", title };
  }
  const has = (name: string) => index.some((file) => file.key === rsdkPathKey(name));
  if (has("Data/Stages/GHZ/StageConfig.bin")) return { game: "sonic1", title: "" };
  if (has("Data/Stages/EHZ/StageConfig.bin")) return { game: "sonic2", title: "" };
  return { game: "unknown", title: "" };
}

function classifyV5(pack: Uint8Array): { game: RsdkGame; title: string } {
  const archive = new RsdkV5Archive(pack);
  let title = "";
  try {
    const config = archive.read(CONFIG);
    // title is the first length-prefixed string after the "CFG\0" signature
    title = ascii(config, 5, 5 + (config[4] & 0x7f)).replace(/[^\x20-\x7e]/g, "").trim();
  } catch {
    /* no readable game configuration */
  }
  if (archive.has("Data/Stages/3K_AIZ1/Scene1.bin")) return { game: "sonic3", title };
  if (/mania/i.test(title) || archive.has("Data/Stages/GHZ/Scene1.bin")) return { game: "mania", title };
  return { game: "unknown", title };
}

export function detectRsdkPack(pack: Uint8Array, file = ""): DetectedPack {
  const signature = ascii(pack, 0, 6);
  let result: { game: RsdkGame; title: string } = { game: "unknown", title: "" };
  let format: DetectedPack["format"] = "unknown";
  try {
    if (signature === "RSDKvB") {
      format = "v4";
      result = classifyV4(pack);
    } else if (signature === "RSDKv5") {
      format = "v5";
      result = classifyV5(pack);
    }
  } catch {
    result = { game: "unknown", title: "" };
  }
  return { file, format, ...result, supported: SUPPORTED.includes(result.game) };
}

/** Every *.rsdk directly inside the folder (any name, any case), identified by content. */
export function detectRsdkPacks(dir: string): DetectedPack[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".rsdk"))
    .map((entry) => detectRsdkPack(new Uint8Array(fs.readFileSync(path.join(dir, entry.name))), path.join(dir, entry.name)))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** The first supported pack for a game, or undefined when the folder does not hold it. */
export function findPack(packs: DetectedPack[], game: RsdkGame): DetectedPack | undefined {
  return packs.find((pack) => pack.game === game);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? ".");
  const packs = detectRsdkPacks(dir);
  if (!packs.length) console.log(`no .rsdk files in ${dir}`);
  for (const pack of packs) {
    console.log(`${path.basename(pack.file)}: ${pack.game} (${pack.format}${pack.title ? `, "${pack.title}"` : ""})${pack.supported ? "" : " - not supported"}`);
  }
}
