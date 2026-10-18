// Drawing.cpp (software renderer), ported for the browser: draws into an RGB565 framebuffer exactly like the
// original (palette lines per scanline, line scroll, deformation, ink effects), which the client then converts
// to RGBA and presents.

import type { Engine, ObjectScript, SpriteFrame } from "../engine.js";
import type { Entity } from "../entity.js";
import type { DrawApi } from "./api.js";
import type { TextMenu } from "../text.js";
import {
  SCREEN_YSIZE, LAYER_COUNT, LAYER_HSCROLL, LAYER_VSCROLL, PARALLAX_COUNT, TILE_SIZE, FLIP_NONE, FLIP_X, FLIP_Y, FLIP_XY,
  INK_NONE, INK_BLEND, INK_ALPHA, INK_ADD, INK_SUB, FX_SCALE, FX_ROTATE, FX_ROTOZOOM, FX_INK, FX_TINT, FX_FLIP,
  ROTSTYLE_NONE, ROTSTYLE_FULL, ROTSTYLE_45DEG, ROTSTYLE_STATICFRAMES,
} from "../c.js";
import { sin512LookupTable, cos512LookupTable } from "../math.js";
import { DrawObjectList } from "../scene.js";
import { RGB888_TO_RGB565 } from "../palette.js";
import { draw3DScene } from "./drawing3d.js";

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

export class SoftwareRenderer implements DrawApi {
  /** RGB565, GFX_LINESIZE x SCREEN_YSIZE */
  fb: Uint16Array;
  lineSize: number;
  /** Draw the stage tile layers (false = objects only, for debugging). */
  drawLayers = true;
  /** Called after the stage is drawn, before the fade (developer overlays). */
  overlay: ((E: Engine, r: SoftwareRenderer) => void) | null = null;
  private waterDrawPos = 0;

  constructor(readonly width: number) {
    this.lineSize = width;
    this.fb = new Uint16Array(width * SCREEN_YSIZE);
  }

  // ---- stage ------------------------------------------------------------------------------------------------

  DrawStageGFX(E: Engine): void {
    let w = E.waterLevel - E.yScrollOffset;
    if (w < 0) w = 0;
    if (w > SCREEN_YSIZE) w = SCREEN_YSIZE;
    this.waterDrawPos = w;
    E.waterDrawPos = w;
    const cam = E.curCam;
    const layer = (i: number) => {
      if (E.activeTileLayers[i] < LAYER_COUNT && this.drawLayers) {
        const type = E.stageLayouts[E.activeTileLayers[i]].type;
        if (type === LAYER_HSCROLL) this.DrawHLineScrollLayer(E, i);
        else if (type === LAYER_VSCROLL) this.DrawVLineScrollLayer(E, i);
      }
    };
    const mid = E.tLayerMidPoint;
    if (mid < 3) {
      DrawObjectList(E, 0, cam);
      layer(0);
      DrawObjectList(E, 1, cam);
      layer(1);
      DrawObjectList(E, 2, cam);
      DrawObjectList(E, 3, cam);
      DrawObjectList(E, 4, cam);
      layer(2);
    } else if (mid < 6) {
      DrawObjectList(E, 0, cam);
      layer(0);
      DrawObjectList(E, 1, cam);
      layer(1);
      DrawObjectList(E, 2, cam);
      layer(2);
      DrawObjectList(E, 3, cam);
      DrawObjectList(E, 4, cam);
    }
    if (mid < 6) {
      layer(3);
      DrawObjectList(E, 5, cam);
      DrawObjectList(E, 7, cam);
      DrawObjectList(E, 6, cam);
    }
    this.overlay?.(E, this);
    if (E.fadeMode > 0) this.DrawRectangle(E, 0, 0, E.SCREEN_XSIZE, SCREEN_YSIZE, E.fadeR, E.fadeG, E.fadeB, E.fadeA);
  }

