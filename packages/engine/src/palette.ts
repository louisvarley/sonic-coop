// Palette.cpp / Palette.hpp. Colours are kept both packed RGB565 (what the renderer blends with) and as RGB888.

import type { Engine } from "./engine.js";
import { FileReader } from "./core/reader.js";
import { PALETTE_COUNT, SCREEN_YSIZE } from "./c.js";

export const RGB888_TO_RGB565 = (r: number, g: number, b: number) => (b >> 3) | ((g >> 2) << 5) | ((r >> 3) << 11);

export function SetActivePalette(E: Engine, newActivePal: number, startLine: number, endLine: number): void {
  newActivePal &= 0xff;
  if (newActivePal < PALETTE_COUNT) for (let l = startLine; l < endLine && l < SCREEN_YSIZE; l++) E.gfxLineBuffer[l] = newActivePal;
  E.activePaletteID = E.gfxLineBuffer[0];
}

export function SetPaletteEntry(E: Engine, paletteIndex: number, index: number, r: number, g: number, b: number): void {
  paletteIndex &= 0xff;
  index &= 0xff;
  const p = paletteIndex !== 0xff ? paletteIndex : E.activePaletteID;
  E.fullPalette[p][index] = RGB888_TO_RGB565(r & 0xff, g & 0xff, b & 0xff);
  const o = (p * 256 + index) * 3;
  E.palette32Buffer[o] = r;
  E.palette32Buffer[o + 1] = g;
  E.palette32Buffer[o + 2] = b;
}

export function SetPaletteEntryPacked(E: Engine, paletteIndex: number, index: number, color: number): void {
  SetPaletteEntry(E, paletteIndex & 0xff, index, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);
}

export function GetPaletteEntryPacked(E: Engine, paletteIndex: number, index: number): number {
  const o = (((paletteIndex & 0xff) % PALETTE_COUNT) * 256 + (index & 0xff)) * 3;
  const p = E.palette32Buffer;
  return (p[o] << 16) | (p[o + 1] << 8) | p[o + 2];
}

export function CopyPalette(E: Engine, src: number, srcStart: number, dst: number, dstStart: number, count: number): void {
  src &= 0xff; dst &= 0xff; srcStart &= 0xff; dstStart &= 0xff; count &= 0xff;
  if (src < PALETTE_COUNT && dst < PALETTE_COUNT) {
    for (let i = 0; i < count; ++i) {
      const s = srcStart + i, d = dstStart + i;
      if (s > 0xff || d > 0xff) continue; // the original would read/write into the next palette; keep within bounds
      E.fullPalette[dst][d] = E.fullPalette[src][s];
      E.palette32Buffer.copyWithin((dst * 256 + d) * 3, (src * 256 + s) * 3, (src * 256 + s) * 3 + 3);
    }
  }
}

export function RotatePalette(E: Engine, palID: number, startIndex: number, endIndex: number, right: number): void {
  startIndex &= 0xff; endIndex &= 0xff;
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

export function SetFade(E: Engine, R: number, G: number, B: number, A: number): void {
  E.fadeMode = 1;
  E.fadeR = R;
  E.fadeG = G;
  E.fadeB = B;
  A &= 0xffff;
  E.fadeA = A > 0xff ? 0xff : A;
}

export function SetPaletteFade(E: Engine, destPaletteID: number, srcPaletteA: number, srcPaletteB: number, blendAmount: number, startIndex: number, endIndex: number): void {
  destPaletteID &= 0xff; srcPaletteA &= 0xff; srcPaletteB &= 0xff; blendAmount &= 0xffff;
  if (destPaletteID >= PALETTE_COUNT || srcPaletteA >= PALETTE_COUNT || srcPaletteB >= PALETTE_COUNT) return;
  if (blendAmount >= 0x100) blendAmount = 0xff;
  if (startIndex >= endIndex) return;
  const blendA = 0xff - blendAmount;
  const p32 = E.palette32Buffer;
  const A = srcPaletteA * 768, B = srcPaletteB * 768, D = destPaletteID * 768;
  for (let l = startIndex; l <= endIndex && l < 256; ++l) {
    const r = ((((p32[B + l * 3] * blendAmount + blendA * p32[A + l * 3]) & 0xffff) >> 8) & 0xff);
    const g = ((((p32[B + l * 3 + 1] * blendAmount + blendA * p32[A + l * 3 + 1]) & 0xffff) >> 8) & 0xff);
    const b = ((((p32[B + l * 3 + 2] * blendAmount + blendA * p32[A + l * 3 + 2]) & 0xffff) >> 8) & 0xff);
    E.fullPalette[destPaletteID][l] = RGB888_TO_RGB565(r, g, b);
    p32[D + l * 3] = r;
    p32[D + l * 3 + 1] = g;
    p32[D + l * 3 + 2] = b;
  }
}

export function LoadPalette(E: Engine, filePath: string, paletteID: number, startPaletteIndex: number, startIndex: number, endIndex: number): void {
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
