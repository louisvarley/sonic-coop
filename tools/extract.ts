// Offline asset extraction. Run once (and again whenever a game's script patches change):
//
//   npm run extract -- [--source <folder>] [--out data]     (source defaults to $RSDK_DIR, else the current folder)
//
// Every *.rsdk in the source folder is identified by its contents (see rsdk-detect.ts), whatever it is called.
// Either release works: the 2013 mobile remasters (audio inside the pack) or Sonic Origins (audio from the CRIWARE
// .acb/.awb packs next to the .rsdk files, decoded with ffmpeg). The mobile pack is used when both are present.
// For each supported game it decrypts the user's own pack and writes:
//   data/<game>/core.pak        everything the simulation and renderer need (stages, sprites, animations, scripts)
//   data/<game>/audio/<key>.*   music and sound effects, fetched lazily by the browser
//   data/<game>/manifest.json   what was extracted and from where
// Scripts are compiled at run time from the community script decompilation (fetched into data/cache at a pinned
// commit) with this project's co-op patches applied (games/<game>/patches.ts).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readRsdkIndex, decryptRsdkFile } from "./rsdk.js";
import { RsdkV5Archive } from "./rsdkv5.js";
import { discoverPaths } from "./rsdk-paths.js";
import { extractOriginsAudio, findOriginsAudioPacks, hasFfmpeg } from "./origins-audio.js";
import { writePak, type PakEntry } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { applyPatches, type ScriptPatch } from "./patch.js";
import { detectRsdkPacks, findPack } from "./rsdk-detect.js";

/** The community script decompilations, pinned. */
const SCRIPT_SOURCES = {
  v4: { repo: "https://github.com/RSDKModding/RSDKv4-Script-Decompilation", commit: "67156e451d22e2f148ef9f2c91517dfa5103333a", cache: "scripts-decomp" },
  v3: { repo: "https://github.com/RSDKModding/RSDKv3-Script-Decompilation", commit: "dad641a31637d0545ac9c4f3e95707bb5e671961", cache: "scripts-decomp-v3" },
} as const;

const GAMES = [
  { id: "sonic1", scripts: SCRIPT_SOURCES.v4, scriptsDir: "Sonic 1/Scripts" },
  { id: "sonic2", scripts: SCRIPT_SOURCES.v4, scriptsDir: "Sonic 2/Scripts" },
  { id: "soniccd", scripts: SCRIPT_SOURCES.v3, scriptsDir: "Scripts" },
] as const;

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, arg("source", process.env.RSDK_DIR ?? "."));
const out = path.resolve(root, arg("out", "data"));

function fetchScripts(src: (typeof SCRIPT_SOURCES)[keyof typeof SCRIPT_SOURCES]): string {
  const dir = path.join(out, "cache", src.cache);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    console.log(`fetching script decompilation ${path.basename(src.repo)} (${src.commit.slice(0, 8)})`);
    execFileSync("git", ["clone", "--quiet", src.repo, dir], { stdio: "inherit" });
  }
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  if (head !== src.commit) {
    execFileSync("git", ["-C", dir, "fetch", "--quiet", "origin"], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "checkout", "--quiet", src.commit], { stdio: "inherit" });
  }
  return dir;
}

function walk(dir: string, base = dir): string[] {
  const res: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...walk(p, base));
    else res.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return res;
}

function kindOf(d: Uint8Array): "ogg" | "wav" | "png" | "other" {
  const m = String.fromCharCode(d[0], d[1], d[2], d[3]);
  if (m === "OggS") return "ogg";
  if (m === "RIFF") return "wav";
  if (m === "\x89PNG") return "png";
  return "other";
}

