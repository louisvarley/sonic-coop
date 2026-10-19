// Scene.cpp (RSDKv3): the stage loop, stage file loading, background/deformation setup and the camera functions.
// The few state changes the original renderer makes while drawing (DrawStageGFX: layer auto-scroll, parallax
// positions, the water line) are done here, so a headless engine stays in step with a drawing one.

import type { Engine3 } from "./engine.js";
import type { Player3 } from "./entity.js";
import * as C from "./consts.js";
import { FileReader } from "../core/reader.js";
import { sin512LookupTable } from "../math.js";
import { SetActivePalette, SetPaletteEntry, LoadPalette } from "./palette.js";
import { ClearGraphicsData, RemoveGraphicsFile } from "./sprite.js";
import { ClearAnimationData } from "./animation.js";
import { ReadGifPictureData } from "../sprite.js";
import { ProcessObjects, ProcessPausedObjects, ProcessStartupObjects, SetObjectTypeName, cameraForEntity } from "./object.js";
import { ProcessScript, PauseSound, ResumeSound } from "./script/vm.js";
import { ResetCollisionStorage } from "./collision.js";
import { ConvertStringToInteger3 } from "./script/compiler.js";
import { BTN } from "../input.js";
import { SetGlobalVariableByName } from "./config.js";

const SCREEN_SCROLL_UP = C.SCREEN_YSIZE / 2 - 16;
const SCREEN_SCROLL_DOWN = C.SCREEN_YSIZE / 2 + 16;
const abs = Math.abs;

export function stagePath(E: Engine3, file: string): string {
  return `Data/Stages/${E.stageList[E.activeStageList][E.stageListPosition].folder}/${file}`;
}

export function actKey(E: Engine3): string {
  return `${E.activeStageList}:${E.stageListPosition}`;
}

// ---- script data -----------------------------------------------------------------------------------------------

export function ClearScriptData(E: Engine3): void {
  E.scriptCode.fill(0);
  E.jumpTable.fill(0);
  E.scriptFrameCount = 0;
  E.compiler.reset();
  ClearGraphicsData(E);
  ClearAnimationData(E);
  for (let p = 0; p < C.PLAYER_COUNT; ++p) {
    E.playerList[p].animationFile = 0;
    E.playerList[p].boundEntity = p;
  }
  for (let o = 0; o < C.OBJECT_COUNT; ++o) {
    const s = E.objectScriptList[o];
    for (const ptr of [s.subMain, s.subPlayerInteraction, s.subDraw, s.subStartup]) {
      ptr.scriptCodePtr = C.SCRIPTDATA_COUNT - 1;
      ptr.jumpTablePtr = C.JUMPTABLE_COUNT - 1;
    }
    s.frameListOffset = 0;
    s.spriteSheetID = 0;
    s.animFile = E.animationFileList[0];
    s.mobile = true;
    E.typeNames[o] = "";
  }
  for (const f of E.scriptFunctionList) {
    f.name = "";
    f.ptr.scriptCodePtr = C.SCRIPTDATA_COUNT - 1;
    f.ptr.jumpTablePtr = C.JUMPTABLE_COUNT - 1;
  }
  SetObjectTypeName(E, "Blank Object", 0);
  ResetCollisionStorage(E);
}

// ---- stage loading ---------------------------------------------------------------------------------------------

export function InitFirstStage(E: Engine3): void {
  for (let c = 0; c < C.PLAYER_COUNT; c++) {
    E.setCamera(c);
    E.xScrollOffset = 0;
    E.yScrollOffset = 0;
  }
  E.setCamera(0);
  E.musicStatus = 0;
  E.host.stopMusic();
  E.host.stopAllSfx?.();
  E.host.releaseStageSfx?.();
  E.fadeMode = 0;
  E.activePlayer = 0;
  ClearGraphicsData(E);
  ClearAnimationData(E);
  E.activePaletteID = 0;
  LoadPalette(E, "MasterPalette.act", 0, 0, 0, 256);
  E.stageMode = C.STAGEMODE_LOAD;
  E.gameMode = C.ENGINE_MAINGAME;
}

/** Releases the stage sound effects and registers the stage's own (LoadSfx). */
function loadStageSfx(E: Engine3, paths: string[]): void {
  E.host.releaseStageSfx?.();
  for (let i = E.globalSFXCount; i < C.SFX_COUNT; i++) E.sfxList[i].name = "";
  E.stageSFXCount = paths.length;
  paths.forEach((path, i) => {
    E.sfxList[E.globalSFXCount + i].name = path;
    E.host.loadSfx?.(E.globalSFXCount + i, path);
  });
}

