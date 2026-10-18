// Scene.cpp: stage loading and the stage loop (ProcessStage), with one camera per player.

import type { Engine } from "./engine.js";
import { CAM_STRIDE } from "./engine.js";
import { FileReader } from "./core/reader.js";
import {
  STAGEMODE_LOAD, STAGEMODE_NORMAL, STAGEMODE_PAUSED, STAGEMODE_FROZEN, STAGEMODE_2P, STAGEMODE_NORMAL_STEP, STAGEMODE_PAUSED_STEP,
  STAGEMODE_FROZEN_STEP, STAGEMODE_2P_STEP, CAMERASTYLE_FOLLOW, CAMERASTYLE_EXTENDED, CAMERASTYLE_EXTENDED_OFFSET_L,
  CAMERASTYLE_EXTENDED_OFFSET_R, CAMERASTYLE_HLOCKED, LAYER_COUNT, LAYER_NOSCROLL, LAYER_HSCROLL, PARALLAX_COUNT, DEFORM_COUNT,
  DEFORM_STORE, DEFORM_FG, DEFORM_FG_WATER, DEFORM_BG, DEFORM_BG_WATER, ENTITY_COUNT, CHUNKTILE_COUNT, TILE_COUNT, TILE_SIZE,
  TILESET_SIZE, TILELAYER_CHUNK_H, LAYER_VSCROLL, SURFACE_COUNT, OBJECT_COUNT, TRACK_COUNT, EVENT_DRAW, SCREEN_YSIZE, ENGINE_MAINGAME,
  JUMPTABLE_COUNT, SCRIPTCODE_COUNT, FUNCTION_COUNT,
} from "./c.js";
import { sin512LookupTable } from "./math.js";
import { SetActivePalette, SetPaletteEntry } from "./palette.js";
import { ProcessObjects, ProcessPausedObjects, ProcessFrozenObjects, Process2PObjects, ProcessStartupObjects, cameraForEntity } from "./object.js";
import { ProcessScript } from "./script/vm.js";
import { ScriptCompiler } from "./script/compiler.js";
import { ClearAnimationData } from "./animation.js";
import { RemoveGraphicsFile, ClearGraphicsData, readGifHeader, ReadGifPictureData } from "./sprite.js";
import * as Cam from "./camera.js";

// ---- camera ----------------------------------------------------------------------------------------------------

function resetCameras(E: Engine): void {
  for (let c = 0; c < E.cams.length / CAM_STRIDE; c++) {
    E.setCamera(c);
    E.cameraEnabled = 1;
    E.cameraTarget = -1;
    E.cameraShift = 0;
    E.cameraStyle = CAMERASTYLE_FOLLOW;
    E.cameraXPos = 0;
    E.cameraYPos = 0;
    E.cameraLockedY = 0;
    E.cameraAdjustY = 0;
    E.xScrollOffset = 0;
    E.yScrollOffset = 0;
    E.cameraShakeX = 0;
    E.cameraShakeY = 0;
  }
  E.setCamera(0);
}

function updateCameras(E: Engine): void {
  const n = Math.max(1, E.camCount);
  for (let c = 0; c < n; c++) {
    E.setCamera(c);
    if (E.cameraTarget > -1) {
      const target = E.objectEntityList[E.cameraTarget];
      if (E.cameraEnabled === 1) {
        switch (E.cameraStyle) {
          case CAMERASTYLE_FOLLOW: Cam.SetPlayerScreenPosition(E, target); break;
          case CAMERASTYLE_EXTENDED:
          case CAMERASTYLE_EXTENDED_OFFSET_L:
          case CAMERASTYLE_EXTENDED_OFFSET_R: Cam.SetPlayerScreenPositionCDStyle(E, target); break;
          case CAMERASTYLE_HLOCKED: Cam.SetPlayerHLockedScreenPosition(E, target); break;
          default: break;
        }
      } else {
        Cam.SetPlayerLockedScreenPosition(E, target);
      }
    }
  }
  E.setCamera(0);
}

// ---- the stage loop ----------------------------------------------------------------------------------------------