  DrawHLineScrollLayer(E: Engine, layerID: number): void {
    const layer = E.stageLayouts[E.activeTileLayers[layerID]];
    if (!layer.xsize || !layer.ysize) return;
    const fb = this.fb;
    const LS = this.lineSize;
    const gfx = E.tilesetGFXData;
    const t = E.tiles128x128;
    const layerwidth = layer.xsize;
    let layerheight = layer.ysize;
    const aboveMidPoint = layerID >= E.tLayerMidPoint ? 1 : 0;
    const hp = E.hParallax;
    const linePos = this.linePos;
    let yscrollOffset: number;
    let deform: Int32Array, deformW: Int32Array, dPos: number, dwPos: number;
    if (E.activeTileLayers[layerID]) {
      const yScroll = (E.yScrollOffset * layer.parallaxFactor) >> 8;
      const fullheight = layerheight << 7;
      // (the original advances layer.scrollPos here; the simulation does that in StepLayerScroll)
      yscrollOffset = (yScroll + (layer.scrollPos >> 16)) % fullheight;
      layerheight = fullheight >> 7;
      deform = E.bgDeformationData2;
      deformW = E.bgDeformationData3;
      dPos = (yscrollOffset + layer.deformationOffset) & 0xff;
      dwPos = (yscrollOffset + this.waterDrawPos + layer.deformationOffsetW) & 0xff;
    } else {
      yscrollOffset = E.yScrollOffset;
      linePos.fill(E.xScrollOffset);
      deform = E.bgDeformationData0;
      deformW = E.bgDeformationData1;
      dPos = (yscrollOffset + layer.deformationOffset) & 0xff;
      dwPos = (yscrollOffset + this.waterDrawPos + layer.deformationOffsetW) & 0xff;
    }
    const fullLayerwidth = layerwidth << 7;
    if (layer.type === LAYER_HSCROLL && E.activeTileLayers[layerID]) {
      for (let i = 0; i < hp.entryCount; ++i) {
        let lp = (E.xScrollOffset * hp.parallaxFactor[i]) >> 8;
        let sp = hp.scrollPos[i];
        if (sp > fullLayerwidth << 16) sp -= fullLayerwidth << 16;
        if (sp < 0) sp += fullLayerwidth << 16;
        lp += sp >> 16;
        linePos[i] = lp % fullLayerwidth;
      }
    }

    const lineScroll = layer.lineScroll;
    let tileYPos = yscrollOffset % (layerheight << 7);
    if (tileYPos < 0) tileYPos += layerheight << 7;
    let scrollIndex = tileYPos;
    let tileY16 = tileYPos & 0xf;
    let chunkY = tileYPos >> 7;
    let tileY = (tileYPos & 0x7f) >> 4;
    let fbPos = 0;
    let line = 0;
    const lines = [this.waterDrawPos, SCREEN_YSIZE - this.waterDrawPos];
    for (let part = 0; part < 2; ++part) {
      let n = lines[part];
      while (n-- > 0) {
        const pal = E.fullPalette[E.gfxLineBuffer[line++]];
        const si = lineScroll[scrollIndex];
        let chunkX = linePos[si];
        if (part === 0) {
          if (hp.deform[si]) chunkX += deform[dPos];
          ++dPos;
        } else {
          if (hp.deform[si]) chunkX += deformW[dwPos];
          ++dwPos;
        }
        ++scrollIndex;
        if (chunkX < 0) chunkX += fullLayerwidth;
        if (chunkX >= fullLayerwidth) chunkX -= fullLayerwidth;

        const rowBase = chunkY << 8;
        const offY = TILE_SIZE * tileY16;
        const offYFlip = TILE_SIZE * (0xf - tileY16);
        let px = chunkX;
        let remain = LS;
        while (remain > 0) {
          const chunkXPos = px >> 7;
          const tilePx = px & 0xf;
          let cnt = TILE_SIZE - tilePx;
          if (cnt > remain) cnt = remain;
          const chunk = (layer.tiles[chunkXPos + rowBase] << 6) + ((px & 0x7f) >> 4) + 8 * tileY;
          if (t.visualPlane[chunk] === aboveMidPoint) {
            const base = t.gfxDataPos[chunk];
            let g: number, step: number;
            switch (t.direction[chunk]) {
              case FLIP_NONE: g = base + offY + tilePx; step = 1; break;
              case FLIP_X: g = base + offY + 0xf - tilePx; step = -1; break;
              case FLIP_Y: g = base + offYFlip + tilePx; step = 1; break;
              default: g = base + offYFlip + 0xf - tilePx; step = -1; break;
            }
            for (let k = 0; k < cnt; k++) {
              const c = gfx[g];
              if (c > 0) fb[fbPos + k] = pal[c];
              g += step;
            }
          }
          fbPos += cnt;
          remain -= cnt;
          px += cnt;
          if (px >= fullLayerwidth) px -= fullLayerwidth;
        }

        if (++tileY16 >= TILE_SIZE) {
          tileY16 = 0;
          ++tileY;
        }
        if (tileY >= 8) {
          if (++chunkY === layerheight) {
            chunkY = 0;
            scrollIndex -= 0x80 * layerheight;
          }
          tileY = 0;
        }
      }
    }
  }