export function LoadStageFiles(E: Engine3): void {
  const stage = E.stageList[E.activeStageList][E.stageListPosition];
  if (!stage) throw new Error(`no stage ${E.activeStageList}:${E.stageListPosition}`);
  E.host.stopAllSfx?.();
  let scriptID = 1;
  if (E.currentStageFolder !== stage.folder) {
    E.currentStageFolder = stage.folder;
    E.host.log(`loading scene ${stage.folder} ${stage.name}`);
    LoadPalette(E, "MasterPalette.act", 0, 0, 0, 256);
    ClearScriptData(E);
    for (let i = C.SURFACE_COUNT; i > 0; i--) RemoveGraphicsFile(E, "", i - 1);

    const stageConfig = E.vfs.get(stagePath(E, "StageConfig.bin"));
    const loadGlobalScripts = stageConfig ? stageConfig[0] : 0;
    if (loadGlobalScripts) {
      const gc = E.gameConfig;
      gc.objectNames.forEach((n, i) => SetObjectTypeName(E, n, scriptID + i));
      for (const path of gc.scriptPaths) {
        E.compiler.ParseScriptFile(path, scriptID++);
        if (E.gameMode === C.ENGINE_SCRIPTERROR) return;
      }
    }

    if (stageConfig) {
      const f = new FileReader(stageConfig);
      f.u8(); // load globals
      for (let i = 96; i < 128; ++i) {
        const r = f.u8(), g = f.u8(), b = f.u8();
        SetPaletteEntry(E, 0xff, i, r, g, b);
      }
      const stageObjectCount = f.u8();
      const names: string[] = [];
      for (let i = 0; i < stageObjectCount; ++i) names.push(f.str());
      names.forEach((n, i) => SetObjectTypeName(E, n, scriptID + i));
      for (let i = 0; i < stageObjectCount; ++i) {
        const path = f.str();
        E.compiler.ParseScriptFile(path, scriptID + i);
        if (E.gameMode === C.ENGINE_SCRIPTERROR) return;
      }
      const sfxCount = f.u8();
      const sfx: string[] = [];
      for (let i = 0; i < sfxCount; ++i) sfx.push(f.str());
      loadStageSfx(E, sfx);
    }
    if (E.vfs.get(stagePath(E, "16x16Tiles.gif"))) LoadStageGIFFile(E);
    else LoadStageGFXFile(E);
    LoadStageCollisions(E);
    LoadStageBackground(E);
  } else {
    E.host.log(`reloading scene ${stage.folder} ${stage.name}`);
  }
  LoadStageChunks(E);
  for (let i = 0; i < C.TRACK_COUNT; ++i) {
    E.musicTrackNames[i] = "";
    E.host.setMusicTrack("", i, false, 0);
  }
  for (let i = 0; i < C.ENTITY_COUNT; ++i) {
    const e = E.objectEntityList[i];
    e.clear();
    e.drawOrder = 3;
    e.scale = 512;
  }
  LoadActLayout(E);
  Init3DFloorBuffer(E, 0);
  E.loadedActKey = actKey(E);
  ProcessStartupObjects(E);
  const p0 = E.playerList[0];
  for (let c = 0; c < C.PLAYER_COUNT; c++) {
    E.setCamera(c);
    const p = E.playerList[c < E.camCount ? c : 0];
    const px = (c < E.camCount ? p : p0).xpos >> 16, py = (c < E.camCount ? p : p0).ypos >> 16;
    E.xScrollA = px - E.SCREEN_CENTERX;
    E.xScrollB = px - E.SCREEN_CENTERX + E.SCREEN_XSIZE;
    E.yScrollA = py - SCREEN_SCROLL_UP;
    E.yScrollB = py - SCREEN_SCROLL_UP + C.SCREEN_YSIZE;
  }
  E.setCamera(0);
}

export function LoadActLayout(E: Engine3): void {
  const stage = E.stageList[E.activeStageList][E.stageListPosition];
  const data = E.vfs.get(`Data/Stages/${stage.folder}/Act${stage.id}.bin`);
  E.actID = ConvertStringToInteger3(stage.id) ?? 0;
  if (!data) {
    E.host.log(`missing act layout for ${stage.folder} ${stage.id}`);
    return;
  }
  const f = new FileReader(data);
  const length = f.u8();
  E.titleCardWord2 = length;
  let title = "";
  for (let i = 0; i < length; i++) {
    const ch = f.u8();
    title += String.fromCharCode(ch);
    if (ch === 45) E.titleCardWord2 = i + 1;
  }
  E.titleCardText = title;

  for (let i = 0; i < 4; i++) E.activeTileLayers[i] = f.u8();
  E.tLayerMidPoint = f.u8();
  const fg = E.stageLayouts[0];
  fg.xsize = f.u8();
  fg.ysize = f.u8();
  E.newXBoundary1 = 0;
  E.newYBoundary1 = 0;
  E.newXBoundary2 = fg.xsize << 7;
  E.newYBoundary2 = fg.ysize << 7;
  for (let c = 0; c < C.PLAYER_COUNT; c++) {
    E.setCamera(c);
    E.xBoundary1 = 0;
    E.yBoundary1 = 0;
    E.xBoundary2 = fg.xsize << 7;
    E.yBoundary2 = fg.ysize << 7;
  }
  E.setCamera(0);
  E.waterLevel = (fg.ysize << 7) + 128;
  fg.tiles.fill(0);
  for (let y = 0; y < fg.ysize; ++y) {
    for (let x = 0; x < fg.xsize; ++x) {
      const hi = f.u8();
      fg.tiles[y * 0x100 + x] = (hi << 8) + f.u8();
    }
  }
  // type names (unused)
  const typenameCnt = f.u8();
  for (let i = 0; i < typenameCnt; ++i) f.skip(f.u8());
  // objects
  let objectCount = f.u8();
  objectCount = (objectCount << 8) + f.u8();
  for (let i = 0; i < objectCount && 32 + i < C.ENTITY_COUNT; ++i) {
    const object = E.objectEntityList[32 + i];
    object.type = f.u8();
    object.propertyValue = f.u8();
    let x = f.u8() << 8;
    x += f.u8();
    object.xpos = x << 16;
    let y = f.u8() << 8;
    y += f.u8();
    object.ypos = y << 16;
  }
  fg.type = C.LAYER_HSCROLL;
}