function tickTimer(E: Engine): void {
  if (E.timeEnabled) {
    if (++E.frameCounter === 60) {
      E.frameCounter = 0;
      if (++E.stageSeconds > 59) {
        E.stageSeconds = 0;
        if (++E.stageMinutes > 59) E.stageMinutes = 0;
      }
    }
    E.stageMilliseconds = Math.trunc((100 * E.frameCounter) / 60);
  } else {
    E.frameCounter = Math.trunc((60 * E.stageMilliseconds) / 100);
  }
}

/** Runs the object draw events in the order DrawStageGFX would, without drawing (headless engines). */
export function RunDrawScripts(E: Engine, camera: number | null): void {
  if (E.tLayerMidPoint >= 6) return;
  for (const layer of [0, 1, 2, 3, 4, 5, 7, 6]) DrawObjectList(E, layer, camera);
}

/** DrawObjectList: run the draw event of every entity in a draw list. camera = null: each sees its nearest camera. */
export function DrawObjectList(E: Engine, layer: number, camera: number | null): void {
  const list = E.drawListEntries[layer];
  const size = list.listSize;
  for (let i = 0; i < size; ++i) {
    E.objectEntityPos = list.entityRefs[i];
    const type = E.objectEntityList[E.objectEntityPos].type;
    if (type) {
      const s = E.objectScriptList[type];
      if (E.scriptCode[s.eventDraw.scriptCodePtr] > 0) {
        E.setCamera(camera ?? cameraForEntity(E, E.objectEntityPos));
        ProcessScript(E, s.eventDraw.scriptCodePtr, s.eventDraw.jumpTablePtr, EVENT_DRAW);
      }
    }
  }
}

/** One frame of the stage (ProcessStage), including the draw pass. `viewCamera` is the camera this engine renders. */
export function ProcessStage(E: Engine, viewCamera: number): void {
  E.debugHitboxCount = 0;
  switch (E.stageMode) {
    case STAGEMODE_LOAD:
      SetActivePalette(E, 0, 0, 256);
      E.gameMenu[0].visibleRowOffset = 0;
      E.gameMenu[1].alignment = 0;
      E.gameMenu[1].selectionCount = 0;
      E.fadeMode = 0;
      resetCameras(E);
      E.vertexCount = 0;
      E.faceCount = 0;
      E.frameCounter = 0;
      E.pauseEnabled = 0;
      E.timeEnabled = 0;
      E.stageMilliseconds = 0;
      E.stageSeconds = 0;
      E.stageMinutes = 0;
      E.stageMode = STAGEMODE_NORMAL;
      ResetBackgroundSettings(E);
      LoadStageFiles(E);
      E.stageLoadCount++;
      break;

    case STAGEMODE_NORMAL:
    case STAGEMODE_NORMAL_STEP:
    case STAGEMODE_2P:
    case STAGEMODE_2P_STEP:
      if (E.fadeMode > 0) E.fadeMode--;
      E.lastXSize = -1;
      E.lastYSize = -1;
      tickTimer(E);
      if (E.stageMode === STAGEMODE_2P || E.stageMode === STAGEMODE_2P_STEP) Process2PObjects(E);
      else ProcessObjects(E);
      updateCameras(E);
      ProcessParallaxAutoScroll(E);
      DrawStage(E, viewCamera);
      break;

    case STAGEMODE_PAUSED:
    case STAGEMODE_PAUSED_STEP:
      if (E.fadeMode > 0) E.fadeMode--;
      E.lastXSize = -1;
      E.lastYSize = -1;
      ProcessPausedObjects(E);
      if (E.draw) {
        E.setCamera(viewCamera);
        for (const l of [0, 1, 2, 3, 4, 5, 7, 6]) DrawObjectList(E, l, viewCamera);
      } else for (const l of [0, 1, 2, 3, 4, 5, 7, 6]) DrawObjectList(E, l, null);
      E.setCamera(0);
      break;

    case STAGEMODE_FROZEN:
    case STAGEMODE_FROZEN_STEP:
      if (E.fadeMode > 0) E.fadeMode--;
      E.lastXSize = -1;
      E.lastYSize = -1;
      ProcessFrozenObjects(E);
      updateCameras(E);
      DrawStage(E, viewCamera);
      break;
  }
}