async function main() {
  const detected = detectRsdkPacks(source);
  for (const pack of detected) console.log(`found ${path.relative(source, pack.file)}: ${pack.game} (${pack.release} ${pack.format})`);
  const only = arg("game", "");
  for (const game of GAMES) {
    if (only && game.id !== only) continue;
    const found = findPack(detected, game.id);
    if (!found) {
      console.warn(`skipping ${game.id}: no ${game.id} .rsdk file found in ${source}`);
      continue;
    }
    const packPath = found.file;
    const pack = found.read();
    const gameOut = path.join(out, game.id);
    fs.rmSync(gameOut, { recursive: true, force: true });
    fs.mkdirSync(path.join(gameOut, "audio"), { recursive: true });

    // Script sources, with this project's patches applied.
    const patchUrl = pathToFileURL(path.join(root, "games", game.id, "patches.ts")).href;
    const { patches } = (await import(patchUrl)) as { patches: ScriptPatch[] };
    const scriptDir = path.join(fetchScripts(game.scripts), game.scriptsDir);
    const sources = new Map<string, string>();
    for (const rel of walk(scriptDir)) {
      if (!rel.toLowerCase().endsWith(".txt")) continue;
      sources.set(rel, fs.readFileSync(path.join(scriptDir, rel), "latin1"));
    }
    const overrideDir = path.join(root, "games", game.id, "scripts");
    if (fs.existsSync(overrideDir)) for (const rel of walk(overrideDir)) sources.set(rel, fs.readFileSync(path.join(overrideDir, rel), "latin1"));
    applyPatches(sources, patches);

    // The pack's files as (path key, contents). Origins packs can only be decrypted by path, so their paths are
    // recovered from the game's own references first; files nothing refers to are never loaded by the engine.
    let files: { key: string; data: Uint8Array }[];
    let fileCount: number;
    if (found.release === "origins") {
      const archive = new RsdkV5Archive(pack);
      const keys = new Set(archive.files.map((f) => f.key));
      const paths = discoverPaths({ has: (k) => keys.has(k), read: (p) => archive.read(p) }, sources.values());
      files = [...paths].filter(([, p]) => !p.startsWith("Data/Scripts/")).map(([key, p]) => ({ key, data: archive.read(p) }));
      fileCount = archive.files.length;
      console.log(`${game.id}: ${paths.size} of ${archive.files.length} Origins files are referenced by the game`);
    } else {
      const index = readRsdkIndex(pack);
      files = index.map((f) => ({ key: f.key, data: decryptRsdkFile(pack, f) }));
      fileCount = index.length;
    }

    const entries: PakEntry[] = [];
    const audio: Record<string, string> = {};
    let loops: Record<string, [number, number]> = {};
    const stats = { core: 0, audio: 0, skipped: 0 };
    for (const f of files) {
      const kind = kindOf(f.data);
      if (kind === "ogg" || kind === "wav") {
        fs.writeFileSync(path.join(gameOut, "audio", `${f.key}.${kind}`), f.data);
        audio[f.key] = kind;
        stats.audio += f.data.length;
      } else if (kind === "png") {
        stats.skipped += f.data.length; // HD menu textures of the mobile front end: not used
      } else {
        entries.push({ key: f.key, data: f.data });
        stats.core += f.data.length;
      }
    }

    let audioSource = Object.keys(audio).length ? path.basename(packPath) : "none";
    if (!Object.keys(audio).length) {
      const audioPacks = findOriginsAudioPacks(source);
      if (!audioPacks.length) console.warn(`${game.id}: no audio (put the Sonic Origins .acb/.awb files next to the .rsdk files)`);
      else if (!hasFfmpeg()) console.warn(`${game.id}: no audio (ffmpeg is needed to decode the Sonic Origins audio packs)`);
      else {
        const result = await extractOriginsAudio(game.id, audioPacks, path.join(gameOut, "audio"));
        for (const w of result.warnings) console.warn(`${game.id}: ${w}`);
        Object.assign(audio, result.audio);
        loops = result.loops;
        stats.audio += result.bytes;
        audioSource = result.packs.join(", ") || "none";
        if (!result.packs.length) console.warn(`${game.id}: no audio (none of this game's Sonic Origins audio packs were found)`);
      }
    }
    let scriptBytes = 0;
    for (const [rel, text] of sources) {
      const data = Buffer.from(text, "latin1");
      entries.push({ key: rsdkPathKey(`Data/Scripts/${rel}`), data: new Uint8Array(data) });
      scriptBytes += data.length;
    }

    fs.writeFileSync(path.join(gameOut, "core.pak"), writePak(entries));
    const manifest = {
      game: game.id,
      source: path.basename(packPath),
      release: found.release,
      files: fileCount,
      coreBytes: stats.core + scriptBytes,
      audioBytes: stats.audio,
      scripts: { repo: game.scripts.repo, commit: game.scripts.commit, count: sources.size, patches: patches.length },
      audioSource,
      audio,
      loops,
      extractedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(gameOut, "manifest.json"), JSON.stringify(manifest, null, 1));
    console.log(
      `${game.id}: ${entries.length} core files (${(manifest.coreBytes / 1e6).toFixed(1)} MB), ` +
        `${Object.keys(audio).length} audio (${(stats.audio / 1e6).toFixed(1)} MB), ${sources.size} scripts, ${patches.length} patches`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