export function LoadStageBackground(E: Engine3): void {
  for (let i = 0; i < C.LAYER_COUNT; ++i) {
    E.stageLayouts[i].type = C.LAYER_NOSCROLL;
    E.stageLayouts[i].deformationOffset = 0;
    E.stageLayouts[i].deformationOffsetW = 0;
  }
  E.hParallax.scrollPos.fill(0);
  E.vParallax.scrollPos.fill(0);
  const data = E.vfs.get(stagePath(E, "Backgrounds.bin"));
  if (!data) return;
  const f = new FileReader(data);
  const layerCount = f.u8();
  for (const ls of [E.hParallax, E.vParallax]) {
    ls.entryCount = f.u8();
    for (let i = 0; i < ls.entryCount; ++i) {
      const hi = f.u8();
      ls.parallaxFactor[i] = (hi << 8) + f.u8();
      ls.scrollSpeed[i] = f.u8() << 10;
      ls.scrollPos[i] = 0;
      ls.deform[i] = f.u8();
    }
  }
  for (let i = 1; i < layerCount + 1 && i < C.LAYER_COUNT; ++i) {
    const layer = E.stageLayouts[i];
    layer.xsize = f.u8();
    layer.ysize = f.u8();
    layer.type = f.u8();
    const hi = f.u8();
    layer.parallaxFactor = (hi << 8) + f.u8();
    layer.scrollSpeed = f.u8() << 10;
    layer.scrollPos = 0;
    layer.tiles.fill(0);
    layer.lineScroll.fill(0, 0, 0x7fff);
    let p = 0;
    for (;;) {
      const b0 = f.u8();
      if (b0 === 0xff) {
        const b1 = f.u8();
        if (b1 === 0xff) break;
        const cnt = f.u8() - 1;
        for (let c = 0; c < cnt; ++c) layer.lineScroll[p++] = b1;
      } else {
        layer.lineScroll[p++] = b0;
      }
      if (f.eof()) break;
    }
    for (let y = 0; y < layer.ysize; ++y) {
      for (let x = 0; x < layer.xsize; ++x) {
        const hi2 = f.u8();
        layer.tiles[y * 0x100 + x] = (hi2 << 8) + f.u8();
      }
    }
  }
}

export function LoadStageChunks(E: Engine3): void {
  const data = E.vfs.get(stagePath(E, "128x128Tiles.bin"));
  if (!data) return;
  const f = new FileReader(data);
  const t = E.tiles128x128;
  for (let i = 0; i < C.CHUNKTILE_COUNT; ++i) {
    let e0 = f.u8();
    const e1 = f.u8();
    const e2 = f.u8();
    e0 -= (e0 >> 6) << 6;
    t.visualPlane[i] = e0 >> 4;
    e0 -= 16 * (e0 >> 4);
    t.direction[i] = e0 >> 2;
    e0 -= 4 * (e0 >> 2);
    t.tileIndex[i] = e1 + (e0 << 8);
    t.gfxDataPos[i] = t.tileIndex[i] << 8;
    t.collisionFlags[0][i] = e2 >> 4;
    t.collisionFlags[1][i] = e2 - ((e2 >> 4) << 4);
  }
}

export function LoadStageCollisions(E: Engine3): void {
  const data = E.vfs.get(stagePath(E, "CollisionMasks.bin"));
  if (!data) return;
  const f = new FileReader(data);
  const TS = C.TILE_SIZE;
  let tileIndex = 0;
  for (let t = 0; t < 1024; ++t) {
    for (let p = 0; p < 2; ++p) {
      const cm = E.collisionMasks[p];
      let b = f.u8();
      const isCeiling = b >> 4;
      cm.flags[t] = b & 0xf;
      const a0 = f.u8(), a1 = f.u8(), a2 = f.u8(), a3 = f.u8();
      cm.angles[t] = (a0 + (a1 << 8) + (a2 << 16) + (a3 << 24)) >>> 0;
      if (isCeiling) {
        for (let c = 0; c < TS; c += 2) {
          b = f.u8();
          cm.roofMasks[c + tileIndex] = b >> 4;
          cm.roofMasks[c + tileIndex + 1] = b & 0xf;
        }
        b = f.u8();
        let id = 1;
        for (let c = 0; c < TS / 2; ++c) {
          if (b & id) cm.floorMasks[c + tileIndex + 8] = 0;
          else {
            cm.floorMasks[c + tileIndex + 8] = 0x40;
            cm.roofMasks[c + tileIndex + 8] = -0x40;
          }
          id <<= 1;
        }
        b = f.u8();
        id = 1;
        for (let c = 0; c < TS / 2; ++c) {
          if (b & id) cm.floorMasks[c + tileIndex] = 0;
          else {
            cm.floorMasks[c + tileIndex] = 0x40;
            cm.roofMasks[c + tileIndex] = -0x40;
          }
          id <<= 1;
        }
        for (let c = 0; c < TS; ++c) {
          let h = 0;
          while (h > -1) {
            if (h >= TS) {
              cm.lWallMasks[c + tileIndex] = 0x40;
              h = -1;
            } else if (c > cm.roofMasks[h + tileIndex]) ++h;
            else {
              cm.lWallMasks[c + tileIndex] = h;
              h = -1;
            }
          }
        }
        for (let c = 0; c < TS; ++c) {
          let h = TS - 1;
          while (h < TS) {
            if (h <= -1) {
              cm.rWallMasks[c + tileIndex] = -0x40;
              h = TS;
            } else if (c > cm.roofMasks[h + tileIndex]) --h;
            else {
              cm.rWallMasks[c + tileIndex] = h;
              h = TS;
            }
          }
        }
      } else {
        for (let c = 0; c < TS; c += 2) {
          b = f.u8();
          cm.floorMasks[c + tileIndex] = b >> 4;
          cm.floorMasks[c + tileIndex + 1] = b & 0xf;
        }
        b = f.u8();
        let id = 1;
        for (let c = 0; c < TS / 2; ++c) {
          if (b & id) cm.roofMasks[c + tileIndex + 8] = 0xf;
          else {
            cm.floorMasks[c + tileIndex + 8] = 0x40;
            cm.roofMasks[c + tileIndex + 8] = -0x40;
          }
          id <<= 1;
        }
        b = f.u8();
        id = 1;
        for (let c = 0; c < TS / 2; ++c) {
          if (b & id) cm.roofMasks[c + tileIndex] = 0xf;
          else {
            cm.floorMasks[c + tileIndex] = 0x40;
            cm.roofMasks[c + tileIndex] = -0x40;
          }
          id <<= 1;
        }
        for (let c = 0; c < TS; ++c) {
          let h = 0;
          while (h > -1) {
            if (h >= TS) {
              cm.lWallMasks[c + tileIndex] = 0x40;
              h = -1;
            } else if (c < cm.floorMasks[h + tileIndex]) ++h;
            else {
              cm.lWallMasks[c + tileIndex] = h;
              h = -1;
            }
          }
        }
        for (let c = 0; c < TS; ++c) {
          let h = TS - 1;
          while (h < TS) {
            if (h <= -1) {
              cm.rWallMasks[c + tileIndex] = -0x40;
              h = TS;
            } else if (c < cm.floorMasks[h + tileIndex]) --h;
            else {
              cm.rWallMasks[c + tileIndex] = h;
              h = TS;
            }
          }
        }
      }
    }
    tileIndex += 16;
  }
}

