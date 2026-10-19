// Drawing.cpp (RSDKv3, software renderer) for the browser: draws into an RGB565 framebuffer exactly like the
// original (palette per scanline, line scroll, deformation, 3D floor/sky, ink effects, rotozoom, 3D faces, text),
// which the client converts to RGBA and presents. The scroll layers' state changes are made through the simulation
// (StepLayerForDraw) at the same point the original makes them.

import type { Engine3, ObjectScript3 } from "./engine.js";
import type { Entity3 } from "./entity.js";
import type { DrawApi3 } from "./render-api.js";
import type { TextMenu } from "../text.js";
import {
  FLIP_NONE, FLIP_X, FLIP_XY, FLIP_Y, LAYER_3DFLOOR, LAYER_3DSKY, LAYER_COUNT, LAYER_HSCROLL, LAYER_VSCROLL, ROTSTYLE_45DEG, ROTSTYLE_FULL,
  ROTSTYLE_NONE, ROTSTYLE_STATICFRAMES, SCREEN_CENTERY, SCREEN_YSIZE, TILE_SIZE,
} from "./consts.js";
import { sin512LookupTable, cos512LookupTable, sinM7LookupTable, cosM7LookupTable } from "../math.js";
import { DrawObjectList, StepLayerForDraw } from "./scene.js";
import { RGB888_TO_RGB565 } from "./palette.js";
import { TransformVertexBuffer, Sort3DDrawList } from "./scene3d.js";
import { RGB565_TO_ABGR } from "../render/drawing.js";


const blendLookupTable = new Uint16Array(0x20 * 0x100);
const subtractLookupTable = new Uint16Array(0x20 * 0x100);
const tintLookupTable = new Uint16Array(0x10000);
for (let y = 0; y < 0x100; y++) {
  for (let x = 0; x < 0x20; x++) {
    blendLookupTable[x + 0x20 * y] = (y * x) >> 8;
    subtractLookupTable[x + 0x20 * y] = (y * (0x1f - x)) >> 8;
  }
}
for (let i = 0; i < 0x10000; i++) {
  const tint = Math.trunc(((i & 0x1f) + ((i & 0x7e0) >> 6) + ((i & 0xf800) >> 11)) / 3) + 6;
  tintLookupTable[i] = 0x841 * Math.min(tint, 0x1f);
}

/** (int)(float)((float)(N / (float)scale) * N): the original's float reciprocal. */
const finalScale = (n: number, scale: number) => Math.trunc(Math.fround(Math.fround(n / Math.fround(scale)) * n));

interface Vert { x: number; y: number; u: number; v: number }

export class SoftwareRenderer3 implements DrawApi3 {
  /** RGB565, lineSize x SCREEN_YSIZE */
  fb: Uint16Array;
  readonly lineSize: number;
  /** Called after the stage is drawn, before the fade (developer overlays). */
  overlay: ((E: Engine3, r: SoftwareRenderer3) => void) | null = null;
  /** The palette the last drawn scanline used (activePalette in the original). */
  private pal: Uint16Array = new Uint16Array(256);
  private readonly faceLineStart = new Int32Array(SCREEN_YSIZE);
  private readonly faceLineEnd = new Int32Array(SCREEN_YSIZE);
  private readonly faceLineStartU = new Int32Array(SCREEN_YSIZE);
  private readonly faceLineEndU = new Int32Array(SCREEN_YSIZE);
  private readonly faceLineStartV = new Int32Array(SCREEN_YSIZE);
  private readonly faceLineEndV = new Int32Array(SCREEN_YSIZE);

  constructor(readonly width: number) {
    this.lineSize = width;
    this.fb = new Uint16Array(width * SCREEN_YSIZE);
  }

  /** The framebuffer as RGBA pixels (little-endian ABGR words) for an ImageData. */
  toRGBA(out: Uint32Array): void {
    const fb = this.fb;
    for (let i = 0; i < fb.length; i++) out[i] = RGB565_TO_ABGR[fb[i]];
  }

  private linePal(E: Engine3, line: number): Uint16Array {
    return (this.pal = E.fullPalette[E.gfxLineBuffer[line]] ?? E.fullPalette[0]);
  }

  // ---- stage ------------------------------------------------------------------------------------------------

  DrawStageGFX(E: Engine3): void {
    this.pal = E.activePalette;
    const cam = E.curCam;
    const layer = (i: number) => {
      const id = E.activeTileLayers[i];
      if (id >= LAYER_COUNT) return;
      switch (E.stageLayouts[id].type) {
        case LAYER_HSCROLL:
          StepLayerForDraw(E, i);
          this.DrawHLineScrollLayer(E, i);
          break;
        case LAYER_VSCROLL:
          StepLayerForDraw(E, i);
          this.DrawVLineScrollLayer(E, i);
          break;
        case LAYER_3DFLOOR:
          this.Draw3DFloorLayer(E, i);
          break;
        case LAYER_3DSKY:
          if (i === 3) this.Draw3DFloorLayer(E, i); // the original's software renderer swaps these for layer 3 (sic)
          else this.Draw3DSkyLayer(E, i);
          break;
      }
    };
    DrawObjectList(E, 0, cam);
    layer(0);
    DrawObjectList(E, 1, cam);
    layer(1);
    DrawObjectList(E, 2, cam);
    layer(2);
    DrawObjectList(E, 3, cam);
    DrawObjectList(E, 4, cam);
    layer(3);
    DrawObjectList(E, 5, cam);
    if (E.usingOrigins) DrawObjectList(E, 7, cam);
    DrawObjectList(E, 6, cam);
    this.overlay?.(E, this);
    if (E.fadeMode > 0) this.DrawRectangle(E, 0, 0, E.SCREEN_XSIZE, SCREEN_YSIZE, E.fadeR, E.fadeG, E.fadeB, E.fadeA);
  }

  DrawObjectLists(E: Engine3): void {
    const cam = E.curCam;
    for (const l of [0, 1, 2, 3, 4, 5]) DrawObjectList(E, l, cam);
    if (E.usingOrigins) DrawObjectList(E, 7, cam);
    DrawObjectList(E, 6, cam);
  }

  /** One horizontal run of a tile row: `count` pixels from tile pixel `src`, stepping `dir`. */
  private tileRun(E: Engine3, pal: Uint16Array, fbPos: number, src: number, dir: number, count: number): void {
    const fb = this.fb, gfx = E.tilesetGFXData;
    for (let n = 0; n < count; n++) {
      const px = gfx[src];
      if (px > 0) fb[fbPos] = pal[px];
      fbPos++;
      src += dir;
    }
  }

