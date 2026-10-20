// Sprite.cpp: sprite sheet surfaces and the GIF decoder. A headless engine (the server) registers surfaces with
// their sizes but skips decoding pixels.

import { isHudSheet, paintHudGlyphs, HUD_GLYPH_ROWS } from "./hudglyph.js";
import type { Engine } from "./engine.js";
import { FileReader } from "./core/reader.js";
import { GFXDATA_SIZE, SURFACE_COUNT } from "./c.js";
import { StrComp } from "./strings.js";

const LZ_MAX_CODE = 4095;
const LZ_BITS = 12;
const FIRST_CODE = 4097;
const NO_SUCH_CODE = 4098;
const codeMasks = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095];

class GifDecoder {
  depth = 0; clearCode = 0; eofCode = 0; runningCode = 0; runningBits = 0; prevCode = 0; currentCode = 0;
  maxCodePlusOne = 0; stackPtr = 0; shiftState = 0; fileState = 0; position = 0; bufferSize = 0; shiftData = 0; pixelCount = 0;
  buffer = new Uint8Array(256);
  stack = new Uint8Array(4096);
  suffix = new Uint8Array(4096);
  prefix = new Uint32Array(4096);
  constructor(private f: FileReader) {}

  init(): void {
    const code = this.f.u8();
    this.fileState = 0;
    this.position = 0;
    this.bufferSize = 0;
    this.buffer[0] = 0;
    this.depth = code;
    this.clearCode = 1 << code;
    this.eofCode = this.clearCode + 1;
    this.runningCode = this.eofCode + 1;
    this.runningBits = code + 1;
    this.maxCodePlusOne = 1 << this.runningBits;
    this.stackPtr = 0;
    this.prevCode = NO_SUCH_CODE;
    this.shiftState = 0;
    this.shiftData = 0;
    this.prefix.fill(NO_SUCH_CODE & 0xff); // (byte)NO_SUCH_CODE in the original
  }

  readByte(): number {
    if (this.fileState === 1) return 0;
    if (this.position === this.bufferSize) {
      this.bufferSize = this.f.u8();
      if (this.bufferSize === 0) {
        this.fileState = 1;
        return 0;
      }
      this.buffer.set(this.f.bytes(this.bufferSize));
      this.position = 1;
      return this.buffer[0];
    }
    return this.buffer[this.position++];
  }

  readCode(): number {
    while (this.shiftState < this.runningBits) {
      const b = this.readByte();
      this.shiftData = (this.shiftData | (b << this.shiftState)) >>> 0;
      this.shiftState += 8;
    }
    const code = this.shiftData & codeMasks[this.runningBits];
    this.shiftData >>>= this.runningBits;
    this.shiftState -= this.runningBits;
    if (++this.runningCode > this.maxCodePlusOne && this.runningBits < LZ_BITS) {
      this.maxCodePlusOne <<= 1;
      this.runningBits++;
    }
    return code;
  }

  tracePrefix(code: number, clearCode: number): number {
    let i = 0;
    while (code > clearCode && i++ <= LZ_MAX_CODE) code = this.prefix[code];
    return code & 0xff;
  }

  readLine(line: Uint8Array, length: number, offset: number): void {
    let i = 0;
    let stackPtr = this.stackPtr;
    const eofCode = this.eofCode;
    const clearCode = this.clearCode;
    let prevCode = this.prevCode;
    while (stackPtr !== 0 && i < length) {
      line[offset++] = this.stack[--stackPtr];
      i++;
    }
    while (i < length) {
      const gifCode = this.readCode();
      if (gifCode === eofCode) {
        if (i !== length - 1 || this.pixelCount !== 0) return;
        i++;
      } else if (gifCode === clearCode) {
        this.prefix.fill(NO_SUCH_CODE);
        this.runningCode = this.eofCode + 1;
        this.runningBits = this.depth + 1;
        this.maxCodePlusOne = 1 << this.runningBits;
        prevCode = this.prevCode = NO_SUCH_CODE;
      } else {
        if (gifCode < clearCode) {
          line[offset++] = gifCode;
          i++;
        } else {
          if (gifCode < 0 || gifCode > LZ_MAX_CODE) return;
          let code: number;
          if (this.prefix[gifCode] === NO_SUCH_CODE) {
            if (gifCode !== this.runningCode - 2) return;
            code = prevCode;
            this.suffix[this.runningCode - 2] = this.stack[stackPtr++] = this.tracePrefix(prevCode, clearCode);
          } else {
            code = gifCode;
          }
          let c = 0;
          while (c++ <= LZ_MAX_CODE && code > clearCode && code <= LZ_MAX_CODE) {
            this.stack[stackPtr++] = this.suffix[code];
            code = this.prefix[code];
          }
          if (c >= LZ_MAX_CODE || code > LZ_MAX_CODE) return;
          this.stack[stackPtr++] = code;
          while (stackPtr !== 0 && i++ < length) line[offset++] = this.stack[--stackPtr];
        }
        if (prevCode !== NO_SUCH_CODE) {
          if (this.runningCode < 2 || this.runningCode > FIRST_CODE) return;
          this.prefix[this.runningCode - 2] = prevCode;
          if (gifCode === this.runningCode - 2) this.suffix[this.runningCode - 2] = this.tracePrefix(prevCode, clearCode);
          else this.suffix[this.runningCode - 2] = this.tracePrefix(gifCode, clearCode);
        }
        prevCode = gifCode;
      }
    }
    this.prevCode = prevCode;
    this.stackPtr = stackPtr;
  }
}

