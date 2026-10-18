import { deflateSync } from "node:zlib";

export class Writer {
  data: number[] = [];
  bytes(value: Iterable<number>): void { for (const byte of value) this.data.push(byte); }
  u8(value: number): void { this.data.push(value & 255); }
  u16(value: number): void { this.u8(value); this.u8(value >>> 8); }
  u32(value: number): void { this.u16(value); this.u16(value >>> 16); }
  str(value: string): void { this.u8(value.length); this.bytes(Buffer.from(value, "latin1")); }
  compressed(value: Uint8Array): number {
    const offset = this.data.length, compressed = deflateSync(value);
    this.u32(compressed.length + 4);
    this.bytes([(value.length >>> 24) & 255, (value.length >>> 16) & 255, (value.length >>> 8) & 255, value.length & 255]);
    this.bytes(compressed);
    return offset;
  }
  finish(): Uint8Array { return Uint8Array.from(this.data); }
}
