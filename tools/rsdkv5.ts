// RSDKv5 archives keep hashed paths in the index; encrypted entries also need their original path.
// Format reference: https://github.com/RSDKModding/RSDKv5-Decompilation/blob/master/RSDKv5/RSDK/Core/Reader.cpp

import { md5Words, rsdkPathKey } from "../packages/engine/src/core/md5.js";
import type { RsdkFile } from "./rsdk.js";

export function readRsdkV5Index(pack: Uint8Array): RsdkFile[] {
  if (pack.length < 8) throw new Error("truncated RSDKv5 header");
  if (String.fromCharCode(...pack.subarray(0, 6)) !== "RSDKv5") throw new Error("not an RSDKv5 data pack");
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const count = view.getUint16(6, true);
  const dataStart = 8 + count * 24;
  if (dataStart > pack.length) throw new Error("truncated RSDKv5 file table");
  const files: RsdkFile[] = [];
  const keys = new Set<string>();
  for (let i = 0; i < count; i++) {
    const entry = 8 + i * 24;
    const key = Array.from(pack.subarray(entry, entry + 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const offset = view.getUint32(entry + 16, true);
    const rawSize = view.getUint32(entry + 20, true);
    const size = rawSize & 0x7fffffff;
    if (offset < dataStart || offset > pack.length || size > pack.length - offset) {
      throw new Error(`RSDKv5 entry ${i} is outside the archive data`);
    }
    if (keys.has(key)) throw new Error(`duplicate RSDKv5 path hash: ${key}`);
    keys.add(key);
    files.push({ key, offset, size, encrypted: (rawSize & 0x80000000) !== 0 });
  }
  return files;
}

function loadKey(text: string): Uint8Array {
  const words = md5Words(text);
  return Uint8Array.from({ length: 16 }, (_, i) => (words[i >> 2] >>> (8 * (3 - (i & 3)))) & 0xff);
}

export class RsdkV5Archive {
  readonly files: readonly Readonly<RsdkFile>[];
  private byKey: Map<string, Readonly<RsdkFile>>;

  constructor(private pack: Uint8Array) {
    this.files = readRsdkV5Index(pack);
    this.byKey = new Map(this.files.map((file) => [file.key, file]));
  }

  has(path: string): boolean {
    return this.byKey.has(rsdkPathKey(path.replace(/\\/g, "/")));
  }

  /** Read by original asset path; index hashes alone cannot recover encrypted file contents. */
  read(path: string): Uint8Array {
    const normalized = path.replace(/\\/g, "/");
    const file = this.byKey.get(rsdkPathKey(normalized));
    if (!file) throw new Error(`RSDKv5 asset not found: ${path}`);
    const data = Uint8Array.from(this.pack.subarray(file.offset, file.offset + file.size));
    if (!file.encrypted) return data;
    const keyA = loadKey(normalized.toUpperCase());
    const keyB = loadKey(String(file.size));
    let a = 0, b = 8, number = (file.size >>> 2) & 0x7f;
    let swap = false;
    for (let i = 0; i < data.length; i++) {
      const value = data[i] ^ keyB[b] ^ number;
      data[i] = (swap ? ((value << 4) | (value >>> 4)) & 0xff : value) ^ keyA[a];
      a++;
      b++;
      if (a < 16) {
        if (b > 12) {
          b = 0;
          swap = !swap;
        }
      } else if (b <= 8) {
        a = 0;
        swap = !swap;
      } else {
        number = (number + 2) & 0x7f;
        if (swap) {
          a = number % 7;
          b = number % 12 + 2;
        } else {
          a = number % 12 + 3;
          b = number % 7;
        }
        swap = !swap;
      }
    }
    return data;
  }
}