  DrawHLineScrollLayer(E: Engine3, layerID: number): void {
    const layer = E.stageLayouts[E.activeTileLayers[layerID]];
    const LS = this.lineSize;
    const t = E.tiles128x128;
    const screenwidth16 = (LS >> 4) - 1;
    const layerwidth = layer.xsize;
    let layerheight = layer.ysize;
    const aboveMidPoint = layerID >= E.tLayerMidPoint ? 1 : 0;
    const hp = E.hParallax;
    const lineScroll = layer.lineScroll;
    let yscrollOffset: number;
    let deform: Int32Array, deformW: Int32Array, dPos: number, dwPos: number;
    if (E.activeTileLayers[layerID]) {
      const yScroll = Math.imul(E.yScrollOffset, layer.parallaxFactor) >> 8;
      const fullheight = layerheight << 7;
      yscrollOffset = fullheight ? (yScroll + (layer.scrollPos >> 16)) % fullheight : 0;
      layerheight = fullheight >> 7;
      deform = E.bgDeformationData2;
      deformW = E.bgDeformationData3;
      dPos = (yscrollOffset + layer.deformationOffset) & 0xff;
      dwPos = (yscrollOffset + E.waterDrawPos + layer.deformationOffsetW) & 0xff;
    } else {
      yscrollOffset = E.yScrollOffset;
      deform = E.bgDeformationData0;
      deformW = E.bgDeformationData1;
      dPos = (yscrollOffset + layer.deformationOffset) & 0xff;
      dwPos = (yscrollOffset + E.waterDrawPos + layer.deformationOffsetW) & 0xff;
    }
    if (!layerwidth || !layerheight) return;

    let tileYPos = yscrollOffset % (layerheight << 7);
    if (tileYPos < 0) tileYPos += layerheight << 7;
    let scrollIndex = tileYPos;
    let tileY16 = tileYPos & 0xf;
    let chunkY = tileYPos >> 7;
    let tileY = (tileYPos & 0x7f) >> 4;

    let fbPos = 0;
    let line = 0;
    const drawableLines = [E.waterDrawPos, SCREEN_YSIZE - E.waterDrawPos];
    for (let half = 0; half < 2; ++half) {
      for (let l = drawableLines[half]; l > 0; l--) {
        const pal = this.linePal(E, line++);
        const si = lineScroll[scrollIndex];
        let chunkX = hp.linePos[si];
        if (half === 0) {
          if (hp.deform[si]) chunkX += deform[dPos];
          ++dPos;
        } else {
          if (hp.deform[si]) chunkX += deformW[dwPos];
          ++dwPos;
        }
        ++scrollIndex;
        const fullLayerwidth = layerwidth << 7;
        if (chunkX < 0) chunkX += fullLayerwidth;
        if (chunkX >= fullLayerwidth) chunkX -= fullLayerwidth;
        let chunkXPos = chunkX >> 7;
        const tilePxXPos = chunkX & 0xf;
        const tileXPxRemain = TILE_SIZE - tilePxXPos;
        let chunk = (layer.tiles[(chunkX >> 7) + (chunkY << 8)] << 6) + ((chunkX & 0x7f) >> 4) + 8 * tileY;
        const offY = TILE_SIZE * tileY16;
        const offYFlipX = TILE_SIZE * tileY16 + 0xf;
        const offYFlipY = TILE_SIZE * (0xf - tileY16);
        const offYFlipXY = TILE_SIZE * (0xf - tileY16) + 0xf;
        let lineRemain = LS;
        const drawTile = (count: number, first: boolean) => {
          if (t.visualPlane[chunk] === aboveMidPoint) {
            const base = t.gfxDataPos[chunk];
            switch (t.direction[chunk]) {
              case FLIP_NONE: this.tileRun(E, pal, fbPos, base + offY + (first ? tilePxXPos : 0), 1, count); break;
              case FLIP_X: this.tileRun(E, pal, fbPos, base + offYFlipX - (first ? tilePxXPos : 0), -1, count); break;
              case FLIP_Y: this.tileRun(E, pal, fbPos, base + offYFlipY + (first ? tilePxXPos : 0), 1, count); break;
              case FLIP_XY: this.tileRun(E, pal, fbPos, base + offYFlipXY - (first ? tilePxXPos : 0), -1, count); break;
            }
          }
          fbPos += count;
        };

        // the first tile, from its scroll offset
        lineRemain -= tileXPxRemain;
        drawTile(tileXPxRemain, true);

        // the bulk of the tiles
        let chunkTileX = ((chunkX & 0x7f) >> 4) + 1;
        for (let n = screenwidth16; n > 0; n--) {
          if (chunkTileX <= 7) ++chunk;
          else {
            if (++chunkXPos === layerwidth) chunkXPos = 0;
            chunkTileX = 0;
            chunk = (layer.tiles[chunkXPos + (chunkY << 8)] << 6) + 8 * tileY;
          }
          lineRemain -= TILE_SIZE;
          drawTile(TILE_SIZE, false);
          ++chunkTileX;
        }

        // any remaining tiles
        while (lineRemain > 0) {
          if (chunkTileX++ <= 7) ++chunk;
          else {
            chunkTileX = 0;
            if (++chunkXPos === layerwidth) chunkXPos = 0;
            chunk = (layer.tiles[chunkXPos + (chunkY << 8)] << 6) + 8 * tileY;
          }
          const cnt = lineRemain >= TILE_SIZE ? TILE_SIZE : lineRemain;
          lineRemain -= cnt;
          drawTile(cnt, false);
        }

        if (++tileY16 > TILE_SIZE - 1) {
          tileY16 = 0;
          ++tileY;
        }
        if (tileY > 7) {
          if (++chunkY === layerheight) {
            chunkY = 0;
            scrollIndex -= 0x80 * layerheight;
          }
          tileY = 0;
        }
        fbPos = line * LS;
      }
    }
  }

