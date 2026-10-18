import { inflateSync } from "node:zlib";

/** Strict binary reads for v5 tools; the runtime's legacy reader intentionally tolerates EOF. */
export class RsdkV5Reader {
  private pos = 0;
  private view: DataView;

  constructor(private data: Uint8Array, private label: string) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number { return this.data.length - this.pos; }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new Error(`truncated or invalid ${this.label} at byte ${this.pos}`);
    }
    const result = Uint8Array.from(this.data.subarray(this.pos, this.pos + length));
    this.pos += length;
    return result;
  }

  u8(): number { return this.bytes(1)[0]; }
  s8(): number { return (this.u8() << 24) >> 24; }
  u16(): number { const bytes = this.bytes(2); return bytes[0] | (bytes[1] << 8); }
  s16(): number { return (this.u16() << 16) >> 16; }
  u32(): number { return this.s32() >>> 0; }
  s32(): number {
    if (this.remaining < 4) throw new Error(`truncated ${this.label} at byte ${this.pos}`);
    const value = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return value;
  }
  f32(): number {
    const bits = this.bytes(4);
    return new DataView(bits.buffer, bits.byteOffset, bits.byteLength).getFloat32(0, true);
  }
  str(): string {
    return String.fromCharCode(...this.bytes(this.u8())).replace(/\0+$/, "");
  }
  utf16(): string {
    const length = this.u16();
    const bytes = this.bytes(length * 2);
    let result = "";
    for (let i = 0; i < bytes.length; i += 2) result += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return result;
  }

  compressed(expected?: number, budget = 64 * 1024 * 1024): Uint8Array {
    const stored = this.u32();
    // Only the decompressed length is big-endian; stored includes this four-byte field.
    const size = new DataView(this.bytes(4).buffer).getUint32(0, false);
    if (stored < 4 || size > budget || (expected !== undefined && size !== expected)) {
      throw new Error(`invalid ${this.label} compressed block size`);
    }
    const output = inflateSync(this.bytes(stored - 4), { maxOutputLength: Math.max(1, size) });
    if (output.length !== size) throw new Error(`${this.label} decompressed size mismatch`);
    return Uint8Array.from(output);
  }
}
