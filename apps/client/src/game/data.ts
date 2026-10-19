// Fetching a game's extracted data (served by the web container from the read-only data volume).

import { Vfs } from "@ringlink/engine";

/** RSDK path key -> [loop start, loop end] in seconds, for audio that carries its own loop (Sonic Origins). */
export type AudioLoops = Record<string, [number, number]>;

export interface GameData {
  vfs: Vfs;
  audioIndex: Record<string, string>;
  audioLoops: AudioLoops;
}

interface CachedData {
  pak: Uint8Array;
  audioIndex: Record<string, string>;
  audioLoops: AudioLoops;
}

const cache = new Map<string, { version: string; promise: Promise<CachedData> }>();

async function fetchWithProgress(url: string, onProgress: (done: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download ${url} (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(value);
    done += value.length;
    onProgress(done, total);
  }
  const out = new Uint8Array(done);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function loadGameData(game: string, onProgress: (fraction: number) => void): Promise<GameData> {
  const manifest = await fetch(`/data/${game}/manifest.json`, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${game} data is not installed on this server`);
    return r.json() as Promise<{ audio: Record<string, string>; loops?: AudioLoops; coreBytes: number; extractedAt: string }>;
  });
  if (!manifest.extractedAt) throw new Error(`${game} manifest has no extraction version; regenerate its game data`);
  let entry = cache.get(game);
  if (!entry || entry.version !== manifest.extractedAt) {
    const promise = (async () => {
      const pak = await fetchWithProgress(`/data/${game}/core.pak?v=${encodeURIComponent(manifest.extractedAt)}`,
        (d, t) => onProgress(d / (t || manifest.coreBytes || d)));
      return { pak, audioIndex: manifest.audio, audioLoops: manifest.loops ?? {} };
    })();
    entry = { version: manifest.extractedAt, promise };
    cache.set(game, entry);
    promise.catch(() => {
      if (cache.get(game)?.promise === promise) cache.delete(game);
    });
  }
  const { pak, audioIndex, audioLoops } = await entry.promise;
  onProgress(1);
  const vfs = new Vfs();
  vfs.addPak(pak);
  return { vfs, audioIndex, audioLoops };
}