  DrawVLineScrollLayer(E: Engine3, layerID: number): void {
    const layer = E.stageLayouts[E.activeTileLayers[layerID]];
    if (!layer.xsize || !layer.ysize) return;
    const LS = this.lineSize;
    const fb = this.fb, gfx = E.tilesetGFXData, t = E.tiles128x128;
    let layerwidth = layer.xsize;
    const layerheight = layer.ysize;
    const aboveMidPoint = layerID >= E.tLayerMidPoint ? 1 : 0;
    const vp = E.vParallax;
    let xscrollOffset: number;
    let deform: Int32Array, dPos: number;
    if (E.activeTileLayers[layerID]) {
      const xScroll = Math.imul(E.xScrollOffset, layer.parallaxFactor) >> 8;
      const fullLayerwidth = layerwidth << 7;
      xscrollOffset = (xScroll + (layer.scrollPos >> 16)) % fullLayerwidth;
      layerwidth = fullLayerwidth >> 7;
      deform = E.bgDeformationData2;
      dPos = (xscrollOffset + layer.deformationOffset) & 0xff;
    } else {
      xscrollOffset = E.xScrollOffset;
      deform = E.bgDeformationData0;
      dPos = (E.xScrollOffset + layer.deformationOffset) & 0xff;
    }
    const pal = (this.pal = E.fullPalette[E.gfxLineBuffer[0]]);
    // (the original's modulo uses the layer height here, sic)
    let tileXPos = xscrollOffset % (layerheight << 7);
    if (tileXPos < 0) tileXPos += layerheight << 7;
    let scrollIndex = tileXPos;
    let chunkX = tileXPos >> 7;
    let tileX16 = tileXPos & 0xf;
    let tileX = (tileXPos & 0x7f) >> 4;

    for (let col = 0; col < LS; col++) {
      const si = layer.lineScroll[scrollIndex];
      let chunkY = vp.linePos[si];
      if (vp.deform[si]) chunkY += deform[dPos];
      ++dPos;
      ++scrollIndex;
      const fullLayerHeight = layerheight << 7;
      if (chunkY < 0) chunkY += fullLayerHeight;
      if (chunkY >= fullLayerHeight) chunkY -= fullLayerHeight;
      let chunkYPos = chunkY >> 7;
      const tileY = chunkY & 0xf;
      const tileYPxRemain = TILE_SIZE - tileY;
      let chunk = (layer.tiles[chunkX + ((chunkY >> 7) << 8)] << 6) + tileX + 8 * ((chunkY & 0x7f) >> 4);
      const offFlipX = 0xf - tileX16;
      const offFlipY = tileX16 + SCREEN_YSIZE;
      const offFlipXY = 0xff - tileX16;
      let lineRemain = SCREEN_YSIZE;
      let fbPos = col;
      const run = (src: number, dir: number, count: number) => {
        for (let n = 0; n < count; n++) {
          const px = gfx[src];
          if (px > 0) fb[fbPos] = pal[px];
          fbPos += LS;
          src += dir;
        }
      };
      const drawTile = (count: number, first: boolean) => {
        if (t.visualPlane[chunk] === aboveMidPoint) {
          const base = t.gfxDataPos[chunk];
          const fy = first ? TILE_SIZE * tileY : 0;
          switch (t.direction[chunk]) {
            case FLIP_NONE: run(base + fy + tileX16, TILE_SIZE, count); break;
            case FLIP_X: run(base + fy + offFlipX, TILE_SIZE, count); break;
            case FLIP_Y: run(base + offFlipY - fy, -TILE_SIZE, count); break;
            case FLIP_XY: run(base + offFlipXY - fy, -TILE_SIZE, count); break;
            default: fbPos += LS * count;
          }
        } else fbPos += LS * count;
      };

      lineRemain -= tileYPxRemain;
      drawTile(tileYPxRemain, true);

      let chunkTileY = ((chunkY & 0x7f) >> 4) + 1;
      for (let n = (SCREEN_YSIZE >> 4) - 1; n > 0; n--) {
        if (chunkTileY < 8) chunk += 8;
        else {
          if (++chunkYPos === layerheight) chunkYPos = 0;
          chunkTileY = 0;
          chunk = (layer.tiles[chunkX + (chunkYPos << 8)] << 6) + tileX;
        }
        lineRemain -= TILE_SIZE;
        drawTile(TILE_SIZE, false);
        ++chunkTileY;
      }
      while (lineRemain > 0) {
        if (chunkTileY < 8) chunk += 8;
        else {
          if (++chunkYPos === layerheight) chunkYPos = 0;
          chunkTileY = 0;
          chunk = (layer.tiles[chunkX + (chunkYPos << 8)] << 6) + tileX;
        }
        const cnt = lineRemain >= TILE_SIZE ? TILE_SIZE : lineRemain;
        lineRemain -= cnt;
        drawTile(cnt, false);
        chunkTileY++;
      }

      if (++tileX16 >= TILE_SIZE) {
        tileX16 = 0;
        ++tileX;
      }
      if (tileX >= 8) {
        if (++chunkX === layerwidth) {
          chunkX = 0;
          scrollIndex -= 0x80 * layerwidth;
        }
        tileX = 0;
      }
    }
  }

  /**
   * One scanline of a 3D floor/sky layer: `count` samples stepping (dx, dy) in 1/65536 tile-buffer units; each sample
   * advances the framebuffer every `perPixel` samples.
   */
  private floorLine(E: Engine3, pal: Uint16Array, fbPos: number, XPos: number, YPos: number, dx: number, dy: number, count: number,
    perPixel: number, layerWidth: number, layerHeight: number): void {
    const fb = this.fb, fbLen = fb.length, gfx = E.tilesetGFXData, floor = E.tile3DFloorBuffer;
    const t = E.tiles128x128, gfxPos = t.gfxDataPos, dir = t.direction;
    for (let x = 0; x < count; x++) {
      const tileX = XPos >> 12, tileY = YPos >> 12;
      if (tileX > -1 && tileX < layerWidth && tileY > -1 && tileY < layerHeight) {
        const chunk = floor[((YPos >> 16) << 8) + (XPos >> 16)];
        const tx = tileX & 0xf, ty = tileY & 0xf;
        let p = gfxPos[chunk];
        switch (dir[chunk]) {
          case FLIP_NONE: p += 16 * ty + tx; break;
          case FLIP_X: p += 16 * ty + 15 - tx; break;
          case FLIP_Y: p += tx + SCREEN_YSIZE - 16 * ty; break;
          case FLIP_XY: p += 15 - tx + SCREEN_YSIZE - 16 * ty; break;
        }
        const px = gfx[p];
        if (px > 0 && fbPos < fbLen) fb[fbPos] = pal[px];
      }
      if (perPixel === 1 || x & 1) ++fbPos;
      XPos += dx;
      YPos += dy;
    }
  }

  Draw3DFloorLayer(E: Engine3, layerID: number): void {
    const layer = E.stageLayouts[E.activeTileLayers[layerID]];
    if (!layer.xsize || !layer.ysize) return;
    const LS = this.lineSize;
    const layerWidth = layer.xsize << 7;
    const layerHeight = layer.ysize << 7;
    const layerYPos = layer.ypos;
    const sinValue = sinM7LookupTable[layer.angle] ?? 0;
    const cosValue = cosM7LookupTable[layer.angle] ?? 0;
    let lineBuf = SCREEN_YSIZE / 2 + 12;
    let fbPos = (SCREEN_YSIZE / 2 + 12) * LS;
    const layerXPos = layer.xpos >> 4;
    const ZBuffer = layer.zpos >> 4;
    let pal = this.pal;
    for (let i = 4; i < SCREEN_YSIZE / 2 - 8; ++i) {
      if (!(i & 1)) pal = this.linePal(E, lineBuf++);
      const d = (layerYPos / (i << 9)) | 0;
      const XBuffer = Math.imul(d, -cosValue) >> 8;
      const YBuffer = Math.imul(sinValue, d) >> 8;
      let XPos = layerXPos + (Math.imul(3 * sinValue, d) >> 2) - Math.imul(XBuffer, E.SCREEN_CENTERX);
      let YPos = ZBuffer + (Math.imul(3 * cosValue, d) >> 2) - Math.imul(YBuffer, E.SCREEN_CENTERX);
      this.floorLine(E, pal, fbPos, XPos, YPos, XBuffer, YBuffer, LS, 1, layerWidth, layerHeight);
      fbPos += LS;
    }
  }

