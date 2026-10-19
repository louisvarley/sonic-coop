// Minimal ZIP reading, enough to take data packs straight out of mobile app packages (.apk, .ipa, .xapk).

import zlib from "node:zlib";

export interface ZipEntry {
  name: string;
  read(): Uint8Array;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 0x10000 - 22); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  if (pos === 0xffffffff) throw new Error("zip64 archives are not supported");
  const entries: ZipEntry[] = [];
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = dv.getUint16(pos + 10, true);
    const compressed = dv.getUint32(pos + 20, true);
    const nameLength = dv.getUint16(pos + 28, true);
    const extraLength = dv.getUint16(pos + 30, true);
    const commentLength = dv.getUint16(pos + 32, true);
    const local = dv.getUint32(pos + 42, true);
    const name = td.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    entries.push({
      name,
      read() {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + compressed);
        if (method === 0) return data.slice();
        if (method === 8) return new Uint8Array(zlib.inflateRawSync(data));
        throw new Error(`${name}: unsupported zip compression method ${method}`);
      },
    });
  }
  return entries;
}
