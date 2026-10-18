// Sequential byte reader standing in for RSDK's global file cursor (FileRead / SetFilePosition / ...).

export class FileReader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}
  get size() { return this.data.length; }
  eof(): boolean { return this.pos >= this.data.length; }
  u8(): number { return this.pos < this.data.length ? this.data[this.pos++] : (this.pos++, 0); }
  s8(): number { return (this.u8() << 24) >> 24; }
  u16(): number { const a = this.u8(); return a | (this.u8() << 8); }
  s32(): number { const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8(); return a | (b << 8) | (c << 16) | (d << 24); }
  bytes(n: number): Uint8Array { const r = this.data.subarray(this.pos, this.pos + n); this.pos += n; return r; }
  skip(n: number): void { this.pos += n; }
  /** A length-prefixed string: one byte of length, then that many latin-1 characters. */
  str(): string { const n = this.u8(); return this.chars(n); }
  chars(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
}
