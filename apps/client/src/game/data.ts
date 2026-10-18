// Fetching a game's extracted data (served by the web container from the read-only data volume).

import { Vfs } from "@ringlink/engine";

export interface GameData {
  vfs: Vfs;
  audioIndex: Record<string, string>;
}

const cache = new Map<string, Promise<{ pak: Uint8Array; audioIndex: Record<string, string> }>>();

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
  let p = cache.get(game);
  if (!p) {
    p = (async () => {
      const manifest = await fetch(`/data/${game}/manifest.json`).then((r) => {
        if (!r.ok) throw new Error(`${game} data is not installed on this server`);
        return r.json() as Promise<{ audio: Record<string, string>; coreBytes: number }>;
      });
      const pak = await fetchWithProgress(`/data/${game}/core.pak`, (d, t) => onProgress(d / (t || manifest.coreBytes || d)));
      return { pak, audioIndex: manifest.audio };
    })();
    cache.set(game, p);
    p.catch(() => cache.delete(game));
  }
  const { pak, audioIndex } = await p;
  onProgress(1);
  const vfs = new Vfs();
  vfs.addPak(pak);
  return { vfs, audioIndex };
}
