// Identifies RSDK data packs by content, so the files can have any name.
//
//   npm run detect -- [folder]      lists every data pack in the folder and what it is, plus Sonic Origins audio packs
//
// Packs are found as loose files (*.rsdk, Android's *.rsdk.xmf) or inside mobile app packages (*.apk, *.ipa, *.xapk,
// including split APKs nested in them). Two kinds of release are understood:
//   mobile   the mobile remasters, audio included: Sonic 1/2 (2013, "RSDKvB" packs) and Sonic CD (2011, also on PC)
//   origins  Sonic Origins: RSDKv5-style packs whose signature names the engine revision; audio in CRIWARE packs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRsdkIndex, decryptRsdkFile } from "./rsdk.js";
import { RsdkV5Archive } from "./rsdkv5.js";
import { findOriginsAudioPacks } from "./origins-audio.js";
import { isZip, readZip } from "./zip.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";

export type RsdkGame = "sonic1" | "sonic2" | "sonic3" | "soniccd" | "mania" | "unknown";

export interface DetectedPack {
  /** The pack file, or "<app package>!<path inside it>". */
  file: string;
  /** Engine revision the pack is for. */
  format: "v3" | "v4" | "v5" | "unknown";
  release: "mobile" | "origins" | "unknown";
  game: RsdkGame;
  title: string;
  /** Games this project can extract. */
  supported: boolean;
  /** The pack's bytes (read from disk, or unpacked from the app package). */
  read(): Uint8Array;
}

const SUPPORTED: RsdkGame[] = ["sonic1", "sonic2", "sonic3", "soniccd"];
const CONFIG = "Data/Game/GameConfig.bin";

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** RSDKv4 GameConfig.bin starts with a length-prefixed game title. */
function v4Title(config: Uint8Array): string {
  const length = config[0] ?? 0;
  return ascii(config, 1, 1 + length).replace(/[^\x20-\x7e]/g, "").trim();
}

function classifyByConfig(config: Uint8Array): { game: RsdkGame; title: string } {
  const title = v4Title(config);
  // The title usually names the game; the stage names in the config settle titles without a number.
  const text = `${title}\n${new TextDecoder("latin1").decode(config)}`;
  if (/sonic\s*cd|palmtree/i.test(text)) return { game: "soniccd", title };
  if (/sonic[^\n]*\b(2|ii)\b/i.test(title) || /emerald\s*hill/i.test(text)) return { game: "sonic2", title };
  if (/sonic[^\n]*\b1\b/i.test(title) || /green\s*hill/i.test(text)) return { game: "sonic1", title };
  return { game: "unknown", title };
}

/** Sonic Origins' Sonic 1, 2 (RSDKv4) and CD (RSDKv3) packs: legacy game data in the RSDKv5 container. */
function classifyOriginsLegacy(pack: Uint8Array): { game: RsdkGame; title: string } {
  const archive = new RsdkV5Archive(pack);
  return archive.has(CONFIG) ? classifyByConfig(archive.read(CONFIG)) : { game: "unknown", title: "" };
}

function classifyV4(pack: Uint8Array): { game: RsdkGame; title: string } {
  const index = readRsdkIndex(pack);
  const configKey = rsdkPathKey(CONFIG);
  const entry = index.find((file) => file.key === configKey);
  if (entry) return classifyByConfig(decryptRsdkFile(pack, entry));
  const has = (name: string) => index.some((file) => file.key === rsdkPathKey(name));
  if (has("Data/Stages/GHZ/StageConfig.bin")) return { game: "sonic1", title: "" };
  if (has("Data/Stages/EHZ/StageConfig.bin")) return { game: "sonic2", title: "" };
  return { game: "unknown", title: "" };
}

/**
 * Sonic CD's 2011 packs (mobile and PC) have no signature: a header size, a directory count and directory names
 * XORed with their inverted length (RSDKv3 Reader.cpp, ParseVirtualFileSystem). Returns the names, or null.
 */