  private linePos = new Int32Array(PARALLAX_COUNT);
  private vlinePos = new Int32Array(PARALLAX_COUNT);

  /** Vertical line scroll (only used by menu scenes); columns scroll independently. */
  DrawVLineScrollLayer(E: Engine, layerID: number): void {
    const layer = E.stageLayouts[E.activeTileLayers[layerID]];
    if (!layer.xsize || !layer.ysize) return;
    const fb = this.fb, LS = this.lineSize, gfx = E.tilesetGFXData, t = E.tiles128x128, vp = E.vParallax;
    let layerwidth = layer.xsize;
    const layerheight = layer.ysize;
    const aboveMidPoint = layerID >= E.tLayerMidPoint ? 1 : 0;
    let xscrollOffset: number;
    let deform: Int32Array, dPos: number;
    const fullLayerheight = layerheight << 7;
    if (E.activeTileLayers[layerID]) {
      const xScroll = (E.xScrollOffset * layer.parallaxFactor) >> 8;
      const fullLayerwidth = layerwidth << 7;
      xscrollOffset = (xScroll + (layer.scrollPos >> 16)) % fullLayerwidth;
      layerwidth = fullLayerwidth >> 7;
      deform = E.bgDeformationData2;
      dPos = (xscrollOffset + layer.deformationOffset) & 0xff;
      for (let i = 0; i < vp.entryCount; ++i) this.vlinePos[i] = (((E.yScrollOffset * vp.parallaxFactor[i]) >> 8) + (vp.scrollPos[i] >> 16)) % fullLayerheight;
    } else {
      xscrollOffset = E.xScrollOffset;
      this.vlinePos.fill(E.yScrollOffset);
      deform = E.bgDeformationData0;
      dPos = (E.xScrollOffset + layer.deformationOffset) & 0xff;
    }
    const pal = E.fullPalette[E.gfxLineBuffer[0]];
    let tileXPos = xscrollOffset % (layerwidth << 7);
    if (tileXPos < 0) tileXPos += layerwidth << 7;
    for (let x = 0; x < E.SCREEN_XSIZE; x++) {
      const wx = (tileXPos + x) % (layerwidth << 7);
      const si = layer.lineScroll[wx & 0x7fff];
      let yy = this.vlinePos[si];
      if (vp.deform[si]) yy += deform[(dPos + x) % deform.length];
      for (let y = 0; y < SCREEN_YSIZE; y++) {
        let wy = (yy + y) % fullLayerheight;
        if (wy < 0) wy += fullLayerheight;
        const chunk = (layer.tiles[(wx >> 7) + ((wy >> 7) << 8)] << 6) + ((wx & 0x7f) >> 4) + 8 * ((wy & 0x7f) >> 4);
        if (t.visualPlane[chunk] !== aboveMidPoint) continue;
        let tx = wx & 15, ty = wy & 15;
        const dir = t.direction[chunk];
        if (dir & FLIP_X) tx = 15 - tx;
        if (dir & FLIP_Y) ty = 15 - ty;
        const c = gfx[t.gfxDataPos[chunk] + ty * 16 + tx];
        if (c > 0) fb[y * LS + x] = pal[c];
      }
    }
  }

