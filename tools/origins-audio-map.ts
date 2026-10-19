// Regenerates games/origins-audio.json from the RSDK Modding wiki's Sonic Origins audio tables:
//
//   npx tsx tools/origins-audio-map.ts [Audio.md]     (default: fetched from the wiki's GitHub repository)
//
// Sonic Origins plays audio through CRIWARE instead of the Retro Engine; its parameters map each RSDK file name
// (what the scripts ask for) to a cue in an ACB/AWB pack. The JSON keeps, per pack, its keycode and the RSDK file
// names of each cue. It is keyed by cue name, not by the wiki's wave ids: the packs themselves resolve cues to waves,
// and the wiki's ids are not always right (Sonic 1 SFX lists id 62 twice, shifting every id after it).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://github.com/RSDKModding/RSDK-Modding-Wiki/raw/master/docs/Games/SonicOrigins/Documentation/Audio.md";

export interface OriginsAudioName {
  /** RSDK file name: .ogg under Data/Music/, .wav under Data/SoundFX/. */
  name: string;
  /** Playback speed for the variants the game derives from one wave (Speed Shoes, Special Stage speed-ups). */
  speed?: number;
}
export interface OriginsAudioPack {
  keycode: string;
  /** Cue name -> RSDK file names. */
  cues: Record<string, OriginsAudioName[]>;
}
export type OriginsAudioMap = Record<string, OriginsAudioPack>;

/** The entries of a cell (one per <br>), keeping blanks so that cue and file name lists can be paired up. */
const cell = (text: string) => text.split("<br>").map((s) => s.replace(/\[\^\d+\]/g, "").trim());

function rows(lines: string[], start: number): string[][] {
  const out: string[][] = [];
  let i = start;
  while (i < lines.length && !lines[i].startsWith("|")) i++;
  for (i += 2; i < lines.length && lines[i].startsWith("|"); i++) out.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
  return out;
}

export function parseOriginsAudio(md: string): OriginsAudioMap {
  const lines = md.split(/\r?\n/);
  const map: OriginsAudioMap = {};
  const keycodes = new Map<string, string>();
  let pack: OriginsAudioPack | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "## Keycodes") {
      for (const [packs, keycode] of rows(lines, i + 1)) for (const p of packs.split("/")) keycodes.set(p.replace(/\.(acb|awb)$/, ""), keycode);
      continue;
    }
    const section = /^## .*\((\w+)\.(?:acb|awb)\)/.exec(line);
    if (section) {
      const keycode = keycodes.get(section[1]);
      if (!keycode) throw new Error(`no keycode for ${section[1]}`);
      pack = map[section[1]] = { keycode, cues: {} };
      for (const [id, cueCell, nameCell] of rows(lines, i + 1)) {
        if (!/^\d+$/.test(id)) continue;
        const cues = cell(cueCell), names = cell(nameCell);
        // Lists of the same length pair up ("S001_S33_Ring<br>S001_S34_Ring" / "<br>Global/Ring.wav");
        // otherwise every cue of the row stands for every name.
        cues.forEach((cue, c) => {
          if (!cue) return;
          const own = cues.length === names.length ? [names[c]] : names;
          for (const name of own.filter(Boolean)) {
            const list = (pack!.cues[cue] ??= []);
            if (!list.some((n) => n.name === name)) list.push({ name });
          }
        });
      }
      continue;
    }
    if (!pack || !line.startsWith("### ")) continue;
    if (/Unused/.test(line)) continue;
    // Variants of an existing wave, named by cue: "Fast Music" (1.2x) and "Special Stage Speed-Up Music".
    const fast = /Fast Music/.test(line);
    const header = lines.slice(i + 1).find((l) => l.startsWith("|"))!;
    const hasSpeed = /Speed \|/.test(header);
    if (!fast && !hasSpeed) continue;
    for (const cells of rows(lines, i + 1)) {
      const [cue, names] = cells;
      const speed = hasSpeed ? parseFloat(cells[2]) : 1.2;
      (pack.cues[cue] ??= []).push(...cell(names).filter(Boolean).map((name) => ({ name, speed })));
    }
  }
  return map;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const md = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
  const map = parseOriginsAudio(md);
  const out = path.join(root, "games", "origins-audio.json");
  fs.writeFileSync(out, JSON.stringify({ source: SOURCE, packs: map }, null, 1) + "\n");
  for (const [name, pack] of Object.entries(map)) console.log(`${name}: ${Object.keys(pack.cues).length} cues named`);
}
