// Recovering file paths for data packs whose index only stores path hashes.
//
// Sonic Origins packs encrypt every file with a key derived from its path, so a file can only be read once its
// path is known. Paths are discovered the way the engine would reach them: from GameConfig and StageConfig (stage
// folders, sprite sheets, palettes), animation files (sprite sheets) and the script sources (every string literal),
// repeating until no new file turns up.

import { rsdkPathKey } from "../packages/engine/src/core/md5.js";

const STAGE_FILES = ["StageConfig.bin", "Backgrounds.bin", "128x128Tiles.bin", "CollisionMasks.bin", "16x16Tiles.gif"];
const PREFIXES = ["", "Data/", "Data/Game/", "Data/Sprites/", "Data/Animations/", "Data/Palettes/", "Data/Scripts/"];
const READABLE = /\.(bin|ani|txt|cfg|xml)$/i;

/**
 * Printable runs in a binary file. Length-prefixed strings can run into a printable length byte on either side
 * ("Players/Sonic3.gif'" in an .ani file), so file names inside a run are also taken on their own.
 */
function strings(data: Uint8Array): string[] {
  const out: string[] = [];
  const text = new TextDecoder("latin1").decode(data);
  for (const m of text.matchAll(/[\x20-\x7e]{2,}/g)) {
    out.push(m[0], m[0].slice(1));
    for (const f of m[0].matchAll(/[A-Za-z0-9_ /-]+\.[A-Za-z0-9]{3}/g)) out.push(f[0], f[0].slice(1));
  }
  return out;
}

export interface PathSource {
  has(key: string): boolean;
  read(path: string): Uint8Array;
}

/** Every path in the pack that can be reached from GameConfig and the given script sources, keyed by path hash. */
export function discoverPaths(pack: PathSource, scriptSources: Iterable<string>): Map<string, string> {
  const found = new Map<string, string>();
  const tokens = new Set<string>();
  const queue: string[] = [];
  const tried = new Set<string>();

  const tryPath = (path: string) => {
    path = path.replace(/\\/g, "/");
    if (tried.has(path)) return;
    tried.add(path);
    const key = rsdkPathKey(path);
    if (!pack.has(key) || found.has(key)) return;
    found.set(key, path);
    if (READABLE.test(path)) queue.push(path);
  };
  const addToken = (raw: string) => {
    const token = raw.trim().replace(/\\/g, "/");
    if (!token || tokens.has(token)) return;
    tokens.add(token);
    if (token.includes(".")) for (const prefix of PREFIXES) tryPath(prefix + token);
    if (!token.includes(".") && token.length <= 64) {
      for (const file of STAGE_FILES) tryPath(`Data/Stages/${token}/${file}`);
      for (let act = 1; act <= 9; act++) tryPath(`Data/Stages/${token}/Act${act}.bin`);
    }
  };

  for (const source of scriptSources) for (const m of source.matchAll(/"([^"\r\n]{2,})"/g)) addToken(m[1]);
  // Files the engines open by name themselves.
  tryPath("Data/Game/GameConfig.bin");
  tryPath("Data/Palettes/MasterPalette.act");
  while (queue.length) {
    const path = queue.shift()!;
    for (const s of strings(pack.read(path))) addToken(s);
    // Stage folders: acts can have ids beyond 1-9 (named after short tokens such as "B").
    const stage = /^Data\/Stages\/([^/]+)\/StageConfig\.bin$/.exec(path);
    if (stage) for (const t of [...tokens]) if (t.length <= 3) tryPath(`Data/Stages/${stage[1]}/Act${t}.bin`);
  }
  // Act ids listed in GameConfig (short tokens) for every stage folder found.
  const folders = new Set([...found.values()].map((p) => /^Data\/Stages\/([^/]+)\//.exec(p)?.[1]).filter(Boolean) as string[]);
  for (const folder of folders) for (const t of tokens) if (t.length <= 3) tryPath(`Data/Stages/${folder}/Act${t}.bin`);
  return found;
}
