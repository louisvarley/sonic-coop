import { RsdkV5Reader } from "./rsdkv5-reader.js";

export interface RsdkV5Tileset {
  /** 1024 tiles, sixteen consecutive rows per tile. Index zero is transparent. */
  pixels: Uint8Array;
  palette: Uint8Array;
}

function decodeLzw(input: Uint8Array, depth: number, size: number): Uint8Array {
  if (depth < 2 || depth > 8) throw new Error("invalid RSDKv5 tileset GIF LZW depth");
  const clear = 1 << depth, end = clear + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  const output = new Uint8Array(size);
  let width = depth + 1, next = end + 1, previous = -1, first = 0, bit = 0, written = 0;
  let initialized = false;
  for (;;) {
    if (bit + width > input.length * 8) throw new Error("truncated RSDKv5 tileset GIF LZW stream");
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code |= ((input[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) {
      width = depth + 1; next = end + 1; previous = -1; initialized = true;
      continue;
    }
    if (!initialized) throw new Error("RSDKv5 tileset GIF is missing its initial clear code");
    if (code === end) {
      if (written !== size) throw new Error("RSDKv5 tileset GIF pixel count mismatch");
      return output;
    }
    if (code > next || (code === next && previous < 0)) throw new Error("invalid RSDKv5 tileset GIF LZW code");
    let current = code, count = 0;
    if (current === next) { stack[count++] = first; current = previous; }
    while (current >= clear) {
      if (current >= next || count >= 4096) throw new Error("invalid RSDKv5 tileset GIF dictionary");
      stack[count++] = suffix[current];
      current = prefix[current];
    }
    first = current;
    stack[count++] = first;
    if (written + count > size) throw new Error("RSDKv5 tileset GIF pixel count mismatch");
    while (count) output[written++] = stack[--count];
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next++] = first;
      if (next === (1 << width) && width < 12) width++;
    }
    previous = code;
  }
}

export interface RsdkV5Gif extends RsdkV5Tileset { width: number; height: number }

/** Strict single-image GIF reader; palette index zero is transparent in the v5 renderer. */
export function readRsdkV5Gif(data: Uint8Array, tileset = false): RsdkV5Gif {
  const reader = new RsdkV5Reader(data, "RSDKv5 tileset GIF");
  const signature = String.fromCharCode(...reader.bytes(6));
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new Error("not an RSDKv5 tileset GIF");
  const width = reader.u16(), height = reader.u16();
  if (!width || !height || width * height > 16 * 1024 * 1024 || (tileset && (width !== 16 || height !== 16384))) {
    throw new Error(`invalid RSDKv5 tileset dimensions: ${width}x${height}`);
  }
  const flags = reader.u8();
  reader.bytes(2);
  const palette = new Uint8Array(768);
  if (flags & 0x80) palette.set(reader.bytes(3 * (1 << ((flags & 7) + 1))));
  let hasPalette = (flags & 0x80) !== 0;
  let pixels: Uint8Array | null = null;
  function blocks(): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    for (let size = reader.u8(); size; size = reader.u8()) chunks.push(reader.bytes(size));
    return chunks;
  }
  for (;;) {
    const marker = reader.u8();
    if (marker === 0x3b) break;
    if (marker === 0x21) { reader.u8(); blocks(); continue; }
    if (marker !== 0x2c || pixels) throw new Error("unsupported RSDKv5 tileset GIF image block");
    const left = reader.u16(), top = reader.u16(), imageWidth = reader.u16(), imageHeight = reader.u16();
    if (left || top || imageWidth !== width || imageHeight !== height) {
      throw new Error("RSDKv5 tileset GIF image must fill its canvas");
    }
    const imageFlags = reader.u8();
    if (imageFlags & 0x80) {
      palette.fill(0);
      palette.set(reader.bytes(3 * (1 << ((imageFlags & 7) + 1))));
      hasPalette = true;
    }
    if (!hasPalette) throw new Error("RSDKv5 tileset GIF is missing its palette");
    const depth = reader.u8();
    const decoded = decodeLzw(Buffer.concat(blocks()), depth, width * height);
    pixels = new Uint8Array(decoded.length);
    if (imageFlags & 0x40) {
      let source = 0;
      const starts = [0, 4, 2, 1], steps = [8, 8, 4, 2];
      for (let pass = 0; pass < 4; pass++) {
        for (let y = starts[pass]; y < height; y += steps[pass]) {
          pixels.set(decoded.subarray(source, source + width), y * width);
          source += width;
        }
      }
    } else pixels.set(decoded);
  }
  if (!pixels) throw new Error("RSDKv5 tileset GIF has no image");
  if (reader.remaining) throw new Error("unexpected trailing bytes in RSDKv5 tileset GIF");
  return { pixels, palette, width, height };
}

/** The v5 tile atlas contains exactly 1024 vertically stacked 16x16 tiles. */
export function readRsdkV5Tileset(data: Uint8Array): RsdkV5Tileset {
  return readRsdkV5Gif(data, true);
}