export function LoadStageGIFFile(E: Engine3): void {
  const data = E.vfs.get(stagePath(E, "16x16Tiles.gif"));
  if (!data) return;
  const f = new FileReader(data);
  f.pos = 6;
  const width = f.u16();
  const height = f.u16();
  let paletteSize = (f.u8() & 0x7) + 1;
  paletteSize = 1 << paletteSize;
  f.u8();
  f.u8();
  if (paletteSize === 256) {
    for (let c = 0; c < 0x80; ++c) f.skip(3);
    for (let c = 0x80; c < 0x100; ++c) {
      const r = f.u8(), g = f.u8(), b = f.u8();
      SetPaletteEntry(E, 0xff, c, r, g, b);
    }
  }
  let b = f.u8();
  while (b !== 0x2c && !f.eof()) b = f.u8();
  f.skip(8);
  b = f.u8();
  const interlaced = ((b & 0x40) >> 6) === 1;
  if (b >> 7 === 1) f.skip(0x80 * 3);
  if (E.opts.headless) return;
  ReadGifPictureData(f, width, height, interlaced, E.tilesetGFXData, 0);
  const transparent = E.tilesetGFXData[0];
  for (let i = 0; i < 0x40000; ++i) if (E.tilesetGFXData[i] === transparent) E.tilesetGFXData[i] = 0;
}

export function LoadStageGFXFile(E: Engine3): void {
  const data = E.vfs.get(stagePath(E, "16x16Tiles.gfx"));
  if (!data) return;
  const f = new FileReader(data);
  f.skip(4); // width, height
  for (let i = 0; i < 0x80; ++i) f.skip(3);
  for (let c = 0x80; c < 0x100; ++c) {
    const r = f.u8(), g = f.u8(), b = f.u8();
    SetPaletteEntry(E, 0xff, c, r, g, b);
  }
  if (E.opts.headless) return;
  let p = 0;
  for (;;) {
    const b0 = f.u8();
    if (b0 === 0xff) {
      const b1 = f.u8();
      if (b1 === 0xff) break;
      const n = f.u8();
      for (let i = 0; i < n; ++i) E.tilesetGFXData[p++] = b1;
    } else E.tilesetGFXData[p++] = b0;
    if (f.eof()) break;
  }
  const transparent = E.tilesetGFXData[0];
  for (let i = 0; i < 0x40000; ++i) if (E.tilesetGFXData[i] === transparent) E.tilesetGFXData[i] = 0;
}

export function Init3DFloorBuffer(E: Engine3, layerID: number): void {
  const tiles = E.stageLayouts[layerID].tiles;
  for (let y = 0; y < C.TILELAYER_CHUNK_H; ++y) {
    for (let x = 0; x < C.TILELAYER_CHUNK_W; ++x) {
      const c = tiles[(x >> 3) + ((y >> 3) << 8)] << 6;
      E.tile3DFloorBuffer[x + (y << 8)] = c + (x & 7) + ((y & 7) << 3);
    }
  }
}

export function Copy16x16Tile(E: Engine3, dest: number, src: number): void {
  dest &= 0xffff;
  src &= 0xffff;
  const d = C.TILELAYER_CHUNK_W * dest, s = C.TILELAYER_CHUNK_W * src;
  E.tilesetGFXData.copyWithin(d, s, s + C.TILE_DATASIZE);
}

export function ResetBackgroundSettings(E: Engine3): void {
  for (let i = 0; i < C.LAYER_COUNT; ++i) {
    E.stageLayouts[i].deformationOffset = 0;
    E.stageLayouts[i].deformationOffsetW = 0;
    E.stageLayouts[i].scrollPos = 0;
  }
  E.hParallax.scrollPos.fill(0);
  E.vParallax.scrollPos.fill(0);
  E.bgDeformationData0.fill(0);
  E.bgDeformationData1.fill(0);
  E.bgDeformationData2.fill(0);
  E.bgDeformationData3.fill(0);
}

export function SetLayerDeformation(E: Engine3, selectedDef: number, waveLength: number, waveWidth: number, waveType: number, YPos: number, waveSize: number): void {
  const deform = [E.bgDeformationData0, E.bgDeformationData1, E.bgDeformationData2, E.bgDeformationData3][selectedDef];
  if (!deform || waveLength === 0) return;
  const shift = 9;
  let id = 0;
  if (waveType === 1) {
    id = YPos;
    for (let i = 0; i < waveSize; ++i) {
      deform[id] = Math.imul(waveWidth, sin512LookupTable[(((i << 9) / waveLength) | 0) & 0x1ff]) >> shift;
      ++id;
    }
  } else {
    for (let i = 0; i < 0x200 * 0x100; i += 0x200) {
      deform[id] = Math.imul(waveWidth, sin512LookupTable[((i / waveLength) | 0) & 0x1ff]) >> shift;
      if (deform[id] >= waveWidth) deform[id] = waveWidth - 1;
      ++id;
    }
  }
  for (let i = C.DEFORM_STORE; i < C.DEFORM_COUNT; ++i) deform[i] = deform[i - C.DEFORM_STORE];
}

