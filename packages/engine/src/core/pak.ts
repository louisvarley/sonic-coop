// Ring Link pack ("RLPK"): the decrypted contents of an RSDK data pack (plus the compiled-from-source scripts),
// keyed by the RSDK path key (see rsdkPathKey). Produced offline by tools/extract.ts; read by the engine on
// both server and client. Layout (little endian):
//   "RLPK" u32 version u32 count, then count x { 16-byte key, u32 offset, u32 size }, then the file data.

import { rsdkPathKey } from "./md5.js";

export const PAK_VERSION = 1;

export interface PakEntry {
  key: string;
  data: Uint8Array;
}

export function writePak(entries: PakEntry[]): Uint8Array {
  const headerSize = 12 + entries.length * 24;
  let total = headerSize;
  for (const e of entries) total += e.data.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x4c, 0x50, 0x4b]);
  dv.setUint32(4, PAK_VERSION, true);
  dv.setUint32(8, entries.length, true);
  let pos = headerSize;
  entries.forEach((e, i) => {
    const h = 12 + i * 24;
    for (let b = 0; b < 16; b++) out[h + b] = parseInt(e.key.substr(b * 2, 2), 16);
    dv.setUint32(h + 16, pos, true);
    dv.setUint32(h + 20, e.data.length, true);
    out.set(e.data, pos);
    pos += e.data.length;
  });
  return out;
}

/** A read-only virtual file system over one or more packs. Later packs override earlier ones. */
export class Vfs {
  private files = new Map<string, Uint8Array>();

  addPak(bytes: Uint8Array): void {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] !== 0x52 || bytes[1] !== 0x4c || bytes[2] !== 0x50 || bytes[3] !== 0x4b) throw new Error("not a Ring Link pack");
    const count = dv.getUint32(8, true);
    for (let i = 0; i < count; i++) {
      const h = 12 + i * 24;
      let key = "";
      for (let b = 0; b < 16; b++) key += bytes[h + b].toString(16).padStart(2, "0");
      const off = dv.getUint32(h + 16, true);
      const size = dv.getUint32(h + 20, true);
      this.files.set(key, bytes.subarray(off, off + size));
    }
  }

  addFile(path: string, data: Uint8Array): void {
    this.files.set(rsdkPathKey(path), data);
  }

  get(path: string): Uint8Array | undefined {
    return this.files.get(rsdkPathKey(path));
  }

  getByKey(key: string): Uint8Array | undefined {
    return this.files.get(key);
  }

  has(path: string): boolean {
    return this.files.has(rsdkPathKey(path));
  }

  keys(): IterableIterator<string> {
    return this.files.keys();
  }
}
