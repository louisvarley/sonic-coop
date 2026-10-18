// Reading the official RSDKv4 data packs (Data.rsdk, "RSDKvB"): file table and the per-file stream cipher.
// A port of the decompilation's Reader.cpp (CheckRSDKFile, LoadFile, GenerateELoadKeys, FileRead).

import { md5Words } from "../packages/engine/src/core/md5.js";

export interface RsdkFile {
  key: string; // 32 hex chars, as stored in the pack
  offset: number;
  size: number;
  encrypted: boolean;
}

export function readRsdkIndex(pack: Uint8Array): RsdkFile[] {
  const sig = "RSDKvB";
  for (let i = 0; i < 6; i++) if (pack[i] !== sig.charCodeAt(i)) throw new Error("not an RSDKv4 data pack");
  const dv = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const count = dv.getUint16(6, true);
  const files: RsdkFile[] = [];
  for (let f = 0; f < count; f++) {
    const o = 8 + f * 24;
    let key = "";
    for (let b = 0; b < 16; b++) key += pack[o + b].toString(16).padStart(2, "0");
    const offset = dv.getUint32(o + 16, true);
    const raw = dv.getUint32(o + 20, true);
    files.push({ key, offset, size: raw & 0x7fffffff, encrypted: (raw & 0x80000000) !== 0 });
  }
  return files;
}

function keyBytes(value: number): Uint8Array {
  const h = md5Words(String(value | 0));
  const out = new Uint8Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = (h[i] >>> (8 * (j ^ 3))) & 0xff;
  return out;
}

const ENC_KEY_1 = 0xaaaaaaab;
const ENC_KEY_2 = 0x24924925;
const mulHigh = (a: number, b: number) => Math.floor((a * b) / 0x100000000);

export function decryptRsdkFile(pack: Uint8Array, file: RsdkFile): Uint8Array {
  const src = pack.subarray(file.offset, file.offset + file.size);
  if (!file.encrypted) return src.slice();
  const vFileSize = file.size;
  const strA = keyBytes(vFileSize);
  const strB = keyBytes((vFileSize >> 1) + 1);
  let eStringNo = (vFileSize & 0x1fc) >> 2;
  let posA = 0;
  let posB = 8;
  let nybbleSwap = 0;
  const out = new Uint8Array(file.size);
  for (let i = 0; i < src.length; i++) {
    let d = (strB[posB] ^ eStringNo ^ src[i]) & 0xff;
    if (nybbleSwap) d = ((d << 4) + (d >> 4)) & 0xff;
    d ^= strA[posA];
    out[i] = d;

    posA++;
    posB++;
    if (posA <= 0x0f) {
      if (posB > 0x0c) {
        posB = 0;
        nybbleSwap ^= 1;
      }
    } else if (posB <= 0x08) {
      posA = 0;
      nybbleSwap ^= 1;
    } else {
      eStringNo = (eStringNo + 2) & 0x7f;
      const key1 = mulHigh(ENC_KEY_1, eStringNo);
      const key2 = mulHigh(ENC_KEY_2, eStringNo);
      const temp1 = key2 + Math.trunc((eStringNo - key2) / 2);
      const temp2 = Math.trunc(key1 / 8) * 3;
      if (nybbleSwap !== 0) {
        nybbleSwap = 0;
        posA = (eStringNo - Math.trunc(temp1 / 4) * 7) & 0xff;
        posB = (eStringNo - temp2 * 4 + 2) & 0xff;
      } else {
        nybbleSwap = 1;
        posB = (eStringNo - Math.trunc(temp1 / 4) * 7) & 0xff;
        posA = (eStringNo - temp2 * 4 + 3) & 0xff;
      }
    }
  }
  return out;
}