/**
 * The state changes the original renderer makes while drawing tile layers (auto-scroll of background layers,
 * wrapping the parallax scroll positions). Done here so a headless engine stays in step with a drawing one.
 */
export function StepLayerScroll(E: Engine): void {
  if (E.tLayerMidPoint >= 6) return;
  for (let i = 0; i < 4; i++) {
    const id = E.activeTileLayers[i];
    if (id >= LAYER_COUNT) continue;
    const layer = E.stageLayouts[id];
    if (!layer.xsize || !layer.ysize) continue;
    if (layer.type === LAYER_HSCROLL) {
      if (id) {
        const fullheight = layer.ysize << 7;
        layer.scrollPos += layer.scrollSpeed;
        if (layer.scrollPos > fullheight << 16) layer.scrollPos -= fullheight << 16;
      } else E.lastXSize = layer.xsize;
      if (E.lastXSize !== layer.xsize) {
        const full = layer.xsize << 7;
        const hp = E.hParallax;
        for (let k = 0; k < hp.entryCount; ++k) {
          if (hp.scrollPos[k] > full << 16) hp.scrollPos[k] -= full << 16;
          if (hp.scrollPos[k] < 0) hp.scrollPos[k] += full << 16;
        }
      }
      E.lastXSize = id ? layer.xsize : -1;
    } else if (layer.type === LAYER_VSCROLL) {
      if (id) {
        const fullwidth = layer.xsize << 7;
        layer.scrollPos += layer.scrollSpeed;
        if (layer.scrollPos > fullwidth << 16) layer.scrollPos -= fullwidth << 16;
      } else E.lastYSize = layer.ysize;
    }
  }
}

function DrawStage(E: Engine, viewCamera: number): void {
  StepLayerScroll(E);
  if (E.draw) {
    E.setCamera(viewCamera);
    E.draw.DrawStageGFX(E);
  } else {
    RunDrawScripts(E, null);
  }
  E.setCamera(0);
}

export function ProcessParallaxAutoScroll(E: Engine): void {
  for (let i = 0; i < E.hParallax.entryCount; ++i) E.hParallax.scrollPos[i] += E.hParallax.scrollSpeed[i];
  for (let i = 0; i < E.vParallax.entryCount; ++i) E.vParallax.scrollPos[i] += E.vParallax.scrollSpeed[i];
}

