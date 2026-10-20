// Sprite.cpp (RSDKv3): sprite sheet surfaces. The GIF decoder is shared with the v4 engine. A headless engine
// registers surfaces with their sizes but skips decoding pixels.

import { isHudSheet, paintHudGlyphs, HUD_GLYPH_ROWS } from "../hudglyph.js";
import type { Engine3 } from "./engine.js";
import { FileReader } from "../core/reader.js";
import { GFXDATA_SIZE, SURFACE_COUNT } from "./consts.js";
import { StrComp } from "../strings.js";
import { ReadGifPictureData, readGifHeader } from "../sprite.js";

function newSurface(E: Engine3, filePath: string, sheetID: number, width: number, height: number) {
  const surface = E.gfxSurface[sheetID];
  surface.fileName = filePath;
  surface.width = width;
  surface.height = height;
  surface.dataPosition = E.gfxDataPosition;
  surface.widthShift = 0;
  let w = width;
  while (w > 1) {
    w >>= 1;
    ++surface.widthShift;
  }
  return surface;
}

function LoadGIFFile(E: Engine3, filePath: string, sheetID: number): boolean {
  const data = E.vfs.get(filePath);
  if (!data) {
    E.host.log(`missing sprite sheet ${filePath}`);
    return false;
  }
  const f = new FileReader(data);
  const h = readGifHeader(f);
  const glyphRows = isHudSheet(filePath) ? HUD_GLYPH_ROWS : 0;
  const surface = newSurface(E, filePath, sheetID, h.width, h.height + glyphRows);
  E.gfxDataPosition += surface.width * surface.height;
  if (E.gfxDataPosition < GFXDATA_SIZE) {
    if (!E.opts.headless) {
      ReadGifPictureData(f, h.width, h.height, h.interlaced, E.graphicData, surface.dataPosition);
      if (glyphRows) paintHudGlyphs(E.graphicData, surface.dataPosition, h.width, h.height);
    }
  } else {
    E.gfxDataPosition = 0;
    E.host.log("WARNING: Exceeded max gfx surface size!");
  }
  return true;
}

function LoadBMPFile(E: Engine3, filePath: string, sheetID: number): boolean {
  const data = E.vfs.get(filePath);
  if (!data) return false;
  const f = new FileReader(data);
  f.pos = 18;
  const width = f.s32();
  const height = f.s32();
  const surface = newSurface(E, filePath, sheetID, width, height);
  if (!E.opts.headless) {
    f.pos = data.length - height * width;
    let p = surface.dataPosition + width * (height - 1);
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) E.graphicData[p++] = f.u8();
      p -= 2 * width;
    }
  }
  E.gfxDataPosition += height * width;
  if (E.gfxDataPosition >= GFXDATA_SIZE) {
    E.gfxDataPosition = 0;
    E.host.log("WARNING: Exceeded max gfx size!");
  }
  return true;
}

function LoadGFXFile(E: Engine3, filePath: string, sheetID: number): boolean {
  const data = E.vfs.get(filePath);
  if (!data) return false;
  const f = new FileReader(data);
  const width = (f.u8() << 8) | f.u8();
  const height = (f.u8() << 8) | f.u8();
  f.skip(0xff * 3);
  const surface = newSurface(E, filePath, sheetID, width, height);
  if (!E.opts.headless) {
    let p = surface.dataPosition;
    for (;;) {
      const b0 = f.u8();
      if (b0 === 0xff) {
        const b1 = f.u8();
        if (b1 === 0xff) break;
        const n = f.u8();
        for (let i = 0; i < n; ++i) E.graphicData[p++] = b1;
      } else {
        E.graphicData[p++] = b0;
      }
      if (f.eof()) break;
    }
  }
  E.gfxDataPosition += width * height;
  if (E.gfxDataPosition >= GFXDATA_SIZE) {
    E.gfxDataPosition = 0;
    E.host.log("WARNING: Exceeded max gfx size!");
  }
  return true;
}

export function AddGraphicsFile(E: Engine3, filePath: string): number {
  const sheetPath = "Data/Sprites/" + filePath;
  let sheetID = 0;
  while (E.gfxSurface[sheetID].fileName.length > 0) {
    if (StrComp(E.gfxSurface[sheetID].fileName, sheetPath)) return sheetID;
    if (++sheetID === SURFACE_COUNT) return 0;
  }
  switch (sheetPath[sheetPath.length - 1]) {
    case "f": LoadGIFFile(E, sheetPath, sheetID); break;
    case "p": LoadBMPFile(E, sheetPath, sheetID); break;
    case "x": LoadGFXFile(E, sheetPath, sheetID); break;
    default: E.host.log(`unsupported sprite format ${sheetPath}`); break; // .rsv videos and .pvr textures
  }
  return sheetID;
}

export function RemoveGraphicsFile(E: Engine3, filePath: string, sheetID: number): void {
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
    if (!E.opts.headless) E.graphicData.copyWithin(start, start + size, 0x200000);
    E.gfxDataPosition -= size;
    for (let i = 0; i < SURFACE_COUNT; ++i) if (E.gfxSurface[i].dataPosition > s.dataPosition) E.gfxSurface[i].dataPosition -= size;
  }
}

export function ClearGraphicsData(E: Engine3): void {
  for (const s of E.gfxSurface) s.fileName = "";
  E.gfxDataPosition = 0;
}