  Draw3DSkyLayer(E: Engine3, layerID: number): void {
    const layer = E.stageLayouts[E.activeTileLayers[layerID]];
    if (!layer.xsize || !layer.ysize) return;
    const LS = this.lineSize;
    const layerWidth = layer.xsize << 7;
    const layerHeight = layer.ysize << 7;
    const layerYPos = layer.ypos;
    const sinValue = sinM7LookupTable[layer.angle & 0x1ff];
    const cosValue = cosM7LookupTable[layer.angle & 0x1ff];
    let fbPos = (SCREEN_YSIZE / 2 + 12) * LS;
    let lineBuf = SCREEN_YSIZE / 2 + 12;
    const layerXPos = layer.xpos >> 4;
    const layerZPos = layer.zpos >> 4;
    let pal = this.pal;
    // (low quality path: two samples per framebuffer pixel, each scanline drawn twice)
    for (let i = TILE_SIZE / 2; i < SCREEN_YSIZE - TILE_SIZE; ++i) {
      if (!(i & 1)) pal = this.linePal(E, lineBuf++);
      const d = (layerYPos / (i << 8)) | 0;
      const xBuffer = Math.imul(d, -cosValue) >> 9;
      const yBuffer = Math.imul(sinValue, d) >> 9;
      let XPos = layerXPos + (Math.imul(3 * sinValue, d) >> 2) - Math.imul(xBuffer, E.SCREEN_XSIZE);
      let YPos = layerZPos + (Math.imul(3 * cosValue, d) >> 2) - Math.imul(yBuffer, E.SCREEN_XSIZE);
      this.floorLine(E, pal, fbPos, XPos, YPos, xBuffer, yBuffer, 2 * LS, 2, layerWidth, layerHeight);
      fbPos += LS;
      if (!(i & 1)) fbPos -= LS;
    }
  }

  // ---- primitives -------------------------------------------------------------------------------------------

  ClearScreen(_E: Engine3, index: number): void {
    this.fb.fill(this.pal[index & 0xff]);
  }

  private blendPixel(dst: number, src: number, alpha: number): number {
    const fbB = 0x20 * (0xff - alpha), pxB = 0x20 * alpha;
    const R = (blendLookupTable[fbB + ((dst & 0xf800) >> 11)] + blendLookupTable[pxB + ((src & 0xf800) >> 11)]) << 11;
    const G = (blendLookupTable[fbB + ((dst & 0x7e0) >> 6)] + blendLookupTable[pxB + ((src & 0x7e0) >> 6)]) << 6;
    const B = blendLookupTable[fbB + (dst & 0x1f)] + blendLookupTable[pxB + (src & 0x1f)];
    return R | G | B;
  }

  DrawRectangle(_E: Engine3, XPos: number, YPos: number, width: number, height: number, R: number, G: number, B: number, A: number): void {
    if (A > 0xff) A = 0xff;
    const LS = this.lineSize;
    if (width + XPos > LS) width = LS - XPos;
    if (XPos < 0) {
      width += XPos;
      XPos = 0;
    }
    if (height + YPos > SCREEN_YSIZE) height = SCREEN_YSIZE - YPos;
    if (YPos < 0) {
      height += YPos;
      YPos = 0;
    }
    if (width <= 0 || height <= 0 || A <= 0) return;
    const clr = RGB888_TO_RGB565(R & 0xff, G & 0xff, B & 0xff);
    const fb = this.fb;
    for (let y = 0; y < height; y++) {
      let p = XPos + LS * (YPos + y);
      for (let x = 0; x < width; x++, p++) fb[p] = A === 0xff ? clr : this.blendPixel(fb[p], clr, A);
    }
  }

  DrawTintRectangle(_E: Engine3, XPos: number, YPos: number, width: number, height: number): void {
    const LS = this.lineSize;
    if (width + XPos > LS) width = LS - XPos;
    if (XPos < 0) {
      width += XPos;
      XPos = 0;
    }
    if (height + YPos > SCREEN_YSIZE) height = SCREEN_YSIZE - YPos;
    if (YPos < 0) {
      height += YPos;
      YPos = 0;
    }
    if (width < 0 || height < 0) return;
    const fb = this.fb;
    for (let y = 0; y < height; y++) {
      let p = XPos + LS * (YPos + y);
      for (let x = 0; x < width; x++, p++) fb[p] = tintLookupTable[fb[p]];
    }
  }

  /** Clips a sprite to the screen: [XPos, YPos, width, height, sprX, sprY] or null when nothing is visible. */
  private clip(XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number): number[] | null {
    const LS = this.lineSize;
    if (width + XPos > LS) width = LS - XPos;
    if (XPos < 0) {
      sprX -= XPos;
      width += XPos;
      XPos = 0;
    }
    if (height + YPos > SCREEN_YSIZE) height = SCREEN_YSIZE - YPos;
    if (YPos < 0) {
      sprY -= YPos;
      height += YPos;
      YPos = 0;
    }
    if (width <= 0 || height <= 0) return null;
    return [XPos, YPos, width, height, sprX, sprY];
  }

  /** The unflipped sprite blit shared by DrawSprite and the ink variants; `plot` writes one pixel. */
  private blit(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, sheetID: number,
    plot: (fbPos: number, colour: number) => void): void {
    const c = this.clip(XPos, YPos, width, height, sprX, sprY);
    if (!c) return;
    [XPos, YPos, width, height, sprX, sprY] = c;
    const surface = E.gfxSurface[sheetID];
    const LS = this.lineSize;
    const gfx = E.graphicData;
    let g = sprX + surface.width * sprY + surface.dataPosition;
    const gfxPitch = surface.width - width;
    let fbPos = XPos + LS * YPos;
    for (let y = 0; y < height; y++) {
      const pal = this.linePal(E, YPos + y);
      for (let x = 0; x < width; x++) {
        const px = gfx[g++];
        if (px > 0) plot(fbPos, pal[px]);
        fbPos++;
      }
      fbPos += LS - width;
      g += gfxPitch;
    }
  }