export function readRsdkV3Dirs(pack: Uint8Array): string[] | null {
  if (pack.length < 6) return null;
  const dv = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const headerSize = dv.getUint32(0, true);
  const count = dv.getUint16(4, true);
  if (!count || headerSize > pack.length) return null;
  const dirs: string[] = [];
  let pos = 6;
  for (let i = 0; i < count; i++) {
    const length = pack[pos++];
    if (!length || pos + length + 4 > headerSize) return null;
    let name = "";
    for (let j = 0; j < length; j++) name += String.fromCharCode(pack[pos + j] ^ (0xff - length));
    if (!/^Data\/[\x20-\x7e]*$/.test(name)) return null;
    dirs.push(name);
    pos += length + 4;
  }
  return dirs;
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

export function detectRsdkPack(pack: Uint8Array, file = "", read: () => Uint8Array = () => pack): DetectedPack {
  const signature = ascii(pack, 0, 6);
  let result: { game: RsdkGame; title: string } = { game: "unknown", title: "" };
  let format: DetectedPack["format"] = "unknown";
  let release: DetectedPack["release"] = "unknown";
  try {
    if (signature === "RSDKvB") {
      [format, release] = ["v4", "mobile"];
      result = classifyV4(pack);
    } else if (signature === "RSDKv4" || signature === "RSDKv3") {
      [format, release] = [signature === "RSDKv4" ? "v4" : "v3", "origins"];
      result = classifyOriginsLegacy(pack);
    } else if (signature === "RSDKv5") {
      [format, release] = ["v5", "origins"];
      result = classifyV5(pack);
    } else {
      const dirs = readRsdkV3Dirs(pack);
      if (dirs) {
        [format, release] = ["v3", "mobile"];
        if (dirs.some((d) => /^Data\/Stages\/R1[1-3][A-D]\//i.test(d))) result = { game: "soniccd", title: "Sonic CD" };
      }
    }
  } catch {
    result = { game: "unknown", title: "" };
  }
  // Sonic CD's 2011 (mobile and PC) packs use their own cipher, which extraction does not read yet.
  const supported = SUPPORTED.includes(result.game) && !(format === "v3" && release === "mobile");
  return { file, format, release, ...result, supported, read };
}

const PACK_FILE = /\.rsdk(\.xmf)?$/i;
const APP_PACKAGE = /\.(apk|ipa|xapk|apks)$/i;

/** Data packs inside an app package, looking one level into nested (split) APKs. */
function packsInApp(bytes: Uint8Array, label: string, depth = 0): DetectedPack[] {
  const out: DetectedPack[] = [];
  for (const entry of readZip(bytes)) {
    const name = entry.name.split("/").pop()!;
    if (PACK_FILE.test(name)) {
      const data = entry.read();
      out.push(detectRsdkPack(data, `${label}!${entry.name}`));
    } else if (depth === 0 && /\.apk$/i.test(name)) {
      const inner = entry.read();
      if (isZip(inner)) out.push(...packsInApp(inner, `${label}!${entry.name}`, depth + 1));
    }
  }
  return out;
}

/** Every data pack directly inside the folder or in an app package there (any name, any case), identified by content. */
export function detectRsdkPacks(dir: string): DetectedPack[] {
  if (!fs.existsSync(dir)) return [];
  const out: DetectedPack[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    if (PACK_FILE.test(entry.name)) {
      out.push(detectRsdkPack(new Uint8Array(fs.readFileSync(file)), file));
    } else if (APP_PACKAGE.test(entry.name)) {
      try {
        out.push(...packsInApp(new Uint8Array(fs.readFileSync(file)), file));
      } catch (e) {
        console.warn(`${entry.name}: could not read app package (${(e as Error).message})`);
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The pack to use for a game, or undefined when the folder does not hold one. The mobile release wins when both are present. */
export function findPack(packs: DetectedPack[], game: RsdkGame): DetectedPack | undefined {
  const candidates = packs.filter((pack) => pack.game === game && pack.supported);
  return candidates.find((pack) => pack.release === "mobile") ?? candidates[0];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? ".");
  const packs = detectRsdkPacks(dir);
  if (!packs.length) console.log(`no data packs in ${dir}`);
  for (const pack of packs) {
    const what = `${pack.release} ${pack.format}${pack.title ? `, "${pack.title}"` : ""}`;
    console.log(`${path.relative(dir, pack.file)}: ${pack.game} (${what})${pack.supported ? "" : " - not supported"}`);
  }
  for (const audio of findOriginsAudioPacks(dir)) {
    console.log(`${path.basename(audio.acb)}: Sonic Origins audio ${audio.name}${audio.awb ? ` (+ ${path.basename(audio.awb)})` : ""}`);
  }
}