// ---- camera ----------------------------------------------------------------------------------------------------

function updateYBoundaries(E: Engine3): void {
  if (E.newYBoundary1 > E.yBoundary1) {
    if (E.yScrollOffset <= E.newYBoundary1) E.yBoundary1 = E.yScrollOffset;
    else E.yBoundary1 = E.newYBoundary1;
  }
  if (E.newYBoundary1 < E.yBoundary1) {
    if (E.yScrollOffset <= E.yBoundary1) --E.yBoundary1;
    else E.yBoundary1 = E.newYBoundary1;
  }
  if (E.newYBoundary2 < E.yBoundary2) {
    if (E.yScrollOffset + C.SCREEN_YSIZE >= E.yBoundary2 || E.yScrollOffset + C.SCREEN_YSIZE <= E.newYBoundary2) --E.yBoundary2;
    else E.yBoundary2 = E.yScrollOffset + C.SCREEN_YSIZE;
  }
  if (E.newYBoundary2 > E.yBoundary2) {
    if (E.yScrollOffset + C.SCREEN_YSIZE >= E.yBoundary2) ++E.yBoundary2;
    else E.yBoundary2 = E.newYBoundary2;
  }
}

function updateXBoundaries(E: Engine3, player: Player3): void {
  if (E.newXBoundary1 > E.xBoundary1) {
    if (E.xScrollOffset <= E.newXBoundary1) E.xBoundary1 = E.xScrollOffset;
    else E.xBoundary1 = E.newXBoundary1;
  }
  if (E.newXBoundary1 < E.xBoundary1) {
    if (E.xScrollOffset <= E.xBoundary1) {
      --E.xBoundary1;
      if (player.xvel < 0) {
        E.xBoundary1 += player.xvel >> 16;
        if (E.xBoundary1 < E.newXBoundary1) E.xBoundary1 = E.newXBoundary1;
      }
    } else E.xBoundary1 = E.newXBoundary1;
  }
  if (E.newXBoundary2 < E.xBoundary2) {
    if (E.SCREEN_XSIZE + E.xScrollOffset >= E.xBoundary2) E.xBoundary2 = E.SCREEN_XSIZE + E.xScrollOffset;
    else E.xBoundary2 = E.newXBoundary2;
  }
  if (E.newXBoundary2 > E.xBoundary2) {
    if (E.SCREEN_XSIZE + E.xScrollOffset >= E.xBoundary2) {
      ++E.xBoundary2;
      if (player.xvel > 0) {
        E.xBoundary2 += player.xvel >> 16;
        if (E.xBoundary2 > E.newXBoundary2) E.xBoundary2 = E.newXBoundary2;
      }
    } else E.xBoundary2 = E.newXBoundary2;
  }
}

function updateYScrollMove(E: Engine3, player: Player3, trackIsOne: boolean): void {
  if (trackIsOne ? player.trackScroll === 1 : player.trackScroll) {
    E.yScrollMove = 32;
  } else {
    if (E.yScrollMove === 32) {
      E.yScrollMove = 2 * ((SCREEN_SCROLL_UP - player.screenYPos - player.lookPos) >> 1);
      if (E.yScrollMove > 32) E.yScrollMove = 32;
      if (E.yScrollMove < -32) E.yScrollMove = -32;
    }
    if (E.yScrollMove > 0) E.yScrollMove -= 6;
    E.yScrollMove += E.yScrollMove < 0 ? 6 : 0;
  }
}

/** The vertical half shared by every camera style except the locked one. */
function followY(E: Engine3, player: Player3, adjustY: number, trackIsOne: boolean): void {
  let yscrollA = E.yScrollA;
  let yscrollB = E.yScrollB;
  const adjustAmount = player.lookPos + adjustY - (yscrollA + SCREEN_SCROLL_UP);
  updateYScrollMove(E, player, trackIsOne);
  if (abs(adjustAmount) >= abs(E.yScrollMove) + 17) {
    if (adjustAmount <= 0) yscrollA -= 16;
    else yscrollA += 16;
    yscrollB = yscrollA + C.SCREEN_YSIZE;
  } else if (E.yScrollMove === 32) {
    if (player.lookPos + adjustY > yscrollA + E.yScrollMove + SCREEN_SCROLL_UP) {
      yscrollA = player.lookPos + adjustY - (E.yScrollMove + SCREEN_SCROLL_UP);
      yscrollB = yscrollA + C.SCREEN_YSIZE;
    }
    if (player.lookPos + adjustY < yscrollA + SCREEN_SCROLL_UP - E.yScrollMove) {
      yscrollA = player.lookPos + adjustY - (SCREEN_SCROLL_UP - E.yScrollMove);
      yscrollB = yscrollA + C.SCREEN_YSIZE;
    }
  } else {
    yscrollA = player.lookPos + adjustY + E.yScrollMove - SCREEN_SCROLL_UP;
    yscrollB = yscrollA + C.SCREEN_YSIZE;
  }
  if (yscrollA < E.yBoundary1) {
    yscrollA = E.yBoundary1;
    yscrollB = E.yBoundary1 + C.SCREEN_YSIZE;
  }
  if (yscrollB > E.yBoundary2) {
    yscrollB = E.yBoundary2;
    yscrollA = E.yBoundary2 - C.SCREEN_YSIZE;
  }
  E.yScrollA = yscrollA;
  E.yScrollB = yscrollB;
  placeY(E, player, adjustY);
}

