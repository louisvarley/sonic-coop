// Capturing, restoring and delta-encoding the complete simulation state.
//
// The state is every typed array registered in Engine.state, concatenated into one byte buffer (each array's byte
// length is a multiple of 4, so the buffer can be compared as 32-bit words). Deltas list the changed runs of words
// between a baseline and the current state; consecutive frames change only a few kilobytes out of several megabytes.

import type { Engine } from "./engine.js";

/** Any engine that registers its simulation state as typed arrays (the v4 and v3 engines). */
export interface StateHolder {
  readonly state: { name: string; arr: Int32Array | Uint16Array | Uint8Array | Int8Array | Uint32Array }[];
}

export interface StateLayout {
  size: number;
  parts: { name: string; offset: number; bytes: number }[];
}

export function stateLayout(E: StateHolder): StateLayout {
  let offset = 0;
  const parts = E.state.map(({ name, arr }) => {
    const p = { name, offset, bytes: arr.byteLength };
    if (arr.byteLength % 4) throw new Error(`state array ${name} is not word aligned`);
    offset += arr.byteLength;
    return p;
  });
  return { size: offset, parts };
}

/** Copy the engine state into `out` (allocated if missing). */
export function captureState(E: StateHolder, out?: Uint8Array): Uint8Array {
  const layout = (E as unknown as { _layout?: StateLayout })._layout ?? ((E as unknown as { _layout: StateLayout })._layout = stateLayout(E));
  const buf = out ?? new Uint8Array(layout.size);
  let o = 0;
  for (const { arr } of E.state) {
    buf.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), o);
    o += arr.byteLength;
  }
  return buf;
}

export function restoreState(E: StateHolder, buf: Uint8Array): void {
  let o = 0;
  for (const { arr } of E.state) {
    new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(buf.subarray(o, o + arr.byteLength));
    o += arr.byteLength;
  }
}

/**
 * Encode the difference between two equal-sized states as a list of runs: [u32 wordOffset, u32 wordCount, words...].
 * Short gaps between changed words are absorbed into one run to keep the run count down.
 */
export function encodeDelta(base: Uint8Array, cur: Uint8Array): Uint8Array {
  const a = new Int32Array(base.buffer, base.byteOffset, base.byteLength >> 2);
  const b = new Int32Array(cur.buffer, cur.byteOffset, cur.byteLength >> 2);
  const n = b.length;
  const out: number[] = [];
  let i = 0;
  while (i < n) {
    if (a[i] === b[i]) {
      i++;
      continue;
    }
    const start = i;
    let end = i + 1;
    let gap = 0;
    for (let j = i + 1; j < n; j++) {
      if (a[j] !== b[j]) {
        end = j + 1;
        gap = 0;
      } else if (++gap > 4) break;
    }
    out.push(start, end - start);
    for (let k = start; k < end; k++) out.push(b[k]);
    i = end;
  }
  return new Uint8Array(new Int32Array(out).buffer);
}

/** Apply a delta produced by encodeDelta to `base` in place. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): void {
  const w = new Int32Array(base.buffer, base.byteOffset, base.byteLength >> 2);
  const d = new Int32Array(delta.buffer, delta.byteOffset, delta.byteLength >> 2);
  let p = 0;
  while (p < d.length) {
    const start = d[p++];
    const count = d[p++];
    w.set(d.subarray(p, p + count), start);
    p += count;
  }
}

/** A cheap 32-bit checksum of a state (used to detect prediction drift and in tests). */
export function stateHash(buf: Uint8Array): number {
  const w = new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193);
  return h >>> 0;
}

/**
 * Restore a state, first reloading the stage's static data (compiled scripts, tiles, collision, sprites) when the
 * state belongs to a different stage than the one currently loaded. Returns true if a stage load was needed.
 */
export function restoreStateWithStage(E: Engine, buf: Uint8Array, loadStage: (E: Engine) => void): boolean {
  restoreState(E, buf);
  const stage = E.stageList[E.activeStageList]?.[E.stageListPosition];
  // stageMode 0 means the state is about to load a stage itself; nothing to prepare
  if (!stage || E.stageMode === 0 || (stage.folder === E.currentStageFolder && E.loadedActKey === actKey(E))) return false;
  loadStage(E);
  restoreState(E, buf);
  return true;
}

export function actKey(E: Engine): string {
  return `${E.activeStageList}:${E.stageListPosition}`;
}