export function ReadGifPictureData(f: FileReader, width: number, height: number, interlaced: boolean, gfxData: Uint8Array, offset: number): void {
  const initialRow = [0, 4, 2, 1];
  const rowInc = [8, 8, 4, 2];
  const dec = new GifDecoder(f);
  dec.init();
  if (interlaced) {
    for (let p = 0; p < 4; ++p) for (let y = initialRow[p]; y < height; y += rowInc[p]) dec.readLine(gfxData, width, y * width + offset);
  } else {
    for (let y = 0; y < height; ++y) dec.readLine(gfxData, width, y * width + offset);
  }
}

export interface GifHeader {
  width: number;
  height: number;
  interlaced: boolean;
  /** RGB triples of the global colour table (256 entries). */
  palette: Uint8Array;
}

/** Reads a GIF up to the start of the image data, leaving the reader positioned at the LZW minimum code size. */
export function readGifHeader(f: FileReader): GifHeader {
  f.pos = 6;
  const width = f.u16();
  const height = f.u16();
  const flags = f.u8();
  let paletteSize = (flags & 0x7) + 1;
  paletteSize = 1 << paletteSize;
  f.u8();
  f.u8();
  const palette = new Uint8Array(256 * 3);
  palette.set(f.bytes(paletteSize * 3).slice(0, 768));
  let b = f.u8();
  while (b !== 0x2c && !f.eof()) b = f.u8();
  f.skip(8);
  const imgFlags = f.u8();
  const interlaced = ((imgFlags & 0x40) >> 6) === 1;
  if (imgFlags >> 7 === 1) f.skip(0x80 * 3);
  return { width, height, interlaced, palette };
}

function LoadGIFFile(E: Engine, filePath: string, sheetID: number): boolean {
  const data = E.vfs.get(filePath);
  if (!data) {
    E.host.log(`missing sprite sheet ${filePath}`);
    return false;
  }
  const f = new FileReader(data);
  const h = readGifHeader(f);
  const surface = E.gfxSurface[sheetID];
  const glyphRows = isHudSheet(filePath) ? HUD_GLYPH_ROWS : 0;
  surface.fileName = filePath;
  surface.width = h.width;
  surface.height = h.height + glyphRows;
  surface.dataPosition = E.gfxDataPosition;
  surface.widthShift = 0;
  let w = surface.width;
  while (w > 1) {
    w >>= 1;
    ++surface.widthShift;
  }
  E.gfxDataPosition += surface.width * surface.height;
  if (E.gfxDataPosition < GFXDATA_SIZE) {
    if (!E.opts.headless) {
      ReadGifPictureData(f, h.width, h.height, h.interlaced, E.graphicData, surface.dataPosition);
      if (glyphRows) paintHudGlyphs(E.graphicData, surface.dataPosition, h.width, h.height);
    }
  } else {
    E.gfxDataPosition = 0;
    E.host.log("WARNING: Exceeded max gfx size!");
  }
  return true;
}

export function AddGraphicsFile(E: Engine, filePath: string): number {
  const sheetPath = "Data/Sprites/" + filePath;
  let sheetID = 0;
  while (E.gfxSurface[sheetID].fileName.length > 0) {
    if (StrComp(E.gfxSurface[sheetID].fileName, sheetPath)) return sheetID;
    if (++sheetID === SURFACE_COUNT) return 0;
  }
  const ext = sheetPath[sheetPath.length - 1];
  if (ext === "f") LoadGIFFile(E, sheetPath, sheetID);
  else E.host.log(`unsupported sprite format ${sheetPath}`);
  return sheetID;
}

export function RemoveGraphicsFile(E: Engine, filePath: string, sheetID: number): void {
  if (sheetID < 0) {
    for (let i = 0; i < SURFACE_COUNT; ++i) {
      if (E.gfxSurface[i].fileName.length > 0 && StrComp(E.gfxSurface[i].fileName, filePath)) sheetID = i;
    }
  }
  if (sheetID >= 0 && E.gfxSurface[sheetID].fileName.length) {
    const s = E.gfxSurface[sheetID];
    s.fileName = "";
    const size = s.height * s.width;
    const start = s.dataPosition;
    if (!E.opts.headless) E.graphicData.copyWithin(start, start + size, GFXDATA_SIZE);
    E.gfxDataPosition -= size;
    for (let i = 0; i < SURFACE_COUNT; ++i) if (E.gfxSurface[i].dataPosition > s.dataPosition) E.gfxSurface[i].dataPosition -= size;
  }
}

export function ClearGraphicsData(E: Engine): void {
  for (const s of E.gfxSurface) {
    s.fileName = "";
    s.height = s.width = s.widthShift = s.depth = s.dataPosition = 0;
  }
  E.gfxDataPosition = 0;
}