function placeY(E: Engine3, player: Player3, adjustY: number): void {
  if (player.lookPos + adjustY <= E.yScrollA + SCREEN_SCROLL_UP) {
    player.screenYPos = adjustY - E.yScrollA - E.cameraShakeY;
    E.yScrollOffset = E.cameraShakeY + E.yScrollA;
  } else {
    E.yScrollOffset = E.cameraShakeY + adjustY + player.lookPos - SCREEN_SCROLL_UP;
    player.screenYPos = SCREEN_SCROLL_UP - player.lookPos - E.cameraShakeY;
    if (player.lookPos + adjustY > E.yScrollB - SCREEN_SCROLL_DOWN) {
      player.screenYPos = adjustY - (E.yScrollB - SCREEN_SCROLL_DOWN) + E.cameraShakeY + SCREEN_SCROLL_UP;
      E.yScrollOffset = E.yScrollB - C.SCREEN_YSIZE - E.cameraShakeY;
    }
  }
  player.screenYPos -= E.cameraAdjustY;
}

function placeXFromScroll(E: Engine3, player: Player3, playerXPos: number, xscrollA: number, xscrollB: number): void {
  if (playerXPos <= E.SCREEN_CENTERX + xscrollA) {
    player.screenXPos = E.cameraShakeX + playerXPos - xscrollA;
    E.xScrollOffset = xscrollA - E.cameraShakeX;
  } else {
    E.xScrollOffset = E.cameraShakeX + playerXPos - E.SCREEN_CENTERX;
    player.screenXPos = E.SCREEN_CENTERX - E.cameraShakeX;
    if (playerXPos > xscrollB - E.SCREEN_CENTERX) {
      player.screenXPos = E.cameraShakeX + E.SCREEN_CENTERX + playerXPos - (xscrollB - E.SCREEN_CENTERX);
      E.xScrollOffset = xscrollB - E.SCREEN_XSIZE - E.cameraShakeX;
    }
  }
}

function flipShake(E: Engine3): void {
  if (E.cameraShakeX) E.cameraShakeX = E.cameraShakeX <= 0 ? ~E.cameraShakeX : -E.cameraShakeX;
  if (E.cameraShakeY) E.cameraShakeY = E.cameraShakeY <= 0 ? ~E.cameraShakeY : -E.cameraShakeY;
}

export function SetPlayerScreenPosition(E: Engine3, player: Player3): void {
  const playerXPos = player.xpos >> 16;
  const playerYPos = player.ypos >> 16;
  updateYBoundaries(E);
  updateXBoundaries(E, player);
  let xscrollA = E.xScrollA;
  let xscrollB = E.xScrollB;
  const scrollAmount = playerXPos - (E.SCREEN_CENTERX + E.xScrollA);
  if (abs(scrollAmount) >= 25) {
    if (scrollAmount <= 0) xscrollA -= 16;
    else xscrollA += 16;
    xscrollB = E.SCREEN_XSIZE + xscrollA;
  } else {
    if (playerXPos > E.SCREEN_SCROLL_RIGHT + xscrollA) {
      xscrollA = playerXPos - E.SCREEN_SCROLL_RIGHT;
      xscrollB = E.SCREEN_XSIZE + playerXPos - E.SCREEN_SCROLL_RIGHT;
    }
    if (playerXPos < E.SCREEN_SCROLL_LEFT + xscrollA) {
      xscrollA = playerXPos - E.SCREEN_SCROLL_LEFT;
      xscrollB = E.SCREEN_XSIZE + playerXPos - E.SCREEN_SCROLL_LEFT;
    }
  }
  if (xscrollA < E.xBoundary1) {
    xscrollA = E.xBoundary1;
    xscrollB = E.SCREEN_XSIZE + E.xBoundary1;
  }
  if (xscrollB > E.xBoundary2) {
    xscrollB = E.xBoundary2;
    xscrollA = E.xBoundary2 - E.SCREEN_XSIZE;
  }
  E.xScrollA = xscrollA;
  E.xScrollB = xscrollB;
  placeXFromScroll(E, player, playerXPos, xscrollA, xscrollB);
  followY(E, player, E.cameraAdjustY + playerYPos, false);
  flipShake(E);
}

export function SetPlayerScreenPositionCDStyle(E: Engine3, player: Player3): void {
  const playerXPos = player.xpos >> 16;
  const playerYPos = player.ypos >> 16;
  updateYBoundaries(E);
  updateXBoundaries(E, player);
  if (!player.gravity) {
    if (E.objectEntityList[player.boundEntity].direction) {
      E.cameraLagStyle = E.cameraStyle === C.CAMERASTYLE_EXTENDED_OFFSET_R || player.speed < -0x5f5c2 ? 2 : 0;
    } else {
      E.cameraLagStyle = +(E.cameraStyle === C.CAMERASTYLE_EXTENDED_OFFSET_L || player.speed > 0x5f5c2);
    }
  }
  if (E.cameraLagStyle) {
    if (E.cameraLagStyle === 1) {
      if (E.cameraLag > -64) E.cameraLag -= 2;
    } else if (E.cameraLagStyle === 2 && E.cameraLag < 64) {
      E.cameraLag += 2;
    }
  } else {
    E.cameraLag += E.cameraLag < 0 ? 2 : 0;
    if (E.cameraLag > 0) E.cameraLag -= 2;
  }
  if (playerXPos <= E.cameraLag + E.SCREEN_CENTERX + E.xBoundary1) {
    player.screenXPos = E.cameraShakeX + playerXPos - E.xBoundary1;
    E.xScrollOffset = E.xBoundary1 - E.cameraShakeX;
  } else {
    E.xScrollOffset = E.cameraShakeX + playerXPos - E.SCREEN_CENTERX - E.cameraLag;
    player.screenXPos = E.cameraLag + E.SCREEN_CENTERX - E.cameraShakeX;
    if (playerXPos - E.cameraLag > E.xBoundary2 - E.SCREEN_CENTERX) {
      player.screenXPos = E.cameraShakeX + E.SCREEN_CENTERX + playerXPos - (E.xBoundary2 - E.SCREEN_CENTERX);
      E.xScrollOffset = E.xBoundary2 - E.SCREEN_XSIZE - E.cameraShakeX;
    }
  }
  E.xScrollA = E.xScrollOffset;
  E.xScrollB = E.SCREEN_XSIZE + E.xScrollOffset;
  followY(E, player, E.cameraAdjustY + playerYPos, true);
  flipShake(E);
}