export function ResetBackgroundSettings(E: Engine): void {
  for (let i = 0; i < LAYER_COUNT; ++i) {
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

export function SetLayerDeformation(E: Engine, selectedDef: number, waveLength: number, waveWidth: number, waveType: number, YPos: number, waveSize: number): void {
  const deform = [E.bgDeformationData0, E.bgDeformationData1, E.bgDeformationData2, E.bgDeformationData3][selectedDef];
  if (!deform || waveLength === 0) return;
  const shift = 9;
  let id = 0;
  if (waveType === 1) {
    id = YPos;
    for (let i = 0; i < waveSize; ++i) {
      if (id >= 0 && id < DEFORM_COUNT) deform[id] = Math.imul(waveWidth, sin512LookupTable[Math.trunc((i << 9) / waveLength) & 0x1ff]) >> shift;
      ++id;
    }
  } else {
    for (let i = 0; i < 0x200 * 0x100; i += 0x200) {
      const val = Math.imul(waveWidth, sin512LookupTable[Math.trunc(i / waveLength) & 0x1ff]) >> shift;
      deform[id] = val;
      if (deform[id] >= waveWidth) deform[id] = waveWidth - 1;
      ++id;
    }
  }
  if (selectedDef >= DEFORM_FG && selectedDef <= DEFORM_BG_WATER) for (let i = DEFORM_STORE; i < DEFORM_COUNT; ++i) deform[i] = deform[i - DEFORM_STORE];
}

// ---- loading -----------------------------------------------------------------------------------------------------

export function InitStartingStage(E: Engine, list: number, stage: number, player: number): void {
  resetCameras(E);
  E.host.stopMusic();
  E.fadeMode = 0;
  E.playerListPos = player;
  ClearGraphicsData(E);
  ClearAnimationData(E);
  E.currentStageFolder = "";
  E.activeStageList = list;
  E.activePaletteID = 0;
  E.stageMode = STAGEMODE_LOAD;
  E.gameMode = ENGINE_MAINGAME;
  E.stageListPosition = stage;
}

export function SetObjectTypeName(E: Engine, objectName: string, objectID: number): void {
  E.typeNames[objectID] = objectName.replace(/ /g, "");
}

export function SetSfxName(E: Engine, sfxName: string, sfxID: number): void {
  E.sfxNames[sfxID] = sfxName.replace(/ /g, "");
}

export function ClearScriptData(E: Engine): void {
  E.scriptCode.fill(0);
  E.jumpTable.fill(0);
  E.foreachStack.fill(-1);
  E.jumpTableStack.fill(0);
  E.functionStack.fill(0);
  E.scriptFrameCount = 0;
  E.compiler.reset();
  ClearAnimationData(E);
  for (let o = 0; o < OBJECT_COUNT; ++o) {
    const s = E.objectScriptList[o];
    s.eventUpdate.scriptCodePtr = SCRIPTCODE_COUNT - 1;
    s.eventUpdate.jumpTablePtr = JUMPTABLE_COUNT - 1;
    s.eventDraw.scriptCodePtr = SCRIPTCODE_COUNT - 1;
    s.eventDraw.jumpTablePtr = JUMPTABLE_COUNT - 1;
    s.eventStartup.scriptCodePtr = SCRIPTCODE_COUNT - 1;
    s.eventStartup.jumpTablePtr = JUMPTABLE_COUNT - 1;
    s.frameListOffset = 0;
    s.spriteSheetID = 0;
    s.animFile = E.animationFileList[0];
    E.typeNames[o] = "";
  }
  for (let s = E.globalSFXCount; s < E.globalSFXCount + E.stageSFXCount; ++s) E.sfxNames[s] = "";
  for (let f = 0; f < FUNCTION_COUNT; ++f) {
    E.scriptFunctionList[f].ptr.scriptCodePtr = SCRIPTCODE_COUNT - 1;
    E.scriptFunctionList[f].ptr.jumpTablePtr = JUMPTABLE_COUNT - 1;
  }
  SetObjectTypeName(E, "Blank Object", 0);
}

function stagePath(E: Engine, file: string): string {
  return `Data/Stages/${E.stageList[E.activeStageList][E.stageListPosition].folder}/${file}`;
}

export function LoadStageFiles(E: Engine): void {
  const stage = E.stageList[E.activeStageList][E.stageListPosition];
  if (!stage) throw new Error(`no stage ${E.activeStageList}:${E.stageListPosition}`);
  let scriptID = 1;
  E.host.stopAllSfx?.();
  if (E.currentStageFolder !== stage.folder) {
    E.currentStageFolder = stage.folder;
    E.host.log(`loading scene ${stage.folder} ${stage.name}`);
    E.host.releaseStageSfx?.();
    ClearScriptData(E);
    for (let i = SURFACE_COUNT; i > 0; i--) RemoveGraphicsFile(E, "", i - 1);

    const stageConfig = E.vfs.get(stagePath(E, "StageConfig.bin"));
    const loadGlobalScripts = stageConfig ? stageConfig[0] : 0;

    if (loadGlobalScripts) {
      const gc = E.gameConfig;
      for (let c = 0; c < 0x60; ++c) SetPaletteEntry(E, 0xff, c, gc.palette[c * 3], gc.palette[c * 3 + 1], gc.palette[c * 3 + 2]);
      gc.objectNames.forEach((n, i) => SetObjectTypeName(E, n, scriptID + i));
      for (const path of gc.scriptPaths) {
        E.compiler.ParseScriptFile(path, scriptID++);
        if (E.compiler.errors.length) return;
      }
    }

    if (stageConfig) {
      const f = new FileReader(stageConfig);
      f.u8();
      for (let i = 0x60; i < 0x80; ++i) {
        const r = f.u8(), g = f.u8(), b = f.u8();
        SetPaletteEntry(E, 0xff, i, r, g, b);
      }
      E.stageSFXCount = f.u8();
      const sfxNames: string[] = [];
      for (let i = 0; i < E.stageSFXCount; ++i) sfxNames.push(f.str());
      for (let i = 0; i < E.stageSFXCount; ++i) {
        SetSfxName(E, sfxNames[i], i + E.globalSFXCount);
        const path = f.str();
        E.sfxPaths[E.globalSFXCount + i] = path;
        E.host.loadSfx?.(E.globalSFXCount + i, path);
      }
      const stageObjectCount = f.u8();
      const names: string[] = [];
      for (let i = 0; i < stageObjectCount; ++i) names.push(f.str());
      names.forEach((n, i) => SetObjectTypeName(E, n, scriptID + i));
      for (let i = 0; i < stageObjectCount; ++i) {
        const path = f.str();
        E.compiler.ParseScriptFile(path, scriptID + i);
        if (E.compiler.errors.length) return;
      }
    }

    LoadStageGIFFile(E);
    LoadStageCollisions(E);
    LoadStageBackground(E);
  } else {
    E.host.log(`reloading scene ${stage.folder} ${stage.name}`);
  }
  LoadStageChunks(E);
  for (let i = 0; i < TRACK_COUNT; ++i) E.host.setMusicTrack("", i, false, 0);

  E.entityBuffer.fill(0, 0, ENTITY_COUNT * 96);
  for (let i = 0; i < ENTITY_COUNT; ++i) {
    const e = E.objectEntityList[i];
    e.drawOrder = 3;
    e.scale = 512;
    e.objectInteractions = 1;
    e.visible = 1;
    e.tileCollisions = 1;
  }
  LoadActLayout(E);
  Init3DFloorBuffer(E, 0);
  ProcessStartupObjects(E);
  E.loadedActKey = `${E.activeStageList}:${E.stageListPosition}`;
}

function LoadActLayout(E: Engine): void {
  E.activeTileLayers.fill(9);
  const stage = E.stageList[E.activeStageList][E.stageListPosition];
  const data = E.vfs.get(`Data/Stages/${stage.folder}/Act${stage.id}.bin`);
  E.actID = parseInt(stage.id, 10) || 0;
  if (data) {
    const f = new FileReader(data);
    const length = f.u8();
    E.titleCardWord2 = length;
    let title = "";
    for (let i = 0; i < length; ++i) {
      const c = f.u8();
      title += String.fromCharCode(c);
      if (c === 45) E.titleCardWord2 = i + 1;
    }
    E.titleCardText = title;
    for (let i = 0; i < 4; i++) E.activeTileLayers[i] = f.u8();
    E.tLayerMidPoint = f.u8();
    const L0 = E.stageLayouts[0];
    L0.xsize = f.u8();
    f.u8();
    L0.ysize = f.u8();
    f.u8();
    E.newXBoundary1 = 0;
    E.newYBoundary1 = 0;
    E.newXBoundary2 = L0.xsize << 7;
    E.newYBoundary2 = L0.ysize << 7;
    for (let c = 0; c < E.cams.length / CAM_STRIDE; c++) {
      E.setCamera(c);
      E.curXBoundary1 = 0;
      E.curYBoundary1 = 0;
      E.curXBoundary2 = L0.xsize << 7;
      E.curYBoundary2 = L0.ysize << 7;
    }
    E.setCamera(0);
    E.waterLevel = (L0.ysize << 7) + 128;
    L0.tiles.fill(0);
    L0.lineScroll.fill(0, 0, 0x7fff);
    for (let y = 0; y < L0.ysize; ++y) {
      for (let x = 0; x < L0.xsize; ++x) L0.tiles[y * TILELAYER_CHUNK_H + x] = f.u16();
    }
    const objectCount = f.u16();
    if (objectCount > 0x400) E.host.log(`WARNING: object count ${objectCount} exceeds the object limit`);
    let slot = 32;
    for (let i = 0; i < objectCount && slot < ENTITY_COUNT; ++i) {
      const o = E.objectEntityList[slot++];
      const attribs = f.u16();
      o.type = f.u8();
      o.propertyValue = f.u8();
      o.xpos = f.s32();
      o.ypos = f.s32();
      if (attribs & 0x1) o.state = f.s32();
      if (attribs & 0x2) o.direction = f.u8();
      if (attribs & 0x4) o.scale = f.s32();
      if (attribs & 0x8) o.rotation = f.s32();
      if (attribs & 0x10) o.drawOrder = f.u8();
      if (attribs & 0x20) o.priority = f.u8();
      if (attribs & 0x40) o.alpha = f.u8();
      if (attribs & 0x80) o.animation = f.u8();
      if (attribs & 0x100) o.animationSpeed = f.s32();
      if (attribs & 0x200) o.frame = f.u8();
      if (attribs & 0x400) o.inkEffect = f.u8();
      if (attribs & 0x800) o.values[0] = f.s32();
      if (attribs & 0x1000) o.values[1] = f.s32();
      if (attribs & 0x2000) o.values[2] = f.s32();
      if (attribs & 0x4000) o.values[3] = f.s32();
    }
  }
  E.stageLayouts[0].type = LAYER_HSCROLL;
}

function LoadStageBackground(E: Engine): void {
  for (let i = 0; i < LAYER_COUNT; ++i) {
    E.stageLayouts[i].type = LAYER_NOSCROLL;
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
      ls.parallaxFactor[i] = f.u16();
      ls.scrollSpeed[i] = f.u8() << 10;
      ls.scrollPos[i] = 0;
      ls.deform[i] = f.u8();
    }
  }
  for (let i = 1; i < layerCount + 1; ++i) {
    const L = E.stageLayouts[i];
    L.xsize = f.u8();
    f.u8();
    L.ysize = f.u8();
    f.u8();
    L.type = f.u8();
    L.parallaxFactor = f.u16();
    L.scrollSpeed = f.u8() << 10;
    L.scrollPos = 0;
    L.tiles.fill(0);
    L.lineScroll.fill(0, 0, 0x7fff);
    let lp = 0;
    for (;;) {
      const b0 = f.u8();
      if (b0 === 0xff) {
        const b1 = f.u8();
        if (b1 === 0xff) break;
        const cnt = f.u8() - 1;
        for (let c = 0; c < cnt; ++c) L.lineScroll[lp++] = b1;
      } else L.lineScroll[lp++] = b0;
      if (f.eof()) break;
    }
    for (let y = 0; y < L.ysize; ++y) for (let x = 0; x < L.xsize; ++x) L.tiles[y * TILELAYER_CHUNK_H + x] = f.u16();
  }
}

function LoadStageChunks(E: Engine): void {
  const data = E.vfs.get(stagePath(E, "128x128Tiles.bin"));
  if (!data) return;
  const t = E.tiles128x128;
  let p = 0;
  for (let i = 0; i < CHUNKTILE_COUNT; ++i) {
    let e0 = data[p++] ?? 0;
    const e1 = data[p++] ?? 0;
    const e2 = data[p++] ?? 0;
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

function LoadStageCollisions(E: Engine): void {
  const data = E.vfs.get(stagePath(E, "CollisionMasks.bin"));
  if (!data) return;
  const f = new FileReader(data);
  let tileIndex = 0;
  for (let t = 0; t < TILE_COUNT; ++t) {
    for (let p = 0; p < 2; ++p) {
      const m = E.collisionMasks[p];
      let fb = f.u8();
      const isCeiling = fb >> 4;
      m.flags[t] = fb & 0xf;
      m.angles[t] = (f.u8() | (f.u8() << 8) | (f.u8() << 16) | (f.u8() << 24)) >>> 0;
      if (isCeiling) {
        for (let c = 0; c < TILE_SIZE; c += 2) {
          fb = f.u8();
          m.roofMasks[c + tileIndex] = fb >> 4;
          m.roofMasks[c + tileIndex + 1] = fb & 0xf;
        }
        fb = f.u8();
        let id = 1;
        for (let c = 0; c < TILE_SIZE / 2; ++c) {
          if (fb & id) m.floorMasks[c + tileIndex + 8] = 0;
          else {
            m.floorMasks[c + tileIndex + 8] = 0x40;
            m.roofMasks[c + tileIndex + 8] = -0x40;
          }
          id <<= 1;
        }
        fb = f.u8();
        id = 1;
        for (let c = 0; c < TILE_SIZE / 2; ++c) {
          if (fb & id) m.floorMasks[c + tileIndex] = 0;
          else {
            m.floorMasks[c + tileIndex] = 0x40;
            m.roofMasks[c + tileIndex] = -0x40;
          }
          id <<= 1;
        }
        for (let c = 0; c < TILE_SIZE; ++c) {
          let h = 0;
          while (h > -1) {
            if (h === TILE_SIZE) { m.lWallMasks[c + tileIndex] = 0x40; h = -1; }
            else if (c > m.roofMasks[h + tileIndex]) ++h;
            else { m.lWallMasks[c + tileIndex] = h; h = -1; }
          }
        }
        for (let c = 0; c < TILE_SIZE; ++c) {
          let h = TILE_SIZE - 1;
          while (h < TILE_SIZE) {
            if (h === -1) { m.rWallMasks[c + tileIndex] = -0x40; h = TILE_SIZE; }
            else if (c > m.roofMasks[h + tileIndex]) --h;
            else { m.rWallMasks[c + tileIndex] = h; h = TILE_SIZE; }
          }
        }
      } else {
        for (let c = 0; c < TILE_SIZE; c += 2) {
          fb = f.u8();
          m.floorMasks[c + tileIndex] = fb >> 4;
          m.floorMasks[c + tileIndex + 1] = fb & 0xf;
        }
        fb = f.u8();
        let id = 1;
        for (let c = 0; c < TILE_SIZE / 2; ++c) {
          if (fb & id) m.roofMasks[c + tileIndex + 8] = 0xf;
          else {
            m.floorMasks[c + tileIndex + 8] = 0x40;
            m.roofMasks[c + tileIndex + 8] = -0x40;
          }
          id <<= 1;
        }
        fb = f.u8();
        id = 1;
        for (let c = 0; c < TILE_SIZE / 2; ++c) {
          if (fb & id) m.roofMasks[c + tileIndex] = 0xf;
          else {
            m.floorMasks[c + tileIndex] = 0x40;
            m.roofMasks[c + tileIndex] = -0x40;
          }
          id <<= 1;
        }
        for (let c = 0; c < TILE_SIZE; ++c) {
          let h = 0;
          while (h > -1) {
            if (h === TILE_SIZE) { m.lWallMasks[c + tileIndex] = 0x40; h = -1; }
            else if (c < m.floorMasks[h + tileIndex]) ++h;
            else { m.lWallMasks[c + tileIndex] = h; h = -1; }
          }
        }
        for (let c = 0; c < TILE_SIZE; ++c) {
          let h = TILE_SIZE - 1;
          while (h < TILE_SIZE) {
            if (h === -1) { m.rWallMasks[c + tileIndex] = -0x40; h = TILE_SIZE; }
            else if (c < m.floorMasks[h + tileIndex]) --h;
            else { m.rWallMasks[c + tileIndex] = h; h = TILE_SIZE; }
          }
        }
      }
    }
    tileIndex += 16;
  }
}

function LoadStageGIFFile(E: Engine): void {
  const data = E.vfs.get(stagePath(E, "16x16Tiles.gif"));
  if (!data) return;
  const f = new FileReader(data);
  const h = readGifHeader(f);
  for (let c = 0x80; c < 0x100; ++c) SetPaletteEntry(E, 0xff, c, h.palette[c * 3], h.palette[c * 3 + 1], h.palette[c * 3 + 2]);
  // the tileset is needed for rendering only, but Copy16x16Tile runs on both sides; decode everywhere (it is small)
  ReadGifPictureData(f, h.width, h.height, h.interlaced, E.tilesetGFXData, 0);
  const transparent = E.tilesetGFXData[0];
  const g = E.tilesetGFXData;
  for (let i = 0; i < TILESET_SIZE; ++i) if (g[i] === transparent) g[i] = 0;
}

export function Init3DFloorBuffer(E: Engine, layerID: number): void {
  const tiles = E.stageLayouts[layerID].tiles;
  for (let y = 0; y < 0x100; ++y) {
    for (let x = 0; x < 0x100; ++x) {
      const c = tiles[(x >> 3) + ((y >> 3) << 8)] << 6;
      E.tile3DFloorBuffer[x + (y << 8)] = c + (x & 7) + ((y & 7) << 3);
    }
  }
}

export { SCREEN_YSIZE };
