// Sonic Origins audio: finds the user's CRIWARE packs (any file name; identified by the name stored in the ACB),
// decrypts their HCA waves and encodes them with ffmpeg to Ogg Vorbis under the RSDK file names the scripts use.
// Each output is stored by its RSDK path key, like the audio of a mobile data pack, together with the wave's own
// loop points: Origins' arrangements differ from the mobile ones, so the scripts' loop points do not fit them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readAcb, readAfs2, decryptHca, type Afs2 } from "./criware.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import type { OriginsAudioMap } from "./origins-audio-map.js";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Which packs each game plays from, in priority order. Sonic 2 shares Sonic 1's jingles (1-Up, drowning, emerald). */
export const ORIGINS_AUDIO_PACKS: Record<string, string[]> = {
  sonic1: ["STH1_music", "STH1_sfx", "HITE_sfx"],
  sonic2: ["STH2_music", "STH2_sfx", "STH1_music", "HITE_sfx"],
  soniccd: ["SCD_music", "SCD_sfx", "HITE_sfx"],
  sonic3: ["Music03_S3K", "STH3_sfx"],
};

export interface FoundAudioPack {
  name: string;
  acb: string;
  awb: string | null;
}

export function loadOriginsAudioMap(): OriginsAudioMap {
  return JSON.parse(fs.readFileSync(path.join(root, "games", "origins-audio.json"), "utf8")).packs;
}

/** Every ACB in the folder, named by the cue sheet name inside it, with the .awb of the same base name if present. */
export function findOriginsAudioPacks(dir: string): FoundAudioPack[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const out: FoundAudioPack[] = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".acb")) continue;
    const acb = path.join(dir, file);
    let name: string;
    try {
      name = readAcb(new Uint8Array(fs.readFileSync(acb))).name;
    } catch {
      continue;
    }
    const base = file.slice(0, -4).toLowerCase();
    const awb = files.find((f) => f.toLowerCase() === `${base}.awb`);
    out.push({ name, acb, awb: awb ? path.join(dir, awb) : null });
  }
  return out;
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export interface OriginsAudioResult {
  /** RSDK path key -> file extension, merged into the manifest's audio index. */
  audio: Record<string, string>;
  /** RSDK path key -> [loop start, loop end] in seconds. */
  loops: Record<string, [number, number]>;
  bytes: number;
  packs: string[];
  warnings: string[];
}

/** Extracts every RSDK-named wave of the game's packs into `outDir` (data/<game>/audio). */
export async function extractOriginsAudio(game: string, found: FoundAudioPack[], outDir: string): Promise<OriginsAudioResult> {
  const result: OriginsAudioResult = { audio: {}, loops: {}, bytes: 0, packs: [], warnings: [] };
  const map = loadOriginsAudioMap();
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringlink-audio-"));
  const jobs: { hca: Uint8Array; key: string; path: string; speed: number; loop: { start: number; end: number } | null; rate: number }[] = [];
  try {
    for (const name of ORIGINS_AUDIO_PACKS[game] ?? []) {
      const pack = found.find((p) => p.name === name);
      const info = map[name];
      if (!pack || !info) continue;
      const acb = readAcb(new Uint8Array(fs.readFileSync(pack.acb)));
      const streamed = acb.waves.some((w) => w.streaming);
      let bank: Afs2 | null = acb.memory;
      if (streamed) {
        if (!pack.awb) {
          result.warnings.push(`${name}: ${path.basename(pack.acb)} needs its .awb next to it`);
          continue;
        }
        bank = readAfs2(new Uint8Array(fs.readFileSync(pack.awb)));
      }
      if (!bank) continue;
      result.packs.push(name);
      const keycode = BigInt(info.keycode);
      const waves = new Map(bank.entries.map((e) => [e.id, e.data]));
      for (const wave of acb.waves) {
        const data = waves.get(wave.id);
        const names = wave.cues.flatMap((cue) => info.cues[cue] ?? []);
        if (!data || !names.length) continue;
        const { hca, info: hcaInfo } = decryptHca(data, keycode);
        for (const n of names) {
          const rsdk = n.name.toLowerCase().endsWith(".wav") ? `Data/SoundFX/${n.name}` : `Data/Music/${n.name}`;
          const key = rsdkPathKey(rsdk);
          if (jobs.some((j) => j.key === key)) continue; // an earlier pack (or cue) already provides it
          jobs.push({ hca, key, path: rsdk, speed: n.speed ?? 1, loop: hcaInfo.loop, rate: hcaInfo.sampleRate });
        }
      }
    }
    fs.mkdirSync(outDir, { recursive: true });
    await pool(jobs, Math.max(1, os.cpus().length), async (job) => {
      const input = path.join(tmp, `${job.key}.hca`);
      const output = path.join(outDir, `${job.key}.ogg`);
      fs.writeFileSync(input, job.hca);
      const filters = job.speed !== 1 ? ["-af", `atempo=${job.speed}`] : [];
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, ...filters, "-c:a", "libvorbis", "-q:a", "5", output]);
      fs.rmSync(input);
      result.audio[job.key] = "ogg";
      result.bytes += fs.statSync(output).size;
      if (job.loop) result.loops[job.key] = [job.loop.start / job.rate / job.speed, job.loop.end / job.rate / job.speed];
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return result;
}