export function SetPlayerHLockedScreenPosition(E: Engine3, player: Player3): void {
  const playerXPos = player.xpos >> 16;
  const playerYPos = player.ypos >> 16;
  updateYBoundaries(E);
  placeXFromScroll(E, player, playerXPos, E.xScrollA, E.xScrollB);
  followY(E, player, E.cameraAdjustY + playerYPos, true);
  flipShake(E);
}

export function SetPlayerLockedScreenPosition(E: Engine3, player: Player3): void {
  const playerXPos = player.xpos >> 16;
  const playerYPos = player.ypos >> 16;
  placeXFromScroll(E, player, playerXPos, E.xScrollA, E.xScrollB);
  placeY(E, player, E.cameraAdjustY + playerYPos);
  flipShake(E);
}

function updateCameras(E: Engine3): void {
  const n = Math.max(1, E.camCount);
  for (let c = 0; c < n; c++) {
    E.setCamera(c);
    if (E.cameraTarget <= -1) continue;
    const target = E.playerList[E.cameraTarget];
    if (!target) continue;
    if (E.cameraEnabled === 1) {
      switch (E.cameraStyle) {
        case C.CAMERASTYLE_FOLLOW: SetPlayerScreenPosition(E, target); break;
        case C.CAMERASTYLE_EXTENDED:
        case C.CAMERASTYLE_EXTENDED_OFFSET_L:
        case C.CAMERASTYLE_EXTENDED_OFFSET_R: SetPlayerScreenPositionCDStyle(E, target); break;
        case C.CAMERASTYLE_HLOCKED: SetPlayerHLockedScreenPosition(E, target); break;
      }
    } else {
      SetPlayerLockedScreenPosition(E, target);
    }
  }
  E.setCamera(0);
}

function resetCameras(E: Engine3): void {
  for (let c = 0; c < C.PLAYER_COUNT; c++) {
    E.setCamera(c);
    E.cameraEnabled = 1;
    E.cameraTarget = -1;
    E.cameraAdjustY = 0;
    E.xScrollOffset = 0;
    E.yScrollOffset = 0;
    E.yScrollA = 0;
    E.yScrollB = C.SCREEN_YSIZE;
    E.xScrollA = 0;
    E.xScrollB = E.SCREEN_XSIZE;
    E.yScrollMove = 0;
    E.cameraShakeX = 0;
    E.cameraShakeY = 0;
  }
  E.setCamera(0);
}

// ---- draw-time state and draw scripts --------------------------------------------------------------------------

/** DrawHLineScrollLayer / DrawVLineScrollLayer's state changes, for one active layer slot (current camera). */
function stepLayer(E: Engine3, layerID: number): void {
  const id = E.activeTileLayers[layerID];
  const layer = E.stageLayouts[id];
  if (layer.type === C.LAYER_HSCROLL) {
    if (id) {
      const fullheight = layer.ysize << 7;
      layer.scrollPos += layer.scrollSpeed;
      if (layer.scrollPos > fullheight << 16) layer.scrollPos -= fullheight << 16;
    } else {
      E.lastXSize = layer.xsize;
      E.hParallax.linePos.fill(E.xScrollOffset);
    }
    if (E.lastXSize !== layer.xsize) {
      const full = layer.xsize << 7;
      const hp = E.hParallax;
      for (let i = 0; i < hp.entryCount; ++i) {
        hp.linePos[i] = Math.imul(E.xScrollOffset, hp.parallaxFactor[i]) >> 8;
        hp.scrollPos[i] += hp.scrollSpeed[i];
        if (hp.scrollPos[i] > full << 16) hp.scrollPos[i] -= full << 16;
        if (hp.scrollPos[i] < 0) hp.scrollPos[i] += full << 16;
        hp.linePos[i] += hp.scrollPos[i] >> 16;
        hp.linePos[i] %= full;
      }
    }
    E.lastXSize = layer.xsize;
  } else if (layer.type === C.LAYER_VSCROLL) {
    if (!layer.xsize || !layer.ysize) return;
    if (id) {
      const fullwidth = layer.xsize << 7;
      layer.scrollPos += layer.scrollSpeed;
      if (layer.scrollPos > fullwidth << 16) layer.scrollPos -= fullwidth << 16;
    } else {
      E.lastYSize = layer.ysize;
      E.vParallax.linePos[0] = E.yScrollOffset;
      E.vParallax.deform[0] = 1;
    }
    if (E.lastYSize !== layer.ysize) {
      const full = layer.ysize << 7;
      const vp = E.vParallax;
      for (let i = 0; i < vp.entryCount; ++i) {
        vp.linePos[i] = Math.imul(E.yScrollOffset, vp.parallaxFactor[i]) >> 8;
        vp.scrollPos[i] += vp.scrollSpeed[i];
        vp.scrollPos[i] += vp.scrollPos[i] << 16; // sic
        if (vp.scrollPos[i] > full << 16) vp.scrollPos[i] -= full << 16;
        vp.linePos[i] += vp.scrollPos[i] >> 16;
        vp.linePos[i] %= full;
      }
    }
    E.lastYSize = layer.ysize;
  }
}