  // ---- shapes -----------------------------------------------------------------------------------------------

  ClearScreen(E: Engine, index: number): void {
    this.fb.fill(E.fullPalette[E.activePaletteID][index & 0xff]);
  }

  DrawRectangle(_E: Engine, XPos: number, YPos: number, width: number, height: number, R: number, G: number, B: number, A: number): void {
    if (A > 0xff) A = 0xff;
    const LS = this.lineSize;
    if (width + XPos > LS) width = LS - XPos;
    if (XPos < 0) { width += XPos; XPos = 0; }
    if (height + YPos > SCREEN_YSIZE) height = SCREEN_YSIZE - YPos;
    if (YPos < 0) { height += YPos; YPos = 0; }
    if (width <= 0 || height <= 0 || A <= 0) return;
    const fb = this.fb;
    const clr = RGB888_TO_RGB565(R & 0xff, G & 0xff, B & 0xff);
    if (A === 0xff) {
      for (let y = 0; y < height; y++) fb.fill(clr, (YPos + y) * LS + XPos, (YPos + y) * LS + XPos + width);
      return;
    }
    const fbb = 0x20 * (0xff - A), pb = 0x20 * A;
    const cr = pixelBlendR(pb, clr), cg = pixelBlendG(pb, clr), cb = blendLookupTable[pb + (clr & 0x1f)];
    for (let y = 0; y < height; y++) {
      let p = (YPos + y) * LS + XPos;
      for (let x = 0; x < width; x++, p++) {
        const d = fb[p];
        fb[p] = ((blendLookupTable[fbb + ((d & 0xf800) >> 11)] + cr) << 11) | ((blendLookupTable[fbb + ((d & 0x7e0) >> 6)] + cg) << 6) | (blendLookupTable[fbb + (d & 0x1f)] + cb);
      }
    }
  }

  DrawTintRectangle(_E: Engine, XPos: number, YPos: number, width: number, height: number): void {
    const LS = this.lineSize;
    if (width + XPos > LS) width = LS - XPos;
    if (XPos < 0) { width += XPos; XPos = 0; }
    if (height + YPos > SCREEN_YSIZE) height = SCREEN_YSIZE - YPos;
    if (YPos < 0) { height += YPos; YPos = 0; }
    if (width < 0 || height < 0) return;
    const fb = this.fb;
    for (let y = 0; y < height; y++) {
      let p = (YPos + y) * LS + XPos;
      for (let x = 0; x < width; x++, p++) fb[p] = tintLookupTable[fb[p]];
    }
  }

  // ---- sprites ----------------------------------------------------------------------------------------------

