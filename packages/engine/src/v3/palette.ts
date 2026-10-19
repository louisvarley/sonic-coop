// Palette.cpp / Palette.hpp (RSDKv3). Colours are kept both packed RGB565 (what the renderer blends with) and as
// RGB888. activePalette is a pointer in the original; here it is activePaletteID.

import type { Engine3 } from "./engine.js";
import { FileReader } from "../core/reader.js";
import { PALETTE_COUNT, PALETTE_SIZE, SCREEN_YSIZE } from "./consts.js";

export const RGB888_TO_RGB565 = (r: number, g: number, b: number) => (b >> 3) | ((g >> 2) << 5) | ((r >> 3) << 11);

export function SetActivePalette(E: Engine3, newActivePal: number, startLine: number, endLine: number): void {
  newActivePal &= 0xff;
  if (newActivePal < PALETTE_COUNT) for (let l = startLine; l < endLine && l < SCREEN_YSIZE; l++) E.gfxLineBuffer[l] = newActivePal;
  E.activePaletteID = E.gfxLineBuffer[0];
}

export function SetPaletteEntry(E: Engine3, paletteIndex: number, index: number, r: number, g: number, b: number): void {
  paletteIndex &= 0xff;
  index &= 0xff;
  r &= 0xff; g &= 0xff; b &= 0xff;
  const p = paletteIndex !== 0xff ? paletteIndex : E.activePaletteID;
  E.fullPalette[p][index] = RGB888_TO_RGB565(r, g, b);
  const o = (p * 256 + index) * 3;
  E.palette32Buffer[o] = r;
  E.palette32Buffer[o + 1] = g;
  E.palette32Buffer[o + 2] = b;
}

export function CopyPalette(E: Engine3, src: number, dest: number): void {
  src &= 0xff;
  dest &= 0xff;
  if (src < PALETTE_COUNT && dest < PALETTE_COUNT) {
    E.fullPalette[dest].set(E.fullPalette[src]);
    E.palette32Buffer.copyWithin(dest * PALETTE_SIZE * 3, src * PALETTE_SIZE * 3, (src + 1) * PALETTE_SIZE * 3);
  }
}

export function RotatePalette(E: Engine3, startIndex: number, endIndex: number, right: number): void {
  startIndex &= 0xff;
  endIndex &= 0xff;
  const palID = E.activePaletteID;
  const pal = E.fullPalette[palID];
  const p32 = E.palette32Buffer;
  const base = palID * 256 * 3;
  if (right) {
    const c = pal[endIndex];
    const r = p32[base + endIndex * 3], g = p32[base + endIndex * 3 + 1], b = p32[base + endIndex * 3 + 2];
    for (let i = endIndex; i > startIndex; --i) {
      pal[i] = pal[i - 1];
      p32.copyWithin(base + i * 3, base + (i - 1) * 3, base + i * 3);
    }
    pal[startIndex] = c;
    p32[base + startIndex * 3] = r; p32[base + startIndex * 3 + 1] = g; p32[base + startIndex * 3 + 2] = b;
  } else {
    const c = pal[startIndex];
    const r = p32[base + startIndex * 3], g = p32[base + startIndex * 3 + 1], b = p32[base + startIndex * 3 + 2];
    for (let i = startIndex; i < endIndex; ++i) {
      pal[i] = pal[i + 1];
      p32.copyWithin(base + i * 3, base + (i + 1) * 3, base + (i + 2) * 3);
    }
    pal[endIndex] = c;
    p32[base + endIndex * 3] = r; p32[base + endIndex * 3 + 1] = g; p32[base + endIndex * 3 + 2] = b;
  }
}

export function SetFade(E: Engine3, R: number, G: number, B: number, A: number): void {
  E.fadeMode = 1;
  E.fadeR = R;
  E.fadeG = G;
  E.fadeB = B;
  A &= 0xffff;
  E.fadeA = A > 0xff ? 0xff : A;
}

/** SetLimitedFade: fades the RGB565 colours of one palette towards a colour (the RGB888 copy is left alone). */
export function SetLimitedFade(E: Engine3, paletteID: number, R: number, G: number, B: number, alpha: number, startIndex: number, endIndex: number): void {
  paletteID &= 0xff; R &= 0xff; G &= 0xff; B &= 0xff; alpha &= 0xffff;
  if (paletteID >= PALETTE_COUNT) return;
  E.paletteMode = 1;
  E.activePaletteID = paletteID;
  if (alpha >= 0x100) alpha = 0xff;
  if (startIndex >= endIndex) return;
  const alpha2 = 0xff - alpha;
  const p32 = E.palette32Buffer;
  const base = paletteID * 768;
  const pal = E.fullPalette[paletteID];
  for (let i = startIndex; i < endIndex && i < 256; ++i) {
    const r = (((R * alpha + alpha2 * p32[base + i * 3]) & 0xffff) >> 8) & 0xff;
    const g = (((G * alpha + alpha2 * p32[base + i * 3 + 1]) & 0xffff) >> 8) & 0xff;
    const b = (((B * alpha + alpha2 * p32[base + i * 3 + 2]) & 0xffff) >> 8) & 0xff;
    pal[i] = RGB888_TO_RGB565(r, g, b);
  }
}

export function LoadPalette(E: Engine3, filePath: string, paletteID: number, startPaletteIndex: number, startIndex: number, endIndex: number): void {
  const data = E.vfs.get("Data/Palettes/" + filePath);
  if (!data) return;
  const f = new FileReader(data);
  f.pos = 3 * startIndex;
  if (paletteID >= PALETTE_COUNT || paletteID < 0) paletteID = 0;
  for (let i = startIndex; i < endIndex; ++i) {
    const r = f.u8(), g = f.u8(), b = f.u8();
    SetPaletteEntry(E, paletteID ? paletteID : 0xff, startPaletteIndex++, r, g, b);
  }
}