  DrawSprite(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, sheetID: number): void {
    const fb = this.fb;
    this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, (p, c) => (fb[p] = c));
  }

  DrawBlendedSprite(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, sheetID: number): void {
    const fb = this.fb;
    this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, (p, c) => (fb[p] = ((c & 0xf7de) >> 1) + ((fb[p] & 0xf7de) >> 1)));
  }

  DrawAlphaBlendedSprite(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, alpha: number, sheetID: number): void {
    if (alpha <= 0) return;
    if (alpha > 0xff) alpha = 0xff;
    const fb = this.fb;
    if (alpha === 0xff) this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, (p, c) => (fb[p] = c));
    else this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, (p, c) => (fb[p] = this.blendPixel(fb[p], c, alpha)));
  }

  DrawAdditiveBlendedSprite(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, alpha: number, sheetID: number): void {
    if (alpha <= 0) return;
    if (alpha > 0xff) alpha = 0xff;
    const fb = this.fb;
    const tb = 0x20 * alpha;
    this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, (p, c) => {
      const d = fb[p];
      const R = Math.min((blendLookupTable[tb + ((c & 0xf800) >> 11)] << 11) + (d & 0xf800), 0xf800);
      const G = Math.min((blendLookupTable[tb + ((c & 0x7e0) >> 6)] << 6) + (d & 0x7e0), 0x7e0);
      const B = Math.min(blendLookupTable[tb + (c & 0x1f)] + (d & 0x1f), 0x1f);
      fb[p] = R | G | B;
    });
  }

  DrawSubtractiveBlendedSprite(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, alpha: number, sheetID: number): void {
    if (alpha <= 0) return;
    if (alpha > 0xff) alpha = 0xff;
    const fb = this.fb;
    const tb = 0x20 * alpha;
    this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, (p, c) => {
      const d = fb[p];
      const R = Math.max((d & 0xf800) - (subtractLookupTable[tb + ((c & 0xf800) >> 11)] << 11), 0);
      const G = Math.max((d & 0x7e0) - (subtractLookupTable[tb + ((c & 0x7e0) >> 6)] << 6), 0);
      const B = Math.max((d & 0x1f) - subtractLookupTable[tb + (c & 0x1f)], 0);
      fb[p] = R | G | B;
    });
  }

  DrawSpriteFlipped(E: Engine3, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, direction: number, sheetID: number): void {
    const LS = this.lineSize;
    let widthFlip = width, heightFlip = height;
    if (width + XPos > LS) width = LS - XPos;
    if (XPos < 0) {
      sprX -= XPos;
      width += XPos;
      widthFlip += XPos + XPos;
      XPos = 0;
    }
    if (height + YPos > SCREEN_YSIZE) height = SCREEN_YSIZE - YPos;
    if (YPos < 0) {
      sprY -= YPos;
      height += YPos;
      heightFlip += YPos + YPos;
      YPos = 0;
    }
    if (width <= 0 || height <= 0) return;
    const surface = E.gfxSurface[sheetID];
    const gfx = E.graphicData, fb = this.fb;
    let g: number, dx: number, gfxPitch: number;
    switch (direction) {
      case FLIP_NONE:
        g = sprX + surface.width * sprY + surface.dataPosition;
        dx = 1;
        gfxPitch = surface.width - width;
        break;
      case FLIP_X:
        g = widthFlip - 1 + sprX + surface.width * sprY + surface.dataPosition;
        dx = -1;
        gfxPitch = width + surface.width;
        break;
      case FLIP_Y:
        g = sprX + surface.width * (sprY + heightFlip - 1) + surface.dataPosition;
        dx = 1;
        gfxPitch = -(width + surface.width);
        break;
      case FLIP_XY:
        g = widthFlip - 1 + sprX + surface.width * (sprY + heightFlip - 1) + surface.dataPosition;
        dx = -1;
        gfxPitch = -(surface.width - width);
        break;
      default:
        return;
    }
    let fbPos = XPos + LS * YPos;
    for (let y = 0; y < height; y++) {
      const pal = this.linePal(E, YPos + y);
      for (let x = 0; x < width; x++) {
        const px = gfx[g];
        if (px > 0) fb[fbPos] = pal[px];
        g += dx;
        fbPos++;
      }
      fbPos += LS - width;
      g += gfxPitch;
    }
  }

  /** DrawSpriteScaled / DrawScaledTintMask (the tint mask darkens the framebuffer where the sprite is opaque). */
  private scaled(E: Engine3, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number,
    width: number, height: number, sprX: number, sprY: number, sheetID: number, tint: boolean): void {
    const LS = this.lineSize;
    let roundedYPos = 0, roundedXPos = 0;
    const truescaleX = 4 * scaleX, truescaleY = 4 * scaleY;
    if (!truescaleX || !truescaleY) return;
    let widthM1 = width - 1;
    let trueXPos = XPos - (Math.imul(truescaleX, pivotX) >> 11);
    width = Math.imul(truescaleX, width) >> 11;
    let trueYPos = YPos - (Math.imul(truescaleY, pivotY) >> 11);
    height = Math.imul(truescaleY, height) >> 11;
    const finalscaleX = finalScale(2048, truescaleX);
    const finalscaleY = finalScale(2048, truescaleY);
    if (width + trueXPos > LS) width = LS - trueXPos;
    if (direction) {
      if (trueXPos < 0) {
        widthM1 -= Math.imul(trueXPos, -finalscaleX) >> 11;
        roundedXPos = Math.imul(trueXPos & 0xffff, -((finalscaleX << 16) >> 16)) & 0x7ff;
        width += trueXPos;
        trueXPos = 0;
      }
    } else if (trueXPos < 0) {
      sprX += Math.imul(trueXPos, -finalscaleX) >> 11;
      roundedXPos = Math.imul(trueXPos & 0xffff, -((finalscaleX << 16) >> 16)) & 0x7ff;
      width += trueXPos;
      trueXPos = 0;
    }
    if (height + trueYPos > SCREEN_YSIZE) height = SCREEN_YSIZE - trueYPos;
    if (trueYPos < 0) {
      sprY += Math.imul(trueYPos, -finalscaleY) >> 11;
      roundedYPos = Math.imul(trueYPos & 0xffff, -((finalscaleY << 16) >> 16)) & 0x7ff;
      height += trueYPos;
      trueYPos = 0;
    }
    if (width <= 0 || height <= 0) return;
    const surface = E.gfxSurface[sheetID];
    const gfxwidth = surface.width;
    const gfx = E.graphicData, fb = this.fb;
    let g = sprX + surface.width * sprY + surface.dataPosition;
    let fbPos = trueXPos + LS * trueYPos;
    const pitch = LS - width;
    if (direction === FLIP_X) g += widthM1;
    for (let y = 0; y < height; y++) {
      const pal = tint ? this.pal : this.linePal(E, trueYPos + y);
      let roundXPos = roundedXPos;
      let gfxPitch = 0;
      for (let x = 0; x < width; x++) {
        const px = gfx[g];
        if (px > 0) fb[fbPos] = tint ? tintLookupTable[fb[fbPos]] : pal[px];
        const offsetX = finalscaleX + roundXPos;
        if (direction === FLIP_X) g -= offsetX >> 11;
        else g += offsetX >> 11;
        gfxPitch += offsetX >> 11;
        roundXPos = offsetX & 0x7ff;
        ++fbPos;
      }
      fbPos += pitch;
      const offsetY = finalscaleY + roundedYPos;
      if (direction === FLIP_X) g += gfxPitch + (offsetY >> 11) * gfxwidth;
      else g += (offsetY >> 11) * gfxwidth - gfxPitch;
      roundedYPos = offsetY & 0x7ff;
    }
  }

  DrawSpriteScaled(E: Engine3, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number, width: number, height: number, sprX: number, sprY: number, sheetID: number): void {
    this.scaled(E, direction, XPos, YPos, pivotX, pivotY, scaleX, scaleY, width, height, sprX, sprY, sheetID, false);
  }

  DrawScaledTintMask(E: Engine3, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number, width: number, height: number, sprX: number, sprY: number, sheetID: number): void {
    this.scaled(E, direction, XPos, YPos, pivotX, pivotY, scaleX, scaleY, width, height, sprX, sprY, sheetID, true);
  }

  /** DrawSpriteRotated / DrawSpriteRotozoom (scale 0x200 with `zoom` false is plain rotation). */
  private rotozoom(E: Engine3, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, sprX: number, sprY: number,
    width: number, height: number, rotation: number, scale: number, zoom: boolean): number[] | null {
    const LS = this.lineSize;
    let sprXPos = (pivotX + sprX) << 9;
    let sprYPos = (pivotY + sprY) << 9;
    let fullwidth = width + sprX;
    let fullheight = height + sprY;
    let angle = rotation & 0x1ff;
    if (angle < 0) angle += 0x200;
    if (angle) angle = 0x200 - angle;
    let sine = zoom ? Math.imul(scale, sin512LookupTable[angle]) >> 9 : sin512LookupTable[angle];
    let cosine = zoom ? Math.imul(scale, cos512LookupTable[angle]) >> 9 : cos512LookupTable[angle];
    const X: number[] = [], Y: number[] = [];
    const corner = (a: number, b: number) => {
      X.push(XPos + ((Math.imul(sine, b) + Math.imul(cosine, a)) >> 9));
      Y.push(YPos + ((Math.imul(cosine, b) - Math.imul(sine, a)) >> 9));
    };
    if (direction === FLIP_X) {
      corner(pivotX + 2, -pivotY - 2);
      corner(pivotX - width - 2, -pivotY - 2);
      corner(pivotX + 2, height - pivotY + 2);
      corner(pivotX - width - 2, height - pivotY + 2);
    } else {
      corner(-pivotX - 2, -pivotY - 2);
      corner(width - pivotX + 2, -pivotY - 2);
      corner(-pivotX - 2, height - pivotY + 2);
      corner(width - pivotX + 2, height - pivotY + 2);
    }
    let truescale = 0x200;
    if (zoom) {
      truescale = finalScale(512, scale);
      sine = Math.imul(truescale, sin512LookupTable[angle]) >> 9;
      cosine = Math.imul(truescale, cos512LookupTable[angle]) >> 9;
    }
    let left = LS;
    for (const v of X) if (v < left) left = v;
    if (left < 0) left = 0;
    let right = 0;
    for (const v of X) if (v > right) right = v;
    if (right > LS) right = LS;
    const maxX = right - left;
    let top = SCREEN_YSIZE;
    for (const v of Y) if (v < top) top = v;
    if (top < 0) top = 0;
    let bottom = 0;
    for (const v of Y) if (v > bottom) bottom = v;
    if (bottom > SCREEN_YSIZE) bottom = SCREEN_YSIZE;
    const maxY = bottom - top;
    if (maxX <= 0 || maxY <= 0) return null;
    const startX = left - XPos, startY = top - YPos;
    fullwidth <<= 9;
    fullheight <<= 9;
    if (cosine < 0 || sine < 0) sprYPos += sine + cosine;
    let drawX: number;
    const drawY = Math.imul(cosine, startY) + sprYPos + Math.imul(sine, startX);
    if (direction === FLIP_X) drawX = sprXPos - (Math.imul(cosine, startX) - Math.imul(sine, startY)) - (zoom ? truescale >> 1 : 0x100);
    else drawX = sprXPos + Math.imul(cosine, startX) - Math.imul(sine, startY);
    return [left, top, maxX, maxY, drawX, drawY, sine, cosine, (sprX << 9) - 1, fullwidth, (sprY << 9) - 1, fullheight];
  }

  private drawRotated(E: Engine3, direction: number, params: number[] | null, sheetID: number): void {
    if (!params) return;
    const [left, top, maxX, maxY, drawX0, drawY0, sine, cosine, shiftPivot, fullwidth, shiftheight, fullheight] = params;
    const LS = this.lineSize;
    const surface = E.gfxSurface[sheetID];
    const lineSize = surface.widthShift;
    const gfx = E.graphicData, fb = this.fb;
    const base = surface.dataPosition;
    let drawX = drawX0, drawY = drawY0;
    let fbPos = left + LS * top;
    const flip = direction === FLIP_X;
    for (let y = 0; y < maxY; y++) {
      const pal = this.linePal(E, top + y);
      let finalX = drawX, finalY = drawY;
      for (let x = 0; x < maxX; x++) {
        if (finalX > shiftPivot && finalX < fullwidth && finalY > shiftheight && finalY < fullheight) {
          const index = gfx[base + (((finalY >> 9) << lineSize) + (finalX >> 9))];
          if (index > 0) fb[fbPos] = pal[index];
        }
        ++fbPos;
        finalX += flip ? -cosine : cosine;
        finalY += sine;
      }
      drawX += flip ? sine : -sine;
      drawY += cosine;
      fbPos += LS - maxX;
    }
  }

  DrawSpriteRotated(E: Engine3, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, sprX: number, sprY: number, width: number, height: number, rotation: number, sheetID: number): void {
    this.drawRotated(E, direction, this.rotozoom(E, direction, XPos, YPos, pivotX, pivotY, sprX, sprY, width, height, rotation, 0x200, false), sheetID);
  }

  DrawSpriteRotozoom(E: Engine3, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, sprX: number, sprY: number, width: number, height: number, rotation: number, scale: number, sheetID: number): void {
    if (scale === 0) return;
    this.drawRotated(E, direction, this.rotozoom(E, direction, XPos, YPos, pivotX, pivotY, sprX, sprY, width, height, rotation, scale, true), sheetID);
  }

  DrawObjectAnimation(E: Engine3, script: ObjectScript3, entity: Entity3, XPos: number, YPos: number): void {
    const sprAnim = E.animationList[script.animFile.aniListOffset + entity.animation];
    let frame = E.animFrames[sprAnim.frameListOffset + entity.frame];
    if (!frame) return;
    switch (sprAnim.rotationStyle) {
      case ROTSTYLE_NONE:
        switch (entity.direction) {
          case FLIP_NONE: this.DrawSpriteFlipped(E, frame.pivotX + XPos, frame.pivotY + YPos, frame.width, frame.height, frame.sprX, frame.sprY, FLIP_NONE, frame.sheetID); break;
          case FLIP_X: this.DrawSpriteFlipped(E, XPos - frame.width - frame.pivotX, frame.pivotY + YPos, frame.width, frame.height, frame.sprX, frame.sprY, FLIP_X, frame.sheetID); break;
          case FLIP_Y: this.DrawSpriteFlipped(E, frame.pivotX + XPos, YPos - frame.height - frame.pivotY, frame.width, frame.height, frame.sprX, frame.sprY, FLIP_Y, frame.sheetID); break;
          case FLIP_XY: this.DrawSpriteFlipped(E, XPos - frame.width - frame.pivotX, YPos - frame.height - frame.pivotY, frame.width, frame.height, frame.sprX, frame.sprY, FLIP_XY, frame.sheetID); break;
        }
        break;
      case ROTSTYLE_FULL:
        this.DrawSpriteRotated(E, entity.direction, XPos, YPos, -frame.pivotX, -frame.pivotY, frame.sprX, frame.sprY, frame.width, frame.height, entity.rotation, frame.sheetID);
        break;
      case ROTSTYLE_45DEG: {
        const rot = entity.rotation >= 0x100 ? 0x200 - (((532 - entity.rotation) >> 6) << 6) : ((entity.rotation + 20) >> 6) << 6;
        this.DrawSpriteRotated(E, entity.direction, XPos, YPos, -frame.pivotX, -frame.pivotY, frame.sprX, frame.sprY, frame.width, frame.height, rot, frame.sheetID);
        break;
      }
      case ROTSTYLE_STATICFRAMES: {
        let rotation = entity.rotation >= 0x100 ? 8 - ((532 - entity.rotation) >> 6) : (entity.rotation + 20) >> 6;
        let frameID = entity.frame;
        switch (rotation) {
          case 0: case 8: rotation = 0x00; break;
          case 1: frameID += sprAnim.frameCount; rotation = entity.direction ? 0 : 0x80; break;
          case 2: rotation = 0x80; break;
          case 3: frameID += sprAnim.frameCount; rotation = entity.direction ? 0x80 : 0x100; break;
          case 4: rotation = 0x100; break;
          case 5: frameID += sprAnim.frameCount; rotation = entity.direction ? 0x100 : 384; break;
          case 6: rotation = 384; break;
          case 7: frameID += sprAnim.frameCount; rotation = entity.direction ? 384 : 0; break;
        }
        frame = E.animFrames[sprAnim.frameListOffset + frameID];
        if (frame) this.DrawSpriteRotated(E, entity.direction, XPos, YPos, -frame.pivotX, -frame.pivotY, frame.sprX, frame.sprY, frame.width, frame.height, rotation, frame.sheetID);
        break;
      }
    }
  }

  // ---- 3D faces ---------------------------------------------------------------------------------------------

  private processScanEdge(a: Vert, b: Vert, uv: boolean): void {
    if (a.y === b.y) return;
    let top: number, bottom: number;
    if (a.y >= b.y) {
      top = b.y;
      bottom = a.y + 1;
    } else {
      top = a.y;
      bottom = b.y + 1;
    }
    if (top > SCREEN_YSIZE - 1 || bottom < 0) return;
    if (bottom > SCREEN_YSIZE) bottom = SCREEN_YSIZE;
    const dy = b.y - a.y;
    let fullX = a.x << 16;
    const stepX = (((b.x - a.x) << 16) / dy) | 0;
    let fullU = a.u << 16, fullV = a.v << 16;
    const stepU = !uv || a.u === b.u ? 0 : (((b.u - a.u) << 16) / dy) | 0;
    const stepV = !uv || a.v === b.v ? 0 : (((b.v - a.v) << 16) / dy) | 0;
    if (top < 0) {
      fullX -= top * stepX;
      fullU -= top * stepU;
      fullV -= top * stepV;
      top = 0;
    }
    for (let i = top; i < bottom; ++i) {
      const trueX = fullX >> 16;
      if (trueX < this.faceLineStart[i]) {
        this.faceLineStart[i] = trueX;
        this.faceLineStartU[i] = fullU;
        this.faceLineStartV[i] = fullV;
      }
      if (trueX > this.faceLineEnd[i]) {
        this.faceLineEnd[i] = trueX;
        this.faceLineEndU[i] = fullU;
        this.faceLineEndV[i] = fullV;
      }
      fullX += stepX;
      fullU += stepU;
      fullV += stepV;
    }
  }

  /** Sorts the quad's vertices by y and rasterises its edges; returns [faceTop, faceBottom] or null. */
  private scanFace(v: Vert[], uv: boolean): [number, number] | null {
    const LS = this.lineSize;
    if (v.every((p) => p.x < 0) || v.every((p) => p.x > LS) || v.every((p) => p.y < 0) || v.every((p) => p.y > SCREEN_YSIZE)) return null;
    if (v[0].x === v[1].x && v[1].x === v[2].x && v[2].x === v[3].x) return null;
    if (v[0].y === v[1].y && v[1].y === v[2].y && v[2].y === v[3].y) return null;
    let a = 0, b = 1, c = 2, d = 3;
    if (v[1].y < v[0].y) { a = 1; b = 0; }
    if (v[2].y < v[a].y) { const t = a; a = 2; c = t; }
    if (v[3].y < v[a].y) { const t = a; a = 3; d = t; }
    if (v[c].y < v[b].y) { const t = b; b = c; c = t; }
    if (v[d].y < v[b].y) { const t = b; b = d; d = t; }
    if (v[d].y < v[c].y) { const t = c; c = d; d = t; }
    let faceTop = v[a].y, faceBottom = v[d].y;
    if (faceTop < 0) faceTop = 0;
    if (faceBottom > SCREEN_YSIZE) faceBottom = SCREEN_YSIZE;
    for (let i = faceTop; i < faceBottom; ++i) {
      this.faceLineStart[i] = 100000;
      this.faceLineEnd[i] = -100000;
    }
    this.processScanEdge(v[a], v[b], uv);
    this.processScanEdge(v[a], v[c], uv);
    this.processScanEdge(v[a], v[d], uv);
    this.processScanEdge(v[b], v[c], uv);
    this.processScanEdge(v[c], v[d], uv);
    this.processScanEdge(v[b], v[d], uv);
    return [faceTop, faceBottom];
  }

  private drawFace(v: Vert[], colour: number): void {
    let alpha = (colour & 0x7f000000) >> 23;
    if (alpha < 1) return;
    if (alpha > 0xff) alpha = 0xff;
    const r = this.scanFace(v, false);
    if (!r) return;
    let [faceTop] = r;
    const faceBottom = r[1];
    const LS = this.lineSize, fb = this.fb;
    const colour16 = RGB888_TO_RGB565((colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff);
    for (; faceTop < faceBottom; ++faceTop) {
      let startX = this.faceLineStart[faceTop], endX = this.faceLineEnd[faceTop];
      if (startX >= LS || endX <= 0) continue;
      if (startX < 0) startX = 0;
      if (endX > LS - 1) endX = LS - 1;
      let p = LS * faceTop + startX;
      for (let n = endX - startX + 1; n > 0; n--, p++) fb[p] = alpha === 255 ? colour16 : this.blendPixel(fb[p], colour16, alpha);
    }
  }

  private drawTexturedFace(E: Engine3, v: Vert[], sheetID: number): void {
    const r = this.scanFace(v, true);
    if (!r) return;
    let [faceTop] = r;
    const faceBottom = r[1];
    const LS = this.lineSize, fb = this.fb, gfx = E.graphicData;
    const surface = E.gfxSurface[sheetID];
    const base = surface.dataPosition, shiftwidth = surface.widthShift;
    for (; faceTop < faceBottom; ++faceTop) {
      const pal = this.linePal(E, faceTop);
      let startX = this.faceLineStart[faceTop];
      const endX = this.faceLineEnd[faceTop];
      let UPos = this.faceLineStartU[faceTop], VPos = this.faceLineStartV[faceTop];
      if (startX >= LS || endX <= 0) continue;
      let posDifference = endX - startX;
      let bufU = 0, bufV = 0;
      if (endX !== startX) {
        bufU = ((this.faceLineEndU[faceTop] - UPos) / posDifference) | 0;
        bufV = ((this.faceLineEndV[faceTop] - VPos) / posDifference) | 0;
      }
      if (endX > LS - 1) posDifference = LS - 1 - startX;
      if (startX < 0) {
        posDifference += startX;
        UPos -= startX * bufU;
        VPos -= startX * bufV;
        startX = 0;
      }
      let p = LS * faceTop + startX;
      for (let n = posDifference + 1; n > 0; n--) {
        if (UPos < 0) UPos = 0;
        if (VPos < 0) VPos = 0;
        const index = gfx[base + (((VPos >> 16) << shiftwidth) + (UPos >> 16))];
        if (index > 0) fb[p] = pal[index];
        p++;
        UPos += bufU;
        VPos += bufV;
      }
    }
  }

  /** Draw3DScene: transforms, sorts and rasterises the face buffer. */
  Draw3DScene(E: Engine3, sheetID: number): void {
    TransformVertexBuffer(E);
    const order = Sort3DDrawList(E);
    const vb = E.vertexBuffer, vt = E.vertexBufferT, fbuf = E.faceBuffer;
    const cx = E.SCREEN_CENTERX, cy = SCREEN_CENTERY;
    for (const id of order) {
      const f = id * 6;
      const idx = [fbuf[f], fbuf[f + 1], fbuf[f + 2], fbuf[f + 3]];
      const colour = fbuf[f + 4], flags = fbuf[f + 5];
      const proj = (k: number): Vert => ({
        x: cx + ((Math.imul(E.projectionX, vt[k * 5]) / vt[k * 5 + 2]) | 0),
        y: cy - ((Math.imul(E.projectionY, vt[k * 5 + 1]) / vt[k * 5 + 2]) | 0),
        u: vb[k * 5 + 3],
        v: vb[k * 5 + 4],
      });
      const flat = (k: number): Vert => ({ x: vb[k * 5], y: vb[k * 5 + 1], u: vb[k * 5 + 3], v: vb[k * 5 + 4] });
      const visible = () => idx.every((k) => vt[k * 5 + 2] > 0x100);
      switch (flags) {
        case 0: if (visible()) this.drawTexturedFace(E, idx.map(proj), sheetID); break;
        case 1: this.drawTexturedFace(E, idx.map(flat), sheetID); break;
        case 2: if (visible()) this.drawFace(idx.map(proj), colour); break;
        case 3: this.drawFace(idx.map(flat), colour); break;
      }
    }
  }

  // ---- text -------------------------------------------------------------------------------------------------

  DrawBitmapText(E: Engine3, menu: TextMenu, XPos: number, YPos: number, scale: number, spacing: number, rowStart: number, rowCount: number, sheet: number): void {
    let Y = YPos << 9;
    if (rowCount < 0) rowCount = menu.rowCount;
    if (rowStart + rowCount > menu.rowCount) rowCount = menu.rowCount - rowStart;
    while (rowCount > 0) {
      let X = XPos << 9;
      for (let i = 0; i < menu.entrySize[rowStart]; ++i) {
        const ch = E.fontCharacterList[menu.textData[menu.entryStart[rowStart] + i]];
        if (!ch) continue;
        this.DrawSpriteScaled(E, FLIP_NONE, X >> 9, Y >> 9, -ch.pivotX, -ch.pivotY, scale, scale, ch.width, ch.height, ch.srcX, ch.srcY, sheet);
        X += ch.xAdvance * scale;
      }
      Y += spacing * scale;
      rowStart++;
      rowCount--;
    }
  }

  private drawTextMenuEntry(E: Engine3, menu: TextMenu, rowID: number, XPos: number, YPos: number, highlight: number, sheet: number, stage = false): void {
    let id = menu.entryStart[rowID];
    const size = menu.entrySize[rowID];
    for (let i = 0; i < size; ++i) {
      const ch = menu.textData[id++];
      const hl = stage && i === size - 1 ? 0 : highlight;
      this.DrawSprite(E, XPos + (i << 3), YPos, 8, 8, (ch & 0xf) << 3, ((ch >> 4) << 3) + hl, sheet);
    }
  }

  DrawTextMenu(E: Engine3, menu: TextMenu, XPos: number, YPos: number, sheet: number): void {
    let cnt: number;
    if (menu.visibleRowCount > 0) cnt = menu.visibleRowCount + menu.visibleRowOffset;
    else {
      menu.visibleRowOffset = 0;
      cnt = menu.rowCount;
    }
    if (menu.selectionCount === 3) {
      menu.selection2 = -1;
      for (let i = 0; i < menu.selection1 + 1; ++i) if (menu.entryHighlight[i] === 1) menu.selection2 = i;
    }
    for (let i = menu.visibleRowOffset; i < cnt; ++i) {
      let entryX = XPos;
      if (menu.alignment === 1) entryX = XPos - (menu.entrySize[i] << 3);
      else if (menu.alignment === 2) entryX = XPos - ((menu.entrySize[i] >> 1) << 3);
      else if (menu.alignment !== 0) return;
      switch (menu.selectionCount) {
        case 1:
          this.drawTextMenuEntry(E, menu, i, entryX, YPos, i === menu.selection1 ? 128 : 0, sheet);
          break;
        case 2:
          this.drawTextMenuEntry(E, menu, i, entryX, YPos, i === menu.selection1 || i === menu.selection2 ? 128 : 0, sheet);
          break;
        case 3:
          this.drawTextMenuEntry(E, menu, i, entryX, YPos, i === menu.selection1 ? 128 : 0, sheet);
          if (i === menu.selection2 && i !== menu.selection1) this.drawTextMenuEntry(E, menu, i, entryX, YPos, 128, sheet, true);
          break;
      }
      YPos += 8;
    }
  }
}
