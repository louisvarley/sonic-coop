// Small MD5 used to look files up in an RSDK data pack (file names are stored as MD5 hashes of the lower-cased path).
// The browser has no MD5 in WebCrypto, so this is implemented here and shared by the tools, server and client.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;

/** MD5 digest of a byte array, 16 bytes. */
export function md5(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padded = ((len + 8) >> 6) * 64 + 64;
  const buf = new Uint8Array(padded);
  buf.set(data);
  buf[len] = 0x80;
  const bits = len * 8;
  buf[padded - 8] = bits & 0xff;
  buf[padded - 7] = (bits >>> 8) & 0xff;
  buf[padded - 6] = (bits >>> 16) & 0xff;
  buf[padded - 5] = (bits >>> 24) & 0xff;

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const m = new Int32Array(16);
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      m[i] = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24);
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + m[g]) | 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = (words[i] >>> (8 * j)) & 0xff;
  return out;
}

const encoder = new TextEncoder();

/**
 * The key RSDK uses for a file: MD5 of the lower-cased path, with each 32-bit word byte-swapped
 * (the engine reads the stored hash words big-endian). Returned as 32 hex characters.
 */
export function rsdkPathKey(path: string): string {
  const d = md5(encoder.encode(path.toLowerCase()));
  let s = "";
  for (let w = 0; w < 4; w++) for (let j = 3; j >= 0; j--) s += d[w * 4 + j].toString(16).padStart(2, "0");
  return s;
}

/** RSDK's GenerateMD5FromString: the four state words as unsigned ints (used by the pack decryption keys). */
export function md5Words(text: string): [number, number, number, number] {
  const d = md5(encoder.encode(text));
  const w = (i: number) => (d[i * 4] | (d[i * 4 + 1] << 8) | (d[i * 4 + 2] << 16) | (d[i * 4 + 3] << 24)) >>> 0;
  return [w(0), w(1), w(2), w(3)];
}
