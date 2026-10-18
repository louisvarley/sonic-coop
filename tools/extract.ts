// Offline asset extraction. Run once (and again whenever a game's script patches change):
//
//   npm run extract -- [--source ../sonic] [--out data]
//
// For each game it reads the user's own <game>-Data.rsdk from the read-only source folder, decrypts it, and writes:
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
import { writePak, type PakEntry } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { applyPatches, type ScriptPatch } from "./patch.js";

const SCRIPTS_REPO = "https://github.com/RSDKModding/RSDKv4-Script-Decompilation";
export const SCRIPTS_COMMIT = "67156e451d22e2f148ef9f2c91517dfa5103333a";

const GAMES = [
  { id: "sonic1", pack: "sonic1-Data.rsdk", scriptsDir: "Sonic 1/Scripts" },
  { id: "sonic2", pack: "sonic2-Data.rsdk", scriptsDir: "Sonic 2/Scripts" },
] as const;

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, arg("source", "../sonic"));
const out = path.resolve(root, arg("out", "data"));

function fetchScripts(): string {
  const dir = path.join(out, "cache", "scripts-decomp");
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    console.log(`fetching script decompilation (${SCRIPTS_COMMIT.slice(0, 8)})`);
    execFileSync("git", ["clone", "--quiet", SCRIPTS_REPO, dir], { stdio: "inherit" });
  }
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  if (head !== SCRIPTS_COMMIT) {
    execFileSync("git", ["-C", dir, "fetch", "--quiet", "origin"], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "checkout", "--quiet", SCRIPTS_COMMIT], { stdio: "inherit" });
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
  const scriptsRoot = fetchScripts();
  for (const game of GAMES) {
    const packPath = path.join(source, game.pack);
    if (!fs.existsSync(packPath)) {
      console.warn(`skipping ${game.id}: ${packPath} not found`);
      continue;
    }
    const pack = new Uint8Array(fs.readFileSync(packPath));
    const index = readRsdkIndex(pack);
    const gameOut = path.join(out, game.id);
    fs.rmSync(gameOut, { recursive: true, force: true });
    fs.mkdirSync(path.join(gameOut, "audio"), { recursive: true });

    const entries: PakEntry[] = [];
    const audio: Record<string, string> = {};
    const stats = { core: 0, audio: 0, skipped: 0 };
    for (const f of index) {
      const data = decryptRsdkFile(pack, f);
      const kind = kindOf(data);
      if (kind === "ogg" || kind === "wav") {
        fs.writeFileSync(path.join(gameOut, "audio", `${f.key}.${kind}`), data);
        audio[f.key] = kind;
        stats.audio += data.length;
      } else if (kind === "png") {
        stats.skipped += data.length; // HD menu textures of the mobile front end: not used
      } else {
        entries.push({ key: f.key, data });
        stats.core += data.length;
      }
    }

    // Script sources, with this project's patches applied.
    const patchUrl = pathToFileURL(path.join(root, "games", game.id, "patches.ts")).href;
    const { patches } = (await import(patchUrl)) as { patches: ScriptPatch[] };
    const scriptDir = path.join(scriptsRoot, game.scriptsDir);
    const sources = new Map<string, string>();
    for (const rel of walk(scriptDir)) {
      if (!rel.toLowerCase().endsWith(".txt")) continue;
      sources.set(rel, fs.readFileSync(path.join(scriptDir, rel), "latin1"));
    }
    const overrideDir = path.join(root, "games", game.id, "scripts");
    if (fs.existsSync(overrideDir)) for (const rel of walk(overrideDir)) sources.set(rel, fs.readFileSync(path.join(overrideDir, rel), "latin1"));
    applyPatches(sources, patches);
    let scriptBytes = 0;
    for (const [rel, text] of sources) {
      const data = Buffer.from(text, "latin1");
      entries.push({ key: rsdkPathKey(`Data/Scripts/${rel}`), data: new Uint8Array(data) });
      scriptBytes += data.length;
    }

    fs.writeFileSync(path.join(gameOut, "core.pak"), writePak(entries));
    const manifest = {
      game: game.id,
      source: game.pack,
      files: index.length,
      coreBytes: stats.core + scriptBytes,
      audioBytes: stats.audio,
      scripts: { repo: SCRIPTS_REPO, commit: SCRIPTS_COMMIT, count: sources.size, patches: patches.length },
      audio,
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