/** Runs one draw list's draw scripts (DrawObjectList); `camera` is the camera drawn, or null when headless. */
export function DrawObjectList(E: Engine3, list: number, camera: number | null): void {
  const l = E.drawListEntries[list];
  const size = l.listSize;
  for (let i = 0; i < size; ++i) {
    E.objectLoop = l.entityRefs[i];
    const type = E.objectEntityList[E.objectLoop].type;
    if (!type) continue;
    E.activePlayer = 0;
    const s = E.objectScriptList[type];
    if (E.scriptCode[s.subDraw.scriptCodePtr] > 0) {
      E.setCamera(camera ?? cameraForEntity(E, E.objectLoop));
      ProcessScript(E, s.subDraw.scriptCodePtr, s.subDraw.jumpTablePtr, C.SUB_DRAW);
    }
  }
}

/**
 * DrawStageGFX for the current camera: the water line, the layers' state changes and every draw list. With a
 * renderer this draws the frame; headless it only runs what changes state.
 */
function DrawStage(E: Engine3, viewCamera: number): void {
  E.setCamera(viewCamera);
  E.waterDrawPos = E.waterLevel - E.yScrollOffset;
  if (E.waterDrawPos < 0) E.waterDrawPos = 0;
  if (E.waterDrawPos > C.SCREEN_YSIZE) E.waterDrawPos = C.SCREEN_YSIZE;
  if (E.draw) {
    E.draw.DrawStageGFX(E);
  } else {
    const order: (number | [number])[] = [0, [0], 1, [1], 2, [2], 3, 4, [3], 5];
    for (const o of order) {
      if (Array.isArray(o)) {
        if (E.activeTileLayers[o[0]] < C.LAYER_COUNT) stepLayer(E, o[0]);
      } else DrawObjectList(E, o, null);
    }
    if (E.usingOrigins) DrawObjectList(E, 7, null);
    DrawObjectList(E, 6, null);
  }
  E.setCamera(0);
}

/** For the renderer: the state change of an H/V scroll layer, made just before drawing it. */
export function StepLayerForDraw(E: Engine3, layerID: number): void {
  stepLayer(E, layerID);
}

// ---- the stage loop --------------------------------------------------------------------------------------------

function tickTimer(E: Engine3): void {
  if (E.timeEnabled) {
    if (++E.frameCounter === 60) {
      E.frameCounter = 0;
      if (++E.stageSeconds > 59) {
        E.stageSeconds = 0;
        if (++E.stageMinutes > 59) E.stageMinutes = 0;
      }
    }
    E.stageMilliseconds = ((100 * E.frameCounter) / 60) | 0;
  } else {
    E.frameCounter = ((60 * E.stageMilliseconds) / 100) | 0;
  }
}

/** One frame of the stage (ProcessStage), including the draw pass. `viewCamera` is the camera this engine renders. */
export function ProcessStage(E: Engine3, viewCamera: number): void {
  switch (E.stageMode) {
    case C.STAGEMODE_LOAD:
      E.fadeMode = 0;
      SetActivePalette(E, 0, 0, 256);
      resetCameras(E);
      E.vertexCount = 0;
      E.faceCount = 0;
      for (const p of E.playerList) {
        p.xpos = 0;
        p.ypos = 0;
        p.xvel = 0;
        p.yvel = 0;
        p.angle = 0;
        p.visible = 1;
        p.collisionPlane = 0;
        p.collisionMode = 0;
        p.gravity = 1;
        p.speed = 0;
        p.tileCollisions = 1;
        p.objectInteractions = 1;
        p.values.fill(0);
      }
      E.pauseEnabled = 0;
      E.timeEnabled = 0;
      E.frameCounter = 0;
      E.stageMilliseconds = 0;
      E.stageSeconds = 0;
      E.stageMinutes = 0;
      E.frameCount = 0;
      E.stageMode = C.STAGEMODE_NORMAL;
      ResetBackgroundSettings(E);
      LoadStageFiles(E);
      E.stageLoadCount++;
      break;

    case C.STAGEMODE_NORMAL:
      if (E.fadeMode > 0) E.fadeMode--;
      if (E.paletteMode > 0) {
        E.paletteMode = 0;
        SetActivePalette(E, 0, 0, 256);
      }
      E.lastXSize = -1;
      E.lastYSize = -1;
      SetGlobalVariableByName(E, "input.pressButton", E.anyPress); // CheckKeyPress
      if (E.pauseEnabled && E.keyPress & BTN.START) {
        E.stageMode = C.STAGEMODE_PAUSED;
        PauseSound(E);
      }
      tickTimer(E);
      ProcessObjects(E);
      updateCameras(E);
      DrawStage(E, viewCamera);
      break;

    case C.STAGEMODE_PAUSED:
      if (E.fadeMode > 0) E.fadeMode--;
      if (E.paletteMode > 0) {
        E.paletteMode = 0;
        SetActivePalette(E, 0, 0, 256);
      }
      E.lastXSize = -1;
      E.lastYSize = -1;
      SetGlobalVariableByName(E, "input.pressButton", E.anyPress); // CheckKeyPress
      ProcessPausedObjects(E);
      if (E.draw) {
        E.setCamera(viewCamera);
        E.draw.DrawObjectLists(E);
        E.setCamera(0);
      } else {
        for (const l of [0, 1, 2, 3, 4, 5]) DrawObjectList(E, l, null);
        if (E.usingOrigins) DrawObjectList(E, 7, null);
        DrawObjectList(E, 6, null);
      }
      if (E.pauseEnabled && E.keyPress & BTN.START) {
        E.stageMode = C.STAGEMODE_NORMAL;
        ResumeSound(E);
      }
      break;
  }
  E.frameCount++;
}