  DrawSprite(E: Engine, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, sheetID: number): void {
    this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, FLIP_NONE, INK_NONE, 0);
  }

  /** DrawSprite / DrawSpriteFlipped / the blended variants share this clipped blit. */
  private blit(E: Engine, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, sheetID: number, direction: number, ink: number, alpha: number): void {
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
    if (alpha > 0xff) alpha = 0xff;
    if (width <= 0 || height <= 0 || ((ink === INK_ALPHA || ink === INK_ADD || ink === INK_SUB) && alpha <= 0)) return;
    const surface = E.gfxSurface[sheetID];
    if (!surface) return;
    const sw = surface.width;
    const gd = E.graphicData;
    const fb = this.fb;
    const flipX = direction === FLIP_X || direction === FLIP_XY;
    const flipY = direction === FLIP_Y || direction === FLIP_XY;
    const startX = flipX ? widthFlip - 1 + sprX : sprX;
    const startY = flipY ? sprY + heightFlip - 1 : sprY;
    const dx = flipX ? -1 : 1;
    const dyRow = flipY ? -sw : sw;
    let rowStart = surface.dataPosition + startX + sw * startY;
    const fbb = 0x20 * (0xff - alpha), pb = 0x20 * alpha;
    for (let y = 0; y < height; y++) {
      const pal = E.fullPalette[E.gfxLineBuffer[YPos + y]];
      let g = rowStart;
      let p = (YPos + y) * LS + XPos;
      for (let x = 0; x < width; x++, p++, g += dx) {
        const c = gd[g];
        if (c === 0) continue;
        const color = pal[c];
        switch (ink) {
          case INK_NONE:
            fb[p] = color;
            break;
          case INK_BLEND:
            fb[p] = ((color & 0xf7de) >> 1) + ((fb[p] & 0xf7de) >> 1);
            break;
          case INK_ALPHA: {
            if (alpha === 0xff) { fb[p] = color; break; }
            const d = fb[p];
            fb[p] =
              ((blendLookupTable[fbb + ((d & 0xf800) >> 11)] + blendLookupTable[pb + ((color & 0xf800) >> 11)]) << 11) |
              ((blendLookupTable[fbb + ((d & 0x7e0) >> 6)] + blendLookupTable[pb + ((color & 0x7e0) >> 6)]) << 6) |
              (blendLookupTable[fbb + (d & 0x1f)] + blendLookupTable[pb + (color & 0x1f)]);
            break;
          }
          case INK_ADD: {
            const d = fb[p];
            const R = Math.min((blendLookupTable[pb + ((color & 0xf800) >> 11)] << 11) + (d & 0xf800), 0xf800);
            const G = Math.min((blendLookupTable[pb + ((color & 0x7e0) >> 6)] << 6) + (d & 0x7e0), 0x7e0);
            const B = Math.min(blendLookupTable[pb + (color & 0x1f)] + (d & 0x1f), 0x1f);
            fb[p] = R | G | B;
            break;
          }
          case INK_SUB: {
            const d = fb[p];
            const R = Math.max((d & 0xf800) - (subtractLookupTable[pb + ((color & 0xf800) >> 11)] << 11), 0);
            const G = Math.max((d & 0x7e0) - (subtractLookupTable[pb + ((color & 0x7e0) >> 6)] << 6), 0);
            const B = Math.max((d & 0x1f) - subtractLookupTable[pb + (color & 0x1f)], 0);
            fb[p] = R | G | B;
            break;
          }
        }
      }
      rowStart += dyRow;
    }
  }

  DrawSpriteFlipped(E: Engine, XPos: number, YPos: number, width: number, height: number, sprX: number, sprY: number, direction: number, sheetID: number): void {
    this.blit(E, XPos, YPos, width, height, sprX, sprY, sheetID, direction, INK_NONE, 0);
  }

  DrawSpriteScaled(E: Engine, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number, width: number, height: number, sprX: number, sprY: number, sheetID: number, tintMask = false): void {
    const LS = this.lineSize;
    let roundedYPos = 0, roundedXPos = 0;
    const truescaleX = 4 * scaleX, truescaleY = 4 * scaleY;
    if (truescaleX === 0 || truescaleY === 0) return;
    let widthM1 = width - 1;
    let trueXPos = XPos - ((truescaleX * pivotX) >> 11);
    width = (truescaleX * width) >> 11;
    let trueYPos = YPos - ((truescaleY * pivotY) >> 11);
    height = (truescaleY * height) >> 11;
    const finalscaleX = Math.trunc(Math.fround(Math.fround(2048.0 / Math.fround(truescaleX)) * 2048.0));
    const finalscaleY = Math.trunc(Math.fround(Math.fround(2048.0 / Math.fround(truescaleY)) * 2048.0));
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
    if (!surface) return;
    const gfxwidth = surface.width;
    const gd = E.graphicData, fb = this.fb;
    let g = sprX + surface.width * sprY + surface.dataPosition;
    const flip = direction === FLIP_X;
    if (flip) g += widthM1;
    let fbRow = trueXPos + LS * trueYPos;
    for (let y = 0; y < height; y++) {
      const pal = E.fullPalette[E.gfxLineBuffer[trueYPos + y]];
      let roundXPos = roundedXPos;
      let gfxPitch = 0;
      let p = fbRow;
      for (let x = 0; x < width; x++, p++) {
        const c = gd[g];
        if (c > 0) fb[p] = tintMask ? tintLookupTable[fb[p]] : pal[c];
        const offsetX = finalscaleX + roundXPos;
        g += flip ? -(offsetX >> 11) : offsetX >> 11;
        gfxPitch += offsetX >> 11;
        roundXPos = offsetX & 0x7ff;
      }
      fbRow += LS;
      const offsetY = finalscaleY + roundedYPos;
      g += (flip ? gfxPitch : -gfxPitch) + (offsetY >> 11) * gfxwidth;
      roundedYPos = offsetY & 0x7ff;
    }
  }

  DrawSpriteRotozoom(E: Engine, direction: number, XPos: number, YPos: number, pivotX: number, pivotY: number, sprX: number, sprY: number, width: number, height: number, rotation: number, scale: number, sheetID: number, zoom: boolean): void {
    if (zoom && scale === 0) return;
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
    const xs = [0, 0, 0, 0], ys = [0, 0, 0, 0];
    const corner = (i: number, a: number, b: number) => {
      xs[i] = XPos + ((sine * b + cosine * a) >> 9);
      ys[i] = YPos + ((cosine * b - sine * a) >> 9);
    };
    if (direction === FLIP_X) {
      corner(0, pivotX + 2, -pivotY - 2);
      corner(1, pivotX - width - 2, -pivotY - 2);
      corner(2, pivotX + 2, height - pivotY + 2);
      corner(3, pivotX - width - 2, height - pivotY + 2);
    } else {
      corner(0, -pivotX - 2, -pivotY - 2);
      corner(1, width - pivotX + 2, -pivotY - 2);
      corner(2, -pivotX - 2, height - pivotY + 2);
      corner(3, width - pivotX + 2, height - pivotY + 2);
    }
    let truescale = 0;
    if (zoom) {
      truescale = Math.trunc(Math.fround(Math.fround(512.0 / Math.fround(scale)) * 512.0));
      sine = Math.imul(truescale, sin512LookupTable[angle]) >> 9;
      cosine = Math.imul(truescale, cos512LookupTable[angle]) >> 9;
    }
    let left = LS;
    for (const x of xs) if (x < left) left = x;
    if (left < 0) left = 0;
    let right = 0;
    for (const x of xs) if (x > right) right = x;
    if (right > LS) right = LS;
    let maxX = right - left;
    let top = SCREEN_YSIZE;
    for (const y of ys) if (y < top) top = y;
    if (top < 0) top = 0;
    let bottom = 0;
    for (const y of ys) if (y > bottom) bottom = y;
    if (bottom > SCREEN_YSIZE) bottom = SCREEN_YSIZE;
    let maxY = bottom - top;
    if (maxX <= 0 || maxY <= 0) return;
    const surface = E.gfxSurface[sheetID];
    if (!surface) return;
    const lineSize = surface.widthShift;
    const fb = this.fb, gd = E.graphicData, base = surface.dataPosition;
    const startX = left - XPos;
    const startY = top - YPos;
    const shiftPivot = (sprX << 9) - 1;
    fullwidth <<= 9;
    const shiftheight = (sprY << 9) - 1;
    fullheight <<= 9;
    if (cosine < 0 || sine < 0) sprYPos += sine + cosine;
    const flip = direction === FLIP_X;
    let drawX = flip ? sprXPos - (cosine * startX - sine * startY) - (zoom ? truescale >> 1 : 0x100) : sprXPos + cosine * startX - sine * startY;
    let drawY = cosine * startY + sprYPos + sine * startX;
    let row = left + LS * top;
    let line = top;
    while (maxY--) {
      const pal = E.fullPalette[E.gfxLineBuffer[line++]];
      let finalX = drawX, finalY = drawY;
      let p = row;
      for (let w = maxX; w > 0; w--, p++) {
        if (finalX > shiftPivot && finalX < fullwidth && finalY > shiftheight && finalY < fullheight) {
          const index = gd[base + ((finalY >> 9) << lineSize) + (finalX >> 9)];
          if (index > 0) fb[p] = pal[index];
        }
        finalX += flip ? -cosine : cosine;
        finalY += sine;
      }
      if (flip) drawX += sine;
      else drawX -= sine;
      drawY += cosine;
      row += LS;
    }
  }

  DrawSpriteFX(E: Engine, entity: Entity, f: SpriteFrame, fx: number, x: number, y: number, sheet: number): void {
    switch (fx) {
      case FX_SCALE:
        this.DrawSpriteScaled(E, entity.direction, x, y, -f.pivotX, -f.pivotY, entity.scale, entity.scale, f.width, f.height, f.sprX, f.sprY, sheet);
        break;
      case FX_ROTATE:
        this.DrawSpriteRotozoom(E, entity.direction, x, y, -f.pivotX, -f.pivotY, f.sprX, f.sprY, f.width, f.height, entity.rotation, 0, sheet, false);
        break;
      case FX_ROTOZOOM:
        this.DrawSpriteRotozoom(E, entity.direction, x, y, -f.pivotX, -f.pivotY, f.sprX, f.sprY, f.width, f.height, entity.rotation, entity.scale, sheet, true);
        break;
      case FX_INK:
        switch (entity.inkEffect) {
          case INK_NONE: this.blit(E, x + f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_NONE, INK_NONE, 0); break;
          case INK_BLEND: this.blit(E, x + f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_NONE, INK_BLEND, 0); break;
          case INK_ALPHA: this.blit(E, x + f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_NONE, INK_ALPHA, entity.alpha); break;
          case INK_ADD: this.blit(E, x + f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_NONE, INK_ADD, entity.alpha); break;
          case INK_SUB: this.blit(E, x + f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_NONE, INK_SUB, entity.alpha); break;
        }
        break;
      case FX_TINT:
        this.DrawSpriteScaled(E, entity.direction, x, y, -f.pivotX, -f.pivotY, entity.scale, entity.scale, f.width, f.height, f.sprX, f.sprY, sheet, entity.inkEffect === INK_ALPHA);
        break;
      case FX_FLIP:
        switch (entity.direction) {
          default:
          case FLIP_NONE: this.blit(E, x + f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_NONE, INK_NONE, 0); break;
          case FLIP_X: this.blit(E, x - f.width - f.pivotX, y + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_X, INK_NONE, 0); break;
          case FLIP_Y: this.blit(E, x + f.pivotX, y - f.height - f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_Y, INK_NONE, 0); break;
          case FLIP_XY: this.blit(E, x - f.width - f.pivotX, y - f.height - f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet, FLIP_XY, INK_NONE, 0); break;
        }
        break;
    }
  }

  DrawObjectAnimation(E: Engine, script: ObjectScript, entity: Entity, XPos: number, YPos: number): void {
    const sprAnim = E.animationList[script.animFile.aniListOffset + entity.animation];
    let frame = E.animFrames[sprAnim.frameListOffset + entity.frame];
    if (!frame) return;
    const rot = (r: number) =>
      this.DrawSpriteRotozoom(E, entity.direction, XPos, YPos, -frame.pivotX, -frame.pivotY, frame.sprX, frame.sprY, frame.width, frame.height, r, 0, frame.sheetID, false);
    switch (sprAnim.rotationStyle) {
      case ROTSTYLE_NONE:
        switch (entity.direction) {
          case FLIP_NONE: this.blit(E, frame.pivotX + XPos, frame.pivotY + YPos, frame.width, frame.height, frame.sprX, frame.sprY, frame.sheetID, FLIP_NONE, INK_NONE, 0); break;
          case FLIP_X: this.blit(E, XPos - frame.width - frame.pivotX, frame.pivotY + YPos, frame.width, frame.height, frame.sprX, frame.sprY, frame.sheetID, FLIP_X, INK_NONE, 0); break;
          case FLIP_Y: this.blit(E, frame.pivotX + XPos, YPos - frame.height - frame.pivotY, frame.width, frame.height, frame.sprX, frame.sprY, frame.sheetID, FLIP_Y, INK_NONE, 0); break;
          case FLIP_XY: this.blit(E, XPos - frame.width - frame.pivotX, YPos - frame.height - frame.pivotY, frame.width, frame.height, frame.sprX, frame.sprY, frame.sheetID, FLIP_XY, INK_NONE, 0); break;
        }
        break;
      case ROTSTYLE_FULL:
        rot(entity.rotation);
        break;
      case ROTSTYLE_45DEG:
        if (entity.rotation >= 0x100) rot(0x200 - (((0x214 - entity.rotation) >> 6) << 6));
        else rot(((entity.rotation + 20) >> 6) << 6);
        break;
      case ROTSTYLE_STATICFRAMES: {
        let rotation = entity.rotation >= 0x100 ? 8 - ((532 - entity.rotation) >> 6) : (entity.rotation + 20) >> 6;
        let frameID = entity.frame;
        const dir = entity.direction;
        switch (rotation) {
          case 0: case 8: rotation = 0; break;
          case 1: frameID += sprAnim.frameCount; rotation = dir ? 0 : 0x80; break;
          case 2: rotation = 0x80; break;
          case 3: frameID += sprAnim.frameCount; rotation = dir ? 0x80 : 0x100; break;
          case 4: rotation = 0x100; break;
          case 5: frameID += sprAnim.frameCount; rotation = dir ? 0x100 : 384; break;
          case 6: rotation = 384; break;
          case 7: frameID += sprAnim.frameCount; rotation = dir ? 384 : 0; break;
        }
        frame = E.animFrames[sprAnim.frameListOffset + frameID];
        if (frame) rot(rotation);
        break;
      }
    }
  }

  DrawTextMenu(_E: Engine, _menu: TextMenu, _x: number, _y: number, _sheet: number): void {
    // Text menus are only used by the original's level select and credits; not drawn yet (see KNOWN_ISSUES.md).
  }

  Draw3DScene(E: Engine, sheet: number): void {
    draw3DScene(E, this, sheet);
  }

  /** Convert the RGB565 framebuffer to RGBA8888 for display. */
  toRGBA(out: Uint32Array): void {
    const fb = this.fb;
    for (let i = 0; i < fb.length; i++) out[i] = RGB565_TO_ABGR[fb[i]];
  }
}

function pixelBlendR(pb: number, clr: number): number {
  return blendLookupTable[pb + ((clr & 0xf800) >> 11)];
}
function pixelBlendG(pb: number, clr: number): number {
  return blendLookupTable[pb + ((clr & 0x7e0) >> 6)];
}

/** RGB565 -> little-endian RGBA (as a Uint32 for ImageData). */
export const RGB565_TO_ABGR = new Uint32Array(0x10000);
for (let i = 0; i < 0x10000; i++) {
  const r = ((i >> 11) & 0x1f) * 255 / 31;
  const g = ((i >> 5) & 0x3f) * 255 / 63;
  const b = (i & 0x1f) * 255 / 31;
  RGB565_TO_ABGR[i] = (0xff << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
}

export { FX_INK };
