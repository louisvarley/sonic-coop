// The RetroScript v4 interpreter (Script.cpp: ProcessScript). Operands are decoded, the function runs, then the
// operands are written back to their variables, exactly as in the original.

import type { Engine } from "../engine.js";
import { CAM_INDEX, CAM_STRIDE, MAX_PLAYERS } from "../engine.js";
import { ENT_STRIDE, F } from "../entity.js";
import { VAR, FUNC } from "./ids.js";
import { FUNCTIONS } from "./tables.js";
import {
  ENTITY_COUNT, TEMPENTITY_START, OBJECT_COUNT, TYPEGROUP_COUNT, EVENT_SETUP, SPRITEFRAME_COUNT, STAGEMODE_LOAD,
  FLIP_NONE, PRIORITY_BOUNDS, PRIORITY_ACTIVE, INK_NONE, C_TOUCH, C_SOLID, C_SOLID2, C_PLATFORM,
  CSIDE_FLOOR, CSIDE_LWALL, CSIDE_RWALL, CSIDE_ROOF, CSIDE_LENTITY, CSIDE_RENTITY, MAT_WORLD, MAT_VIEW, MAT_TEMP,
  TILEINFO_INDEX, TILEINFO_DIRECTION, TILEINFO_VISUALPLANE, TILEINFO_SOLIDITYA, TILEINFO_SOLIDITYB, TILEINFO_FLAGSA,
  TILEINFO_ANGLEA, TILEINFO_FLAGSB, TILEINFO_ANGLEB, SCREEN_YSIZE, SCREEN_CENTERY, RETRO_STANDARD, DRAWLAYER_COUNT,
  TEXTINFO_TEXTDATA, TEXTINFO_TEXTSIZE, TEXTINFO_ROWCOUNT, PALETTE_COUNT,
} from "../c.js";
import { Sin512, Cos512, Sin256, Cos256, ArcTanLookup, nextRand } from "../math.js";
import { AddGraphicsFile, RemoveGraphicsFile } from "../sprite.js";
import { AddAnimationFile, ProcessObjectAnimation } from "../animation.js";
import * as Pal from "../palette.js";
import * as Col from "../collision.js";
import { ProcessObjectControl, ObjectOutOfBounds } from "../object.js";
import { SetLayerDeformation } from "../scene.js";
import * as S3D from "../scene3d.js";
import { StrComp } from "../strings.js";
import * as Text from "../text.js";

const SCRIPTVAR_VAR = 1, SCRIPTVAR_INTCONST = 2, SCRIPTVAR_STRCONST = 3;
const VARARR_NONE = 0, VARARR_ARRAY = 1, VARARR_ENTNOPLUS1 = 2, VARARR_ENTNOMINUS1 = 3;

const OPCODE_SIZE = new Int32Array(FUNCTIONS.map(([, s]) => s));

// ---- entity field fast path: variable id -> (offset in the entity block, write kind)
const ENT_OFF = new Int32Array(VAR.MAX_CNT).fill(-1);
const ENT_KIND = new Uint8Array(VAR.MAX_CNT); // 0 int, 1 u8, 2 s8, 3 u16
{
  const set = (v: number, off: number, kind = 0) => { ENT_OFF[v] = off; ENT_KIND[v] = kind; };
  set(VAR.OBJECT_GROUP_ID, F.groupID, 3);
  set(VAR.OBJECT_TYPE, F.type, 1);
  set(VAR.OBJECT_PROPERTY_VALUE, F.propertyValue, 1);
  set(VAR.OBJECT_XPOS, F.xpos);
  set(VAR.OBJECT_YPOS, F.ypos);
  set(VAR.OBJECT_XVEL, F.xvel);
  set(VAR.OBJECT_YVEL, F.yvel);
  set(VAR.OBJECT_SPEED, F.speed);
  set(VAR.OBJECT_STATE, F.state);
  set(VAR.OBJECT_ROTATION, F.rotation);
  set(VAR.OBJECT_SCALE, F.scale);
  set(VAR.OBJECT_PRIORITY, F.priority, 1);
  set(VAR.OBJECT_DRAW_ORDER, F.drawOrder, 1);
  set(VAR.OBJECT_DIRECTION, F.direction, 1);
  set(VAR.OBJECT_INK_EFFECT, F.inkEffect, 1);
  set(VAR.OBJECT_ALPHA, F.alpha);
  set(VAR.OBJECT_FRAME, F.frame, 1);
  set(VAR.OBJECT_ANIMATION, F.animation, 1);
  set(VAR.OBJECT_PREV_ANIMATION, F.prevAnimation, 1);
  set(VAR.OBJECT_ANIMATION_SPEED, F.animationSpeed);
  set(VAR.OBJECT_ANIMATION_TIMER, F.animationTimer);
  set(VAR.OBJECT_ANGLE, F.angle);
  set(VAR.OBJECT_LOOK_POS_X, F.lookPosX);
  set(VAR.OBJECT_LOOK_POS_Y, F.lookPosY);
  set(VAR.OBJECT_COLLISION_MODE, F.collisionMode, 1);
  set(VAR.OBJECT_COLLISION_PLANE, F.collisionPlane, 1);
  set(VAR.OBJECT_CONTROL_MODE, F.controlMode, 2);
  set(VAR.OBJECT_CONTROL_LOCK, F.controlLock, 1);
  set(VAR.OBJECT_PUSHING, F.pushing, 1);
  set(VAR.OBJECT_VISIBLE, F.visible, 1);
  set(VAR.OBJECT_TILE_COLLISIONS, F.tileCollisions, 1);
  set(VAR.OBJECT_INTERACTION, F.objectInteractions, 1);
  set(VAR.OBJECT_GRAVITY, F.gravity, 1);
  set(VAR.OBJECT_UP, F.up, 1);
  set(VAR.OBJECT_DOWN, F.down, 1);
  set(VAR.OBJECT_LEFT, F.left, 1);
  set(VAR.OBJECT_RIGHT, F.right, 1);
  set(VAR.OBJECT_JUMP_PRESS, F.jumpPress, 1);
  set(VAR.OBJECT_JUMP_HOLD, F.jumpHold, 1);
  set(VAR.OBJECT_SCROLL_TRACKING, F.scrollTracking, 1);
  set(VAR.OBJECT_FLOOR_SENSOR_L, F.floorSensors + 0, 1);
  set(VAR.OBJECT_FLOOR_SENSOR_C, F.floorSensors + 1, 1);
  set(VAR.OBJECT_FLOOR_SENSOR_R, F.floorSensors + 2, 1);
  set(VAR.OBJECT_FLOOR_SENSOR_LC, F.floorSensors + 3, 1);
  set(VAR.OBJECT_FLOOR_SENSOR_RC, F.floorSensors + 4, 1);
  for (let i = 0; i < 48; i++) set(VAR.OBJECT_VALUE0 + i, F.values + i);
}

const CAM_VARS = [CAM_INDEX.cameraEnabled, CAM_INDEX.cameraTarget, CAM_INDEX.cameraStyle, CAM_INDEX.cameraXPos, CAM_INDEX.cameraYPos, CAM_INDEX.cameraAdjustY];

/** A per-camera value; cameras beyond the active ones read camera 0. */
function camVar(E: Engine, cam: number, idx: number): number {
  if (cam < 0 || cam >= Math.max(1, E.camCount)) cam = 0;
  return E.cams[cam * CAM_STRIDE + idx];
}

function keyState(E: Engine, idx: number, press: boolean): number {
  const arr = press ? E.inputPress : E.inputDown;
  if (idx === 0) {
    let v = 0;
    for (let p = 0; p < E.playerSlots; p++) v |= arr[p];
    return v;
  }
  if (idx >= 1 && idx <= MAX_PLAYERS) return arr[idx - 1];
  return 0;
}

function getHitboxValue(E: Engine, slot: number, side: 0 | 1 | 2 | 3): number {
  const ent = E.objectEntityList[slot];
  const animFile = E.objectScriptList[ent.type].animFile;
  if (!animFile) return 0;
  const frame = E.animFrames[E.animationList[animFile.aniListOffset + ent.animation].frameListOffset + ent.frame];
  const hb = E.hitboxList[animFile.hitboxListOffset + (frame ? frame.hitboxID : 0)];
  if (!hb) return 0;
  return side === 0 ? hb.left[0] : side === 1 ? hb.top[0] : side === 2 ? hb.right[0] : hb.bottom[0];
}

function readVar(E: Engine, v: number, arrayVal: number): number {
  const off = ENT_OFF[v];
  if (off >= 0) return E.entityBuffer[arrayVal * ENT_STRIDE + off];
  const se = E.scriptEng;
  switch (v) {
    case VAR.TEMP0: case VAR.TEMP1: case VAR.TEMP2: case VAR.TEMP3: case VAR.TEMP4: case VAR.TEMP5: case VAR.TEMP6: case VAR.TEMP7:
      return se.temp[v - VAR.TEMP0];
    case VAR.CHECK_RESULT: return E.checkResult;
    case VAR.ARRAY_POS0: case VAR.ARRAY_POS1: case VAR.ARRAY_POS2: case VAR.ARRAY_POS3: case VAR.ARRAY_POS4: case VAR.ARRAY_POS5: case VAR.ARRAY_POS6: case VAR.ARRAY_POS7:
      return se.arrayPosition[v - VAR.ARRAY_POS0];
    case VAR.GLOBAL: return E.globalVariables[arrayVal];
    case VAR.LOCAL: return E.scriptCode[arrayVal];
    case VAR.OBJECT_ENTITY_POS: return arrayVal;
    case VAR.OBJECT_IXPOS: return E.entityBuffer[arrayVal * ENT_STRIDE + F.xpos] >> 16;
    case VAR.OBJECT_IYPOS: return E.entityBuffer[arrayVal * ENT_STRIDE + F.ypos] >> 16;
    case VAR.OBJECT_COLLISION_LEFT: return getHitboxValue(E, arrayVal, 0);
    case VAR.OBJECT_COLLISION_TOP: return getHitboxValue(E, arrayVal, 1);
    case VAR.OBJECT_COLLISION_RIGHT: return getHitboxValue(E, arrayVal, 2);
    case VAR.OBJECT_COLLISION_BOTTOM: return getHitboxValue(E, arrayVal, 3);
    case VAR.OBJECT_OUT_OF_BOUNDS: return +ObjectOutOfBounds(E, E.objectEntityList[arrayVal]);
    case VAR.OBJECT_SPRITE_SHEET: return E.objectScriptList[E.objectEntityList[arrayVal].type].spriteSheetID;
    case VAR.STAGE_STATE: return E.stageMode;
    case VAR.STAGE_ACTIVE_LIST: return E.activeStageList;
    case VAR.STAGE_LIST_POS: return E.stageListPosition;
    case VAR.STAGE_TIME_ENABLED: return E.timeEnabled;
    case VAR.STAGE_MILLI_SECONDS: return E.stageMilliseconds;
    case VAR.STAGE_SECONDS: return E.stageSeconds;
    case VAR.STAGE_MINUTES: return E.stageMinutes;
    case VAR.STAGE_ACT_NUM: return E.actID;
    case VAR.STAGE_PAUSE_ENABLED: return E.pauseEnabled;
    case VAR.STAGE_LIST_SIZE: return E.stageListCount[E.activeStageList];
    case VAR.STAGE_NEW_XBOUNDARY1: return E.newXBoundary1;
    case VAR.STAGE_NEW_XBOUNDARY2: return E.newXBoundary2;
    case VAR.STAGE_NEW_YBOUNDARY1: return E.newYBoundary1;
    case VAR.STAGE_NEW_YBOUNDARY2: return E.newYBoundary2;
    case VAR.STAGE_CUR_XBOUNDARY1: return E.curXBoundary1;
    case VAR.STAGE_CUR_XBOUNDARY2: return E.curXBoundary2;
    case VAR.STAGE_CUR_YBOUNDARY1: return E.curYBoundary1;
    case VAR.STAGE_CUR_YBOUNDARY2: return E.curYBoundary2;
    case VAR.STAGE_DEFORMATION_DATA0: return E.bgDeformationData0[arrayVal];
    case VAR.STAGE_DEFORMATION_DATA1: return E.bgDeformationData1[arrayVal];
    case VAR.STAGE_DEFORMATION_DATA2: return E.bgDeformationData2[arrayVal];
    case VAR.STAGE_DEFORMATION_DATA3: return E.bgDeformationData3[arrayVal];
    case VAR.STAGE_WATER_LEVEL: return E.waterLevel;
    case VAR.STAGE_ACTIVE_LAYER: return E.activeTileLayers[arrayVal];
    case VAR.STAGE_MID_POINT: return E.tLayerMidPoint;
    case VAR.STAGE_PLAYER_LIST_POS: return E.playerListPos;
    case VAR.STAGE_DEBUG_MODE: return E.debugMode;
    case VAR.STAGE_ENTITY_POS: return E.objectEntityPos;
    case VAR.SCREEN_CAMERA_ENABLED: return E.cameraEnabled;
    case VAR.SCREEN_CAMERA_TARGET: return E.cameraTarget;
    case VAR.SCREEN_CAMERA_STYLE: return E.cameraStyle;
    case VAR.SCREEN_CAMERA_X: return E.cameraXPos;
    case VAR.SCREEN_CAMERA_Y: return E.cameraYPos;
    case VAR.SCREEN_DRAW_LIST_SIZE: return E.drawListEntries[arrayVal].listSize;
    case VAR.SCREEN_XCENTER: return E.SCREEN_CENTERX;
    case VAR.SCREEN_YCENTER: return SCREEN_CENTERY;
    case VAR.SCREEN_XSIZE: return E.SCREEN_XSIZE;
    case VAR.SCREEN_YSIZE: return SCREEN_YSIZE;
    case VAR.SCREEN_XOFFSET: return E.xScrollOffset;
    case VAR.SCREEN_YOFFSET: return E.yScrollOffset;
    case VAR.SCREEN_SHAKE_X: return E.cameraShakeX;
    case VAR.SCREEN_SHAKE_Y: return E.cameraShakeY;
    case VAR.SCREEN_ADJUST_CAMERA_Y: return E.cameraAdjustY;
    case VAR.TOUCHSCREEN_DOWN: return 0;
    case VAR.TOUCHSCREEN_XPOS: return 0;
    case VAR.TOUCHSCREEN_YPOS: return 0;
    case VAR.MUSIC_VOLUME: return E.musicVolume;
    case VAR.MUSIC_CURRENT_TRACK: return E.trackID;
    case VAR.MUSIC_POSITION: return E.musicPosition;
    case VAR.MENU1_SELECTION: return E.gameMenu[0].selection1;
    case VAR.MENU2_SELECTION: return E.gameMenu[1].selection1;
    case VAR.TILE_LAYER_XSIZE: return E.stageLayouts[arrayVal].xsize;
    case VAR.TILE_LAYER_YSIZE: return E.stageLayouts[arrayVal].ysize;
    case VAR.TILE_LAYER_TYPE: return E.stageLayouts[arrayVal].type;
    case VAR.TILE_LAYER_ANGLE: return E.stageLayouts[arrayVal].angle;
    case VAR.TILE_LAYER_XPOS: return E.stageLayouts[arrayVal].xpos;
    case VAR.TILE_LAYER_YPOS: return E.stageLayouts[arrayVal].ypos;
    case VAR.TILE_LAYER_ZPOS: return E.stageLayouts[arrayVal].zpos;
    case VAR.TILE_LAYER_PARALLAX_FACTOR: return E.stageLayouts[arrayVal].parallaxFactor;
    case VAR.TILE_LAYER_SCROLL_SPEED: return E.stageLayouts[arrayVal].scrollSpeed;
    case VAR.TILE_LAYER_SCROLL_POS: return E.stageLayouts[arrayVal].scrollPos;
    case VAR.TILE_LAYER_DEFORMATION_OFFSET: return E.stageLayouts[arrayVal].deformationOffset;
    case VAR.TILE_LAYER_DEFORMATION_OFFSET_W: return E.stageLayouts[arrayVal].deformationOffsetW;
    case VAR.H_PARALLAX_PARALLAX_FACTOR: return E.hParallax.parallaxFactor[arrayVal];
    case VAR.H_PARALLAX_SCROLL_SPEED: return E.hParallax.scrollSpeed[arrayVal];
    case VAR.H_PARALLAX_SCROLL_POS: return E.hParallax.scrollPos[arrayVal];
    case VAR.V_PARALLAX_PARALLAX_FACTOR: return E.vParallax.parallaxFactor[arrayVal];
    case VAR.V_PARALLAX_SCROLL_SPEED: return E.vParallax.scrollSpeed[arrayVal];
    case VAR.V_PARALLAX_SCROLL_POS: return E.vParallax.scrollPos[arrayVal];
    case VAR.SCENE3D_VERTEX_COUNT: return E.vertexCount;
    case VAR.SCENE3D_FACE_COUNT: return E.faceCount;
    case VAR.SCENE3D_PROJECTION_X: return E.projectionX;
    case VAR.SCENE3D_PROJECTION_Y: return E.projectionY;
    case VAR.SCENE3D_FOG_COLOR: return E.fogColor;
    case VAR.SCENE3D_FOG_STRENGTH: return E.fogStrength;
    case VAR.VERTEX_BUFFER_X: return E.vertexBuf[arrayVal * 5];
    case VAR.VERTEX_BUFFER_Y: return E.vertexBuf[arrayVal * 5 + 1];
    case VAR.VERTEX_BUFFER_Z: return E.vertexBuf[arrayVal * 5 + 2];
    case VAR.VERTEX_BUFFER_U: return E.vertexBuf[arrayVal * 5 + 3];
    case VAR.VERTEX_BUFFER_V: return E.vertexBuf[arrayVal * 5 + 4];
    case VAR.FACE_BUFFER_A: return E.faceBuf[arrayVal * 6];
    case VAR.FACE_BUFFER_B: return E.faceBuf[arrayVal * 6 + 1];
    case VAR.FACE_BUFFER_C: return E.faceBuf[arrayVal * 6 + 2];
    case VAR.FACE_BUFFER_D: return E.faceBuf[arrayVal * 6 + 3];
    case VAR.FACE_BUFFER_FLAG: return E.faceBuf[arrayVal * 6 + 4];
    case VAR.FACE_BUFFER_COLOR: return E.faceBuf[arrayVal * 6 + 5];
    case VAR.SAVE_RAM: return E.saveRAM[arrayVal];
    case VAR.ENGINE_STATE: return E.gameMode;
    case VAR.ENGINE_LANGUAGE: return 0;
    case VAR.ENGINE_ONLINE_ACTIVE: return 0;
    case VAR.ENGINE_SFX_VOLUME: return 100;
    case VAR.ENGINE_BGM_VOLUME: return 100;
    case VAR.ENGINE_TRIAL_MODE: return 0;
    case VAR.ENGINE_DEVICE_TYPE: return RETRO_STANDARD;
    case VAR.SCREEN_CURRENT_ID: return E.curCam;
    case VAR.CAMERA_ENABLED: case VAR.CAMERA_TARGET: case VAR.CAMERA_STYLE: case VAR.CAMERA_XPOS: case VAR.CAMERA_YPOS: case VAR.CAMERA_ADJUST_Y:
      if (arrayVal < 0 || arrayVal >= MAX_PLAYERS) return 0;
      return E.cams[arrayVal * CAM_STRIDE + CAM_VARS[v - VAR.CAMERA_ENABLED]];
    case VAR.ENGINE_HAPTICS_ENABLED: return 0;
    case VAR.CAMERA_CUR_XBOUNDARY1: return camVar(E, arrayVal, CAM_INDEX.curXBoundary1);
    case VAR.CAMERA_CUR_XBOUNDARY2: return camVar(E, arrayVal, CAM_INDEX.curXBoundary2);
    case VAR.CAMERA_CUR_YBOUNDARY1: return camVar(E, arrayVal, CAM_INDEX.curYBoundary1);
    case VAR.CAMERA_CUR_YBOUNDARY2: return camVar(E, arrayVal, CAM_INDEX.curYBoundary2);
    case VAR.CAMERA_XOFFSET: return camVar(E, arrayVal, CAM_INDEX.xScrollOffset);
    case VAR.CAMERA_YOFFSET: return camVar(E, arrayVal, CAM_INDEX.yScrollOffset);
    case VAR.ENGINE_PLAYER_COUNT: return E.playerSlots;
    default:
      if (v >= VAR.KEY_DOWN_UP && v <= VAR.KEY_DOWN_SELECT) return (keyState(E, arrayVal, false) >> (v - VAR.KEY_DOWN_UP)) & 1;
      if (v >= VAR.KEY_PRESS_UP && v <= VAR.KEY_PRESS_SELECT) return (keyState(E, arrayVal, true) >> (v - VAR.KEY_PRESS_UP)) & 1;
      return 0;
  }
}

function writeKey(E: Engine, idx: number, bit: number, value: number, press: boolean): void {
  const arr = press ? E.inputPress : E.inputDown;
  const apply = (p: number) => { arr[p] = value ? arr[p] | (1 << bit) : arr[p] & ~(1 << bit); };
  if (idx === 0) for (let p = 0; p < E.playerSlots; p++) apply(p);
  else if (idx >= 1 && idx <= MAX_PLAYERS) apply(idx - 1);
}

function writeVar(E: Engine, v: number, arrayVal: number, value: number): void {
  const off = ENT_OFF[v];
  if (off >= 0) {
    const k = ENT_KIND[v];
    E.entityBuffer[arrayVal * ENT_STRIDE + off] = k === 0 ? value : k === 1 ? value & 0xff : k === 2 ? (value << 24) >> 24 : value & 0xffff;
    return;
  }
  const se = E.scriptEng;
  switch (v) {
    case VAR.TEMP0: case VAR.TEMP1: case VAR.TEMP2: case VAR.TEMP3: case VAR.TEMP4: case VAR.TEMP5: case VAR.TEMP6: case VAR.TEMP7:
      se.temp[v - VAR.TEMP0] = value; return;
    case VAR.CHECK_RESULT: E.checkResult = value; return;
    case VAR.ARRAY_POS0: case VAR.ARRAY_POS1: case VAR.ARRAY_POS2: case VAR.ARRAY_POS3: case VAR.ARRAY_POS4: case VAR.ARRAY_POS5: case VAR.ARRAY_POS6: case VAR.ARRAY_POS7:
      se.arrayPosition[v - VAR.ARRAY_POS0] = value; return;
    case VAR.GLOBAL: E.globalVariables[arrayVal] = value; return;
    case VAR.LOCAL: E.scriptCode[arrayVal] = value; return;
    case VAR.OBJECT_IXPOS: E.entityBuffer[arrayVal * ENT_STRIDE + F.xpos] = value << 16; return;
    case VAR.OBJECT_IYPOS: E.entityBuffer[arrayVal * ENT_STRIDE + F.ypos] = value << 16; return;
    case VAR.OBJECT_SPRITE_SHEET: E.objectScriptList[E.objectEntityList[arrayVal].type].spriteSheetID = value; return;
    case VAR.STAGE_STATE: E.stageMode = value; return;
    case VAR.STAGE_ACTIVE_LIST: E.activeStageList = value; return;
    case VAR.STAGE_LIST_POS: E.stageListPosition = value; return;
    case VAR.STAGE_TIME_ENABLED: E.timeEnabled = value; return;
    case VAR.STAGE_MILLI_SECONDS: E.stageMilliseconds = value; return;
    case VAR.STAGE_SECONDS: E.stageSeconds = value; return;
    case VAR.STAGE_MINUTES: E.stageMinutes = value; return;
    case VAR.STAGE_ACT_NUM: E.actID = value; return;
    case VAR.STAGE_PAUSE_ENABLED: E.pauseEnabled = value; return;
    case VAR.STAGE_NEW_XBOUNDARY1: E.newXBoundary1 = value; return;
    case VAR.STAGE_NEW_XBOUNDARY2: E.newXBoundary2 = value; return;
    case VAR.STAGE_NEW_YBOUNDARY1: E.newYBoundary1 = value; return;
    case VAR.STAGE_NEW_YBOUNDARY2: E.newYBoundary2 = value; return;
    // Writing a current boundary applies to every camera: arena locks are shared by all players.
    case VAR.STAGE_CUR_XBOUNDARY1: setCurBoundary(E, CAM_INDEX.curXBoundary1, value); if (E.curXBoundary1 !== E.newXBoundary1) E.newXBoundary1 = value; return;
    case VAR.STAGE_CUR_XBOUNDARY2: setCurBoundary(E, CAM_INDEX.curXBoundary2, value); if (E.curXBoundary2 !== E.newXBoundary2) E.newXBoundary2 = value; return;
    case VAR.STAGE_CUR_YBOUNDARY1: setCurBoundary(E, CAM_INDEX.curYBoundary1, value); if (E.curYBoundary1 !== E.newYBoundary1) E.newYBoundary1 = value; return;
    case VAR.STAGE_CUR_YBOUNDARY2: setCurBoundary(E, CAM_INDEX.curYBoundary2, value); if (E.curYBoundary2 !== E.newYBoundary2) E.newYBoundary2 = value; return;
    case VAR.STAGE_DEFORMATION_DATA0: E.bgDeformationData0[arrayVal] = value; return;
    case VAR.STAGE_DEFORMATION_DATA1: E.bgDeformationData1[arrayVal] = value; return;
    case VAR.STAGE_DEFORMATION_DATA2: E.bgDeformationData2[arrayVal] = value; return;
    case VAR.STAGE_DEFORMATION_DATA3: E.bgDeformationData3[arrayVal] = value; return;
    case VAR.STAGE_WATER_LEVEL: E.waterLevel = value; return;
    case VAR.STAGE_ACTIVE_LAYER: E.activeTileLayers[arrayVal] = value; return;
    case VAR.STAGE_MID_POINT: E.tLayerMidPoint = value; return;
    case VAR.STAGE_PLAYER_LIST_POS: E.playerListPos = value; return;
    case VAR.STAGE_DEBUG_MODE: E.debugMode = value; return;
    case VAR.STAGE_ENTITY_POS: E.objectEntityPos = value; return;
    case VAR.SCREEN_CAMERA_ENABLED: E.cameraEnabled = value; return;
    case VAR.SCREEN_CAMERA_TARGET: E.cameraTarget = value; return;
    case VAR.SCREEN_CAMERA_STYLE: E.cameraStyle = value; return;
    case VAR.SCREEN_CAMERA_X: E.cameraXPos = value; return;
    case VAR.SCREEN_CAMERA_Y: E.cameraYPos = value; return;
    case VAR.SCREEN_DRAW_LIST_SIZE: E.drawListEntries[arrayVal].listSize = value; return;
    case VAR.SCREEN_XOFFSET: E.xScrollOffset = value; return;
    case VAR.SCREEN_YOFFSET: E.yScrollOffset = value; return;
    case VAR.SCREEN_SHAKE_X: E.cameraShakeX = value; return;
    case VAR.SCREEN_SHAKE_Y: E.cameraShakeY = value; return;
    case VAR.SCREEN_ADJUST_CAMERA_Y: E.cameraAdjustY = value; return;
    case VAR.MUSIC_VOLUME: E.musicVolume = value; E.host.setMusicVolume(value); return;
    case VAR.MENU1_SELECTION: E.gameMenu[0].selection1 = value; return;
    case VAR.MENU2_SELECTION: E.gameMenu[1].selection1 = value; return;
    case VAR.TILE_LAYER_XSIZE: E.stageLayouts[arrayVal].xsize = value; return;
    case VAR.TILE_LAYER_YSIZE: E.stageLayouts[arrayVal].ysize = value; return;
    case VAR.TILE_LAYER_TYPE: E.stageLayouts[arrayVal].type = value; return;
    case VAR.TILE_LAYER_ANGLE: {
      let angle = value + 0x200;
      if (value >= 0) angle = value;
      E.stageLayouts[arrayVal].angle = angle & 0x1ff;
      return;
    }
    case VAR.TILE_LAYER_XPOS: E.stageLayouts[arrayVal].xpos = value; return;
    case VAR.TILE_LAYER_YPOS: E.stageLayouts[arrayVal].ypos = value; return;
    case VAR.TILE_LAYER_ZPOS: E.stageLayouts[arrayVal].zpos = value; return;
    case VAR.TILE_LAYER_PARALLAX_FACTOR: E.stageLayouts[arrayVal].parallaxFactor = value; return;
    case VAR.TILE_LAYER_SCROLL_SPEED: E.stageLayouts[arrayVal].scrollSpeed = value; return;
    case VAR.TILE_LAYER_SCROLL_POS: E.stageLayouts[arrayVal].scrollPos = value; return;
    case VAR.TILE_LAYER_DEFORMATION_OFFSET: E.stageLayouts[arrayVal].deformationOffset = value; return;
    case VAR.TILE_LAYER_DEFORMATION_OFFSET_W: E.stageLayouts[arrayVal].deformationOffsetW = value; return;
    case VAR.H_PARALLAX_PARALLAX_FACTOR: E.hParallax.parallaxFactor[arrayVal] = value; return;
    case VAR.H_PARALLAX_SCROLL_SPEED: E.hParallax.scrollSpeed[arrayVal] = value; return;
    case VAR.H_PARALLAX_SCROLL_POS: E.hParallax.scrollPos[arrayVal] = value; return;
    case VAR.V_PARALLAX_PARALLAX_FACTOR: E.vParallax.parallaxFactor[arrayVal] = value; return;
    case VAR.V_PARALLAX_SCROLL_SPEED: E.vParallax.scrollSpeed[arrayVal] = value; return;
    case VAR.V_PARALLAX_SCROLL_POS: E.vParallax.scrollPos[arrayVal] = value; return;
    case VAR.SCENE3D_VERTEX_COUNT: E.vertexCount = value; return;
    case VAR.SCENE3D_FACE_COUNT: E.faceCount = value; return;
    case VAR.SCENE3D_PROJECTION_X: E.projectionX = value; return;
    case VAR.SCENE3D_PROJECTION_Y: E.projectionY = value; return;
    case VAR.SCENE3D_FOG_COLOR: E.fogColor = value; return;
    case VAR.SCENE3D_FOG_STRENGTH: E.fogStrength = value; return;
    case VAR.VERTEX_BUFFER_X: E.vertexBuf[arrayVal * 5] = value; return;
    case VAR.VERTEX_BUFFER_Y: E.vertexBuf[arrayVal * 5 + 1] = value; return;
    case VAR.VERTEX_BUFFER_Z: E.vertexBuf[arrayVal * 5 + 2] = value; return;
    case VAR.VERTEX_BUFFER_U: E.vertexBuf[arrayVal * 5 + 3] = value; return;
    case VAR.VERTEX_BUFFER_V: E.vertexBuf[arrayVal * 5 + 4] = value; return;
    case VAR.FACE_BUFFER_A: E.faceBuf[arrayVal * 6] = value; return;
    case VAR.FACE_BUFFER_B: E.faceBuf[arrayVal * 6 + 1] = value; return;
    case VAR.FACE_BUFFER_C: E.faceBuf[arrayVal * 6 + 2] = value; return;
    case VAR.FACE_BUFFER_D: E.faceBuf[arrayVal * 6 + 3] = value; return;
    case VAR.FACE_BUFFER_FLAG: E.faceBuf[arrayVal * 6 + 4] = value; return;
    case VAR.FACE_BUFFER_COLOR: E.faceBuf[arrayVal * 6 + 5] = value; return;
    case VAR.SAVE_RAM: E.saveRAM[arrayVal] = value; return;
    case VAR.ENGINE_STATE: E.gameMode = value; return;
    case VAR.CAMERA_ENABLED: case VAR.CAMERA_TARGET: case VAR.CAMERA_STYLE: case VAR.CAMERA_XPOS: case VAR.CAMERA_YPOS: case VAR.CAMERA_ADJUST_Y:
      if (arrayVal >= 0 && arrayVal < MAX_PLAYERS) E.cams[arrayVal * CAM_STRIDE + CAM_VARS[v - VAR.CAMERA_ENABLED]] = value;
      return;
    default:
      if (v >= VAR.KEY_DOWN_UP && v <= VAR.KEY_DOWN_SELECT) writeKey(E, arrayVal, v - VAR.KEY_DOWN_UP, value, false);
      else if (v >= VAR.KEY_PRESS_UP && v <= VAR.KEY_PRESS_SELECT) writeKey(E, arrayVal, v - VAR.KEY_PRESS_UP, value, true);
      return;
  }
}

function setCurBoundary(E: Engine, idx: number, value: number): void {
  if (E.cams[E.camBase + idx] === value) return;
  for (let c = 0; c < Math.max(1, E.camCount); c++) E.cams[c * CAM_STRIDE + idx] = value;
}

function matrixOf(E: Engine, id: number) {
  return id === MAT_WORLD ? E.matWorld : id === MAT_VIEW ? E.matView : id === MAT_TEMP ? E.matTemp : null;
}

export function ProcessScript(E: Engine, scriptCodeStart: number, jumpTableStart: number, scriptEvent: number): void {
  const code = E.scriptCode;
  const jt = E.jumpTable;
  const jts = E.jumpTableStack;
  const fns = E.functionStack;
  const fes = E.foreachStack;
  const ops = E.scriptEng.operands;
  const arrPos = E.scriptEng.arrayPosition;
  let running = true;
  let ptr = scriptCodeStart;
  let jtsPos = 0;
  let fnPos = 0;
  let fePos = 0;
  let guard = 0;

  while (running) {
    if (++guard > 5_000_000) {
      E.host.log(`script loop guard tripped (object type ${E.objectEntityList[E.objectEntityPos].type})`);
      return;
    }
    const opcode = code[ptr++];
    let opcodeSize = OPCODE_SIZE[opcode] ?? 0;
    const scriptCodeOffset = ptr;
    let text = "";

    for (let i = 0; i < opcodeSize; ++i) {
      const opcodeType = code[ptr++];
      if (opcodeType === SCRIPTVAR_VAR) {
        let arrayVal = 0;
        switch (code[ptr++]) {
          case VARARR_NONE: arrayVal = E.objectEntityPos; break;
          case VARARR_ARRAY: arrayVal = code[ptr++] === 1 ? arrPos[code[ptr++]] : code[ptr++]; break;
          case VARARR_ENTNOPLUS1: arrayVal = (code[ptr++] === 1 ? arrPos[code[ptr++]] : code[ptr++]) + E.objectEntityPos; break;
          case VARARR_ENTNOMINUS1: arrayVal = E.objectEntityPos - (code[ptr++] === 1 ? arrPos[code[ptr++]] : code[ptr++]); break;
        }
        ops[i] = readVar(E, code[ptr++], arrayVal);
      } else if (opcodeType === SCRIPTVAR_INTCONST) {
        ops[i] = code[ptr++];
      } else if (opcodeType === SCRIPTVAR_STRCONST) {
        const strLen = code[ptr++];
        let s = "";
        for (let c = 0; c < strLen; ++c) {
          switch (c % 4) {
            case 0: s += String.fromCharCode((code[ptr] >>> 24) & 0xff); break;
            case 1: s += String.fromCharCode((code[ptr] >>> 16) & 0xff); break;
            case 2: s += String.fromCharCode((code[ptr] >>> 8) & 0xff); break;
            case 3: s += String.fromCharCode(code[ptr++] & 0xff); break;
          }
        }
        text = s;
        ptr++;
      }
    }

    const entity = E.objectEntityList[E.objectEntityPos];
    const scriptInfo = E.objectScriptList[entity.type];
    const draw = E.draw;

    switch (opcode) {
      case FUNC.END: running = false; break;
      case FUNC.EQUAL: ops[0] = ops[1]; break;
      case FUNC.ADD: ops[0] += ops[1]; break;
      case FUNC.SUB: ops[0] -= ops[1]; break;
      case FUNC.INC: ++ops[0]; break;
      case FUNC.DEC: --ops[0]; break;
      case FUNC.MUL: ops[0] = Math.imul(ops[0], ops[1]); break;
      case FUNC.DIV: ops[0] = ops[1] === 0 ? 0 : ops[0] / ops[1]; break;
      case FUNC.SH_R: ops[0] >>= ops[1]; break;
      case FUNC.SH_L: ops[0] <<= ops[1]; break;
      case FUNC.AND: ops[0] &= ops[1]; break;
      case FUNC.OR: ops[0] |= ops[1]; break;
      case FUNC.XOR: ops[0] ^= ops[1]; break;
      case FUNC.MOD: ops[0] = ops[1] === 0 ? 0 : ops[0] % ops[1]; break;
      case FUNC.FLIP_SIGN: ops[0] = -ops[0]; break;
      case FUNC.CHECK_EQUAL: E.checkResult = +(ops[0] === ops[1]); opcodeSize = 0; break;
      case FUNC.CHECK_GREATER: E.checkResult = +(ops[0] > ops[1]); opcodeSize = 0; break;
      case FUNC.CHECK_LOWER: E.checkResult = +(ops[0] < ops[1]); opcodeSize = 0; break;
      case FUNC.CHECK_NOT_EQUAL: E.checkResult = +(ops[0] !== ops[1]); opcodeSize = 0; break;
      case FUNC.IF_EQUAL:
        if (ops[1] !== ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IF_GREATER:
        if (ops[1] <= ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IF_GREATER_OR_EQUAL:
        if (ops[1] < ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IF_LOWER:
        if (ops[1] >= ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IF_LOWER_OR_EQUAL:
        if (ops[1] > ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IF_NOT_EQUAL:
        if (ops[1] === ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.ELSE:
        opcodeSize = 0;
        ptr = scriptCodeStart + jt[jumpTableStart + jts[jtsPos--] + 1];
        break;
      case FUNC.ENDIF:
        opcodeSize = 0;
        --jtsPos;
        break;
      case FUNC.WEQUAL:
        if (ops[1] !== ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WGREATER:
        if (ops[1] <= ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WGREATER_OR_EQUAL:
        if (ops[1] < ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WLOWER:
        if (ops[1] >= ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WLOWER_OR_EQUAL:
        if (ops[1] > ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WNOT_EQUAL:
        if (ops[1] === ops[2]) ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jtsPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.LOOP:
        opcodeSize = 0;
        ptr = scriptCodeStart + jt[jumpTableStart + jts[jtsPos--]];
        break;
      case FUNC.FOR_EACH_ACTIVE: {
        const groupID = ops[1];
        if (groupID < TYPEGROUP_COUNT) {
          const loop = fes[++fePos] + 1;
          fes[fePos] = loop;
          const list = E.objectTypeGroupList[groupID];
          if (loop >= list.listSize) {
            opcodeSize = 0;
            fes[fePos--] = -1;
            ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
          } else {
            ops[2] = list.entityRefs[loop];
            jts[++jtsPos] = ops[0];
          }
        } else {
          opcodeSize = 0;
          ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        }
        break;
      }
      case FUNC.FOR_EACH_ALL: {
        const objType = ops[1];
        if (objType < OBJECT_COUNT) {
          let loop = fes[++fePos] + 1;
          fes[fePos] = loop;
          const limit = scriptEvent === EVENT_SETUP ? TEMPENTITY_START : ENTITY_COUNT;
          for (;;) {
            if (loop >= limit) {
              opcodeSize = 0;
              fes[fePos--] = -1;
              ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
              break;
            } else if (objType === E.entityBuffer[loop * ENT_STRIDE + F.type]) {
              ops[2] = loop;
              jts[++jtsPos] = ops[0];
              break;
            } else {
              fes[fePos] = ++loop;
            }
          }
        } else {
          opcodeSize = 0;
          ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        }
        break;
      }
      case FUNC.NEXT:
        opcodeSize = 0;
        ptr = scriptCodeStart + jt[jumpTableStart + jts[jtsPos--]];
        --fePos;
        break;
      case FUNC.SWITCH:
        jts[++jtsPos] = ops[0];
        if (ops[1] < jt[jumpTableStart + ops[0]] || ops[1] > jt[jumpTableStart + ops[0] + 1])
          ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 2];
        else ptr = scriptCodeStart + jt[jumpTableStart + ops[0] + 4 + (ops[1] - jt[jumpTableStart + ops[0]])];
        opcodeSize = 0;
        break;
      case FUNC.BREAK:
        opcodeSize = 0;
        ptr = scriptCodeStart + jt[jumpTableStart + jts[jtsPos--] + 3];
        break;
      case FUNC.ENDSWITCH:
        opcodeSize = 0;
        --jtsPos;
        break;
      case FUNC.RAND: {
        const [s, r] = nextRand(E.rngState);
        E.rngState = s;
        ops[0] = ops[1] === 0 ? 0 : r % ops[1];
        break;
      }
      case FUNC.SIN: ops[0] = Sin512(ops[1]); break;
      case FUNC.COS: ops[0] = Cos512(ops[1]); break;
      case FUNC.SIN256: ops[0] = Sin256(ops[1]); break;
      case FUNC.COS256: ops[0] = Cos256(ops[1]); break;
      case FUNC.ATAN2: ops[0] = ArcTanLookup(ops[1], ops[2]); break;
      case FUNC.INTERPOLATE:
        ops[0] = (Math.imul(ops[2], 0x100 - ops[3]) + Math.imul(ops[3], ops[1])) >> 8;
        break;
      case FUNC.INTERPOLATE_XY:
        ops[0] = (Math.imul(ops[3], 0x100 - ops[6]) >> 8) + (Math.imul(ops[6], ops[2]) >> 8);
        ops[1] = (Math.imul(ops[5], 0x100 - ops[6]) >> 8) + (Math.imul(ops[6], ops[4]) >> 8);
        break;
      case FUNC.LOAD_SPRITE_SHEET:
        opcodeSize = 0;
        scriptInfo.spriteSheetID = AddGraphicsFile(E, text);
        break;
      case FUNC.REMOVE_SPRITE_SHEET:
        opcodeSize = 0;
        RemoveGraphicsFile(E, text, -1);
        break;
      case FUNC.DRAW_SPRITE: {
        opcodeSize = 0;
        if (!draw) break;
        const f = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        if (f) draw.DrawSprite(E, (entity.xpos >> 16) - E.xScrollOffset + f.pivotX, (entity.ypos >> 16) - E.yScrollOffset + f.pivotY, f.width, f.height, f.sprX, f.sprY, scriptInfo.spriteSheetID);
        break;
      }
      case FUNC.DRAW_SPRITE_XY: {
        opcodeSize = 0;
        if (!draw) break;
        const f = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        if (f) draw.DrawSprite(E, (ops[1] >> 16) - E.xScrollOffset + f.pivotX, (ops[2] >> 16) - E.yScrollOffset + f.pivotY, f.width, f.height, f.sprX, f.sprY, scriptInfo.spriteSheetID);
        break;
      }
      case FUNC.DRAW_SPRITE_SCREEN_XY: {
        opcodeSize = 0;
        if (!draw) break;
        const f = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        if (f) draw.DrawSprite(E, ops[1] + f.pivotX, ops[2] + f.pivotY, f.width, f.height, f.sprX, f.sprY, scriptInfo.spriteSheetID);
        break;
      }
      case FUNC.DRAW_TINT_RECT:
        opcodeSize = 0;
        if (draw) draw.DrawTintRectangle(E, ops[0], ops[1], ops[2], ops[3]);
        break;
      case FUNC.DRAW_NUMBERS: {
        opcodeSize = 0;
        if (!draw) break;
        let i = 10;
        if (ops[6]) {
          while (ops[4] > 0) {
            const frameID = Math.trunc((ops[3] % i) / Math.trunc(i / 10)) + ops[0];
            const f = E.scriptFrames[scriptInfo.frameListOffset + frameID];
            if (f) draw.DrawSprite(E, f.pivotX + ops[1], f.pivotY + ops[2], f.width, f.height, f.sprX, f.sprY, scriptInfo.spriteSheetID);
            ops[1] -= ops[5];
            i *= 10;
            --ops[4];
          }
        } else {
          let extra = 10;
          if (ops[3]) extra = 10 * ops[3];
          while (ops[4] > 0) {
            if (extra >= i) {
              const frameID = Math.trunc((ops[3] % i) / Math.trunc(i / 10)) + ops[0];
              const f = E.scriptFrames[scriptInfo.frameListOffset + frameID];
              if (f) draw.DrawSprite(E, f.pivotX + ops[1], f.pivotY + ops[2], f.width, f.height, f.sprX, f.sprY, scriptInfo.spriteSheetID);
            }
            ops[1] -= ops[5];
            i *= 10;
            --ops[4];
          }
        }
        break;
      }
      case FUNC.DRAW_ACT_NAME:
        opcodeSize = 0;
        if (draw) drawActName(E, scriptInfo.frameListOffset, scriptInfo.spriteSheetID, ops);
        break;
      case FUNC.DRAW_MENU:
        opcodeSize = 0;
        if (draw) draw.DrawTextMenu(E, E.gameMenu[ops[0]], ops[1], ops[2], scriptInfo.spriteSheetID);
        break;
      case FUNC.SPRITE_FRAME:
        opcodeSize = 0;
        if (scriptEvent === EVENT_SETUP && E.scriptFrameCount < SPRITEFRAME_COUNT) {
          const f = E.scriptFrames[E.scriptFrameCount];
          f.pivotX = ops[0];
          f.pivotY = ops[1];
          f.width = ops[2];
          f.height = ops[3];
          f.sprX = ops[4];
          f.sprY = ops[5];
          ++E.scriptFrameCount;
        }
        break;
      case FUNC.EDIT_FRAME: {
        opcodeSize = 0;
        const f = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        if (f) {
          f.pivotX = ops[1];
          f.pivotY = ops[2];
          f.width = ops[3];
          f.height = ops[4];
          f.sprX = ops[5];
          f.sprY = ops[6];
        }
        break;
      }
      case FUNC.LOAD_PALETTE:
        opcodeSize = 0;
        Pal.LoadPalette(E, text, ops[1], ops[2], ops[3], ops[4]);
        break;
      case FUNC.ROTATE_PALETTE:
        opcodeSize = 0;
        if (ops[0] >= 0 && ops[0] < PALETTE_COUNT) Pal.RotatePalette(E, ops[0], ops[1], ops[2], ops[3]);
        break;
      case FUNC.SET_SCREEN_FADE:
        opcodeSize = 0;
        Pal.SetFade(E, ops[0], ops[1], ops[2], ops[3]);
        break;
      case FUNC.SET_ACTIVE_PALETTE:
        opcodeSize = 0;
        Pal.SetActivePalette(E, ops[0], ops[1], ops[2]);
        break;
      case FUNC.SET_PALETTE_FADE:
        Pal.SetPaletteFade(E, ops[0], ops[1], ops[2], ops[3], ops[4], ops[5]);
        break;
      case FUNC.SET_PALETTE_ENTRY:
        if ((ops[0] & 0xff) < PALETTE_COUNT) Pal.SetPaletteEntryPacked(E, ops[0], ops[1], ops[2]);
        break;
      case FUNC.GET_PALETTE_ENTRY: ops[2] = Pal.GetPaletteEntryPacked(E, ops[0], ops[1]); break;
      case FUNC.COPY_PALETTE:
        opcodeSize = 0;
        Pal.CopyPalette(E, ops[0], ops[1], ops[2], ops[3], ops[4]);
        break;
      case FUNC.CLEAR_SCREEN:
        opcodeSize = 0;
        if (draw) draw.ClearScreen(E, ops[0]);
        break;
      case FUNC.DRAW_SPRITE_FX:
      case FUNC.DRAW_SPRITE_SCREEN_FX: {
        opcodeSize = 0;
        if (!draw) break;
        const f = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        if (!f) break;
        const world = opcode === FUNC.DRAW_SPRITE_FX;
        const x = world ? (ops[2] >> 16) - E.xScrollOffset : ops[2];
        const y = world ? (ops[3] >> 16) - E.yScrollOffset : ops[3];
        draw.DrawSpriteFX(E, entity, f, ops[1], x, y, scriptInfo.spriteSheetID);
        break;
      }
      case FUNC.LOAD_ANIMATION:
        opcodeSize = 0;
        scriptInfo.animFile = AddAnimationFile(E, text);
        break;
      case FUNC.SETUP_MENU: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        Text.SetupTextMenu(menu, ops[1]);
        menu.selectionCount = ops[2];
        menu.alignment = ops[3];
        break;
      }
      case FUNC.ADD_MENU_ENTRY: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        menu.entryHighlight[menu.rowCount] = ops[2];
        Text.AddTextMenuEntry(menu, text);
        break;
      }
      case FUNC.EDIT_MENU_ENTRY: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        Text.EditTextMenuEntry(menu, text, ops[2]);
        menu.entryHighlight[ops[2]] = ops[3];
        break;
      }
      case FUNC.LOAD_STAGE:
        opcodeSize = 0;
        E.stageMode = STAGEMODE_LOAD;
        break;
      case FUNC.DRAW_RECT:
        opcodeSize = 0;
        if (draw) draw.DrawRectangle(E, ops[0], ops[1], ops[2], ops[3], ops[4], ops[5], ops[6], ops[7]);
        break;
      case FUNC.RESET_OBJECT_ENTITY: {
        opcodeSize = 0;
        const n = E.objectEntityList[ops[0]];
        n.clear();
        n.type = ops[1];
        n.propertyValue = ops[2];
        n.xpos = ops[3];
        n.ypos = ops[4];
        n.direction = FLIP_NONE;
        n.priority = PRIORITY_BOUNDS;
        n.drawOrder = 3;
        n.scale = 512;
        n.inkEffect = INK_NONE;
        n.objectInteractions = 1;
        n.visible = 1;
        n.tileCollisions = 1;
        break;
      }
      case FUNC.BOX_COLLISION_TEST: {
        opcodeSize = 0;
        const a = E.objectEntityList[ops[1]];
        const b = E.objectEntityList[ops[6]];
        switch (ops[0]) {
          case C_TOUCH: Col.TouchCollision(E, a, ops[2], ops[3], ops[4], ops[5], b, ops[7], ops[8], ops[9], ops[10]); break;
          case C_SOLID: Col.BoxCollision(E, a, ops[2], ops[3], ops[4], ops[5], b, ops[7], ops[8], ops[9], ops[10]); break;
          case C_SOLID2: Col.BoxCollision2(E, a, ops[2], ops[3], ops[4], ops[5], b, ops[7], ops[8], ops[9], ops[10]); break;
          case C_PLATFORM: Col.PlatformCollision(E, a, ops[2], ops[3], ops[4], ops[5], b, ops[7], ops[8], ops[9], ops[10]); break;
        }
        break;
      }
      case FUNC.CREATE_TEMP_OBJECT: {
        opcodeSize = 0;
        if (E.objectEntityList[arrPos[8]].type > 0 && ++arrPos[8] === ENTITY_COUNT) arrPos[8] = TEMPENTITY_START;
        const t = E.objectEntityList[arrPos[8]];
        t.clear();
        t.type = ops[0];
        t.propertyValue = ops[1];
        t.xpos = ops[2];
        t.ypos = ops[3];
        t.direction = FLIP_NONE;
        t.priority = PRIORITY_ACTIVE;
        t.drawOrder = 3;
        t.scale = 512;
        t.inkEffect = INK_NONE;
        t.objectInteractions = 1;
        t.visible = 1;
        t.tileCollisions = 1;
        break;
      }
      case FUNC.PROCESS_OBJECT_MOVEMENT:
        opcodeSize = 0;
        if (entity.tileCollisions) Col.ProcessTileCollisions(E, entity);
        else {
          entity.xpos += entity.xvel;
          entity.ypos += entity.yvel;
        }
        break;
      case FUNC.PROCESS_OBJECT_CONTROL:
        opcodeSize = 0;
        ProcessObjectControl(E, entity);
        break;
      case FUNC.PROCESS_ANIMATION:
        opcodeSize = 0;
        ProcessObjectAnimation(E, scriptInfo, entity);
        break;
      case FUNC.DRAW_OBJECT_ANIMATION:
        opcodeSize = 0;
        if (draw && entity.visible) draw.DrawObjectAnimation(E, scriptInfo, entity, (entity.xpos >> 16) - E.xScrollOffset, (entity.ypos >> 16) - E.yScrollOffset);
        break;
      case FUNC.SET_MUSIC_TRACK:
        opcodeSize = 0;
        if (ops[2] <= 1) E.host.setMusicTrack(text, ops[1], ops[2] !== 0, 0);
        else E.host.setMusicTrack(text, ops[1], true, ops[2]);
        break;
      case FUNC.PLAY_MUSIC:
        opcodeSize = 0;
        E.trackID = ops[0];
        E.musicStatus = 1;
        E.musicVolume = 100;
        E.host.playMusic(ops[0], 0);
        break;
      case FUNC.STOP_MUSIC:
        opcodeSize = 0;
        E.musicStatus = 0;
        E.host.stopMusic();
        break;
      case FUNC.PAUSE_MUSIC:
        opcodeSize = 0;
        E.host.pauseMusic();
        break;
      case FUNC.RESUME_MUSIC:
        opcodeSize = 0;
        E.host.resumeMusic();
        break;
      case FUNC.SWAP_MUSIC_TRACK:
        opcodeSize = 0;
        E.trackID = ops[1];
        E.host.swapMusicTrack(text, ops[1], ops[2] <= 1 ? 0 : ops[2], ops[3]);
        break;
      case FUNC.PLAY_SFX:
        opcodeSize = 0;
        E.host.playSfx(ops[0], ops[1]);
        break;
      case FUNC.STOP_SFX:
        opcodeSize = 0;
        E.host.stopSfx(ops[0]);
        break;
      case FUNC.SET_SFX_ATTRIBUTES:
        opcodeSize = 0;
        E.host.setSfxAttributes(ops[0], ops[1], ops[2]);
        break;
      case FUNC.OBJECT_TILE_COLLISION:
        opcodeSize = 0;
        switch (ops[0]) {
          case CSIDE_FLOOR: Col.ObjectFloorCollision(E, ops[1], ops[2], ops[3]); break;
          case CSIDE_LWALL: Col.ObjectLWallCollision(E, ops[1], ops[2], ops[3]); break;
          case CSIDE_RWALL: Col.ObjectRWallCollision(E, ops[1] - 1, ops[2], ops[3]); break;
          case CSIDE_ROOF: Col.ObjectRoofCollision(E, ops[1], ops[2] - 1, ops[3]); break;
          case CSIDE_LENTITY: Col.ObjectLWallCollision(E, ops[2], 0, E.objectEntityList[ops[1]].collisionPlane); break;
          case CSIDE_RENTITY: Col.ObjectLWallCollision(E, ops[2] - 1, 0, E.objectEntityList[ops[1]].collisionPlane); break;
        }
        break;
      case FUNC.OBJECT_TILE_GRIP:
        opcodeSize = 0;
        switch (ops[0]) {
          case CSIDE_FLOOR: Col.ObjectFloorGrip(E, ops[1], ops[2], ops[3]); break;
          case CSIDE_LWALL: Col.ObjectLWallGrip(E, ops[1], ops[2], ops[3]); break;
          case CSIDE_RWALL: Col.ObjectRWallGrip(E, ops[1] - 1, ops[2], ops[3]); break;
          case CSIDE_ROOF: Col.ObjectRoofGrip(E, ops[1], ops[2] - 1, ops[3]); break;
          case CSIDE_LENTITY: Col.ObjectLEntityGrip(E, ops[1], ops[2], ops[3]); break;
          case CSIDE_RENTITY: Col.ObjectREntityGrip(E, ops[1], ops[2], ops[3]); break;
        }
        break;
      case FUNC.NOT: ops[0] = ~ops[0]; break;
      case FUNC.DRAW3DSCENE:
        opcodeSize = 0;
        S3D.TransformVertexBuffer(E);
        S3D.Sort3DDrawList(E);
        if (draw) draw.Draw3DScene(E, scriptInfo.spriteSheetID);
        break;
      case FUNC.SET_IDENTITY_MATRIX: {
        opcodeSize = 0;
        const m = matrixOf(E, ops[0]);
        if (m) S3D.SetIdentityMatrix(m);
        break;
      }
      case FUNC.MATRIX_MULTIPLY: {
        opcodeSize = 0;
        const a = matrixOf(E, ops[0]), b = matrixOf(E, ops[1]);
        if (a && b) S3D.MatrixMultiply(a, b);
        break;
      }
      case FUNC.MATRIX_TRANSLATE_XYZ: {
        opcodeSize = 0;
        const m = matrixOf(E, ops[0]);
        if (m) S3D.MatrixTranslateXYZ(m, ops[1], ops[2], ops[3]);
        break;
      }
      case FUNC.MATRIX_SCALE_XYZ: {
        opcodeSize = 0;
        const m = matrixOf(E, ops[0]);
        if (m) S3D.MatrixScaleXYZ(m, ops[1], ops[2], ops[3]);
        break;
      }
      case FUNC.MATRIX_ROTATE_X: { opcodeSize = 0; const m = matrixOf(E, ops[0]); if (m) S3D.MatrixRotateX(m, ops[1]); break; }
      case FUNC.MATRIX_ROTATE_Y: { opcodeSize = 0; const m = matrixOf(E, ops[0]); if (m) S3D.MatrixRotateY(m, ops[1]); break; }
      case FUNC.MATRIX_ROTATE_Z: { opcodeSize = 0; const m = matrixOf(E, ops[0]); if (m) S3D.MatrixRotateZ(m, ops[1]); break; }
      case FUNC.MATRIX_ROTATE_XYZ: { opcodeSize = 0; const m = matrixOf(E, ops[0]); if (m) S3D.MatrixRotateXYZ(m, ops[1], ops[2], ops[3]); break; }
      case FUNC.MATRIX_INVERSE: { opcodeSize = 0; const m = matrixOf(E, ops[0]); if (m) S3D.MatrixInverse(m); break; }
      case FUNC.TRANSFORM_VERTICES: { opcodeSize = 0; const m = matrixOf(E, ops[0]); if (m) S3D.TransformVertices(E, m, ops[1], ops[2]); break; }
      case FUNC.CALL_FUNCTION: {
        opcodeSize = 0;
        fns[fnPos++] = ptr;
        fns[fnPos++] = jumpTableStart;
        fns[fnPos++] = scriptCodeStart;
        const fn = E.scriptFunctionList[ops[0]];
        scriptCodeStart = fn.ptr.scriptCodePtr;
        jumpTableStart = fn.ptr.jumpTablePtr;
        ptr = scriptCodeStart;
        break;
      }
      case FUNC.RETURN:
        opcodeSize = 0;
        if (!fnPos) running = false;
        else {
          scriptCodeStart = fns[--fnPos];
          jumpTableStart = fns[--fnPos];
          ptr = fns[--fnPos];
        }
        break;
      case FUNC.SET_LAYER_DEFORMATION:
        opcodeSize = 0;
        SetLayerDeformation(E, ops[0], ops[1], ops[2], ops[3], ops[4], ops[5]);
        break;
      case FUNC.CHECK_TOUCH_RECT:
        opcodeSize = 0;
        E.checkResult = -1;
        break;
      case FUNC.GET_TILE_LAYER_ENTRY:
        ops[0] = E.stageLayouts[ops[1]].tiles[ops[2] + 0x100 * ops[3]];
        break;
      case FUNC.SET_TILE_LAYER_ENTRY:
        E.stageLayouts[ops[1]].tiles[ops[2] + 0x100 * ops[3]] = ops[0];
        break;
      case FUNC.GET_BIT: ops[0] = (ops[1] & (1 << ops[2])) >> ops[2]; break;
      case FUNC.SET_BIT:
        if (ops[2] <= 0) ops[0] &= ~(1 << ops[1]);
        else ops[0] |= 1 << ops[1];
        break;
      case FUNC.CLEAR_DRAW_LIST:
        opcodeSize = 0;
        E.drawListEntries[ops[0]].listSize = 0;
        break;
      case FUNC.ADD_DRAW_LIST_ENTITY_REF: {
        opcodeSize = 0;
        const l = E.drawListEntries[ops[0]];
        if (l) l.entityRefs[l.listSize++] = ops[1];
        break;
      }
      case FUNC.GET_DRAW_LIST_ENTITY_REF: ops[0] = E.drawListEntries[ops[1]].entityRefs[ops[2]]; break;
      case FUNC.SET_DRAW_LIST_ENTITY_REF:
        opcodeSize = 0;
        E.drawListEntries[ops[1]].entityRefs[ops[2]] = ops[0];
        break;
      case FUNC.GET16X16TILE_INFO: {
        ops[4] = ops[1] >> 7;
        ops[5] = ops[2] >> 7;
        ops[6] = E.stageLayouts[0].tiles[ops[4] + (ops[5] << 8)] << 6;
        ops[6] += ((ops[1] & 0x7f) >> 4) + 8 * ((ops[2] & 0x7f) >> 4);
        const t = E.tiles128x128;
        const index = t.tileIndex[ops[6]];
        switch (ops[3]) {
          case TILEINFO_INDEX: ops[0] = t.tileIndex[ops[6]]; break;
          case TILEINFO_DIRECTION: ops[0] = t.direction[ops[6]]; break;
          case TILEINFO_VISUALPLANE: ops[0] = t.visualPlane[ops[6]]; break;
          case TILEINFO_SOLIDITYA: ops[0] = t.collisionFlags[0][ops[6]]; break;
          case TILEINFO_SOLIDITYB: ops[0] = t.collisionFlags[1][ops[6]]; break;
          case TILEINFO_FLAGSA: ops[0] = E.collisionMasks[0].flags[index]; break;
          case TILEINFO_ANGLEA: ops[0] = E.collisionMasks[0].angles[index]; break;
          case TILEINFO_FLAGSB: ops[0] = E.collisionMasks[1].flags[index]; break;
          case TILEINFO_ANGLEB: ops[0] = E.collisionMasks[1].angles[index]; break;
        }
        break;
      }
      case FUNC.SET16X16TILE_INFO: {
        ops[4] = ops[1] >> 7;
        ops[5] = ops[2] >> 7;
        ops[6] = E.stageLayouts[0].tiles[ops[4] + (ops[5] << 8)] << 6;
        ops[6] += ((ops[1] & 0x7f) >> 4) + 8 * ((ops[2] & 0x7f) >> 4);
        const t = E.tiles128x128;
        switch (ops[3]) {
          case TILEINFO_INDEX:
            t.tileIndex[ops[6]] = ops[0];
            t.gfxDataPos[ops[6]] = ops[0] << 8;
            break;
          case TILEINFO_DIRECTION: t.direction[ops[6]] = ops[0]; break;
          case TILEINFO_VISUALPLANE: t.visualPlane[ops[6]] = ops[0]; break;
          case TILEINFO_SOLIDITYA: t.collisionFlags[0][ops[6]] = ops[0]; break;
          case TILEINFO_SOLIDITYB: t.collisionFlags[1][ops[6]] = ops[0]; break;
          case TILEINFO_FLAGSA: E.collisionMasks[1].flags[t.tileIndex[ops[6]]] = ops[0]; break;
          case TILEINFO_ANGLEA: E.collisionMasks[1].angles[t.tileIndex[ops[6]]] = ops[0]; break;
        }
        break;
      }
      case FUNC.COPY16X16TILE: {
        opcodeSize = 0;
        const g = E.tilesetGFXData;
        g.copyWithin(0x100 * (ops[0] & 0xffff), 0x100 * (ops[1] & 0xffff), 0x100 * (ops[1] & 0xffff) + 0x100);
        break;
      }
      case FUNC.GET_ANIMATION_BY_NAME: {
        const animFile = scriptInfo.animFile;
        ops[0] = -1;
        let id = 0;
        while (ops[0] === -1) {
          const anim = E.animationList[animFile.aniListOffset + id];
          if (anim && StrComp(text, anim.name)) ops[0] = id;
          else if (++id >= animFile.animCount) ops[0] = 0;
        }
        break;
      }
      case FUNC.READ_SAVE_RAM:
        opcodeSize = 0;
        E.checkResult = 1;
        break;
      case FUNC.WRITE_SAVE_RAM:
        opcodeSize = 0;
        E.checkResult = 1;
        break;
      case FUNC.LOAD_TEXT_FILE:
        opcodeSize = 0;
        Text.LoadTextFile(E, E.gameMenu[ops[0]], text);
        break;
      case FUNC.GET_TEXT_INFO: {
        const menu = E.gameMenu[ops[1]];
        switch (ops[2]) {
          case TEXTINFO_TEXTDATA: ops[0] = menu.textData[menu.entryStart[ops[3]] + ops[4]] ?? 0; break;
          case TEXTINFO_TEXTSIZE: ops[0] = menu.entrySize[ops[3]] ?? 0; break;
          case TEXTINFO_ROWCOUNT: ops[0] = menu.rowCount; break;
        }
        break;
      }
      case FUNC.GET_VERSION_NUMBER: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        menu.entryHighlight[menu.rowCount] = ops[1];
        Text.AddTextMenuEntry(menu, "Ring Link");
        break;
      }
      case FUNC.GET_TABLE_VALUE: {
        const arrPosV = ops[1];
        if (arrPosV >= 0) {
          const pos = ops[2];
          if (arrPosV < code[pos]) ops[0] = code[pos + arrPosV + 1];
        }
        break;
      }
      case FUNC.SET_TABLE_VALUE: {
        opcodeSize = 0;
        const arrPosV = ops[1];
        if (arrPosV >= 0) {
          const pos = ops[2];
          if (arrPosV < code[pos]) code[pos + arrPosV + 1] = ops[0];
        }
        break;
      }
      case FUNC.CHECK_CURRENT_STAGE_FOLDER: {
        opcodeSize = 0;
        const folder = E.stageList[E.activeStageList][E.stageListPosition]?.folder ?? "";
        let r = StrComp(folder, text);
        if (!r && folder.length > text.length) r = StrComp(folder.slice(folder.length - text.length), text);
        E.checkResult = +r;
        break;
      }
      case FUNC.ABS: ops[0] = Math.abs(ops[0]); break;
      case FUNC.CALL_NATIVE_FUNCTION:
        opcodeSize = 0;
        callNative(E, ops[0], ops, 1, "");
        break;
      case FUNC.CALL_NATIVE_FUNCTION2:
        callNative(E, ops[0], ops, text.length ? 2 : 1, text);
        break;
      case FUNC.CALL_NATIVE_FUNCTION4:
        callNative(E, ops[0], ops, 1, text);
        break;
      case FUNC.SET_OBJECT_RANGE: {
        opcodeSize = 0;
        const offset = (ops[0] >> 1) - E.SCREEN_CENTERX;
        E.OBJECT_BORDER_X1 = offset + 0x80;
        E.OBJECT_BORDER_X2 = ops[0] + 0x80 - offset;
        E.OBJECT_BORDER_X3 = offset + 0x20;
        E.OBJECT_BORDER_X4 = ops[0] + 0x20 - offset;
        break;
      }
      case FUNC.GET_OBJECT_VALUE:
        if (ops[1] < 48) ops[0] = E.entityBuffer[ops[2] * ENT_STRIDE + F.values + ops[1]];
        break;
      case FUNC.SET_OBJECT_VALUE:
        opcodeSize = 0;
        if (ops[1] < 48) E.entityBuffer[ops[2] * ENT_STRIDE + F.values + ops[1]] = ops[0];
        break;
      case FUNC.COPY_OBJECT: {
        const dst = ops[0] * ENT_STRIDE, src = ops[1] * ENT_STRIDE;
        E.entityBuffer.copyWithin(dst, src, src + ops[2] * ENT_STRIDE);
        break;
      }
      case FUNC.PRINT:
        E.host.log(ops[1] ? String(ops[0]) : text);
        break;
      case FUNC.CHECK_CAMERA_PROXIMITY: {
        E.checkResult = 0;
        // true if any player's camera is close enough
        for (let c = 0; c < Math.max(1, E.camCount); c++) {
          const cx = E.cams[c * CAM_STRIDE + CAM_INDEX.cameraXPos];
          const cy = E.cams[c * CAM_STRIDE + CAM_INDEX.cameraYPos];
          const sx = Math.abs(ops[0] - cx), sy = Math.abs(ops[1] - cy);
          if (ops[2] > 0 && ops[3] > 0) { if (sx < ops[2] && sy < ops[3]) E.checkResult = 1; }
          else if (ops[2] > 0) { if (sx < ops[2]) E.checkResult = 1; }
          else if (ops[3] > 0) { if (sy < ops[3]) E.checkResult = 1; }
        }
        break;
      }
      case FUNC.SET_SCREEN_COUNT: break;
      case FUNC.SET_SCREEN_VERTICES: break;
      case FUNC.GET_INPUT_DEVICE_ID: ops[0] = ops[1]; break;
      case FUNC.GET_FILTERED_INPUT_DEVICE_ID: break;
      case FUNC.GET_INPUT_DEVICE_TYPE: break;
      case FUNC.IS_INPUT_DEVICE_ASSIGNED: break;
      case FUNC.ASSIGN_INPUT_SLOT_TO_DEVICE: break;
      case FUNC.IS_INPUT_SLOT_ASSIGNED: E.checkResult = +(ops[0] >= 1 && ops[0] <= E.playerSlots); break;
      case FUNC.RESET_INPUT_SLOT_ASSIGNMENTS: break;
      default: break;
    }

    // write back
    if (opcodeSize > 0) ptr = scriptCodeOffset;
    for (let i = 0; i < opcodeSize; ++i) {
      const opcodeType = code[ptr++];
      if (opcodeType === SCRIPTVAR_VAR) {
        let arrayVal = 0;
        switch (code[ptr++]) {
          case VARARR_NONE: arrayVal = E.objectEntityPos; break;
          case VARARR_ARRAY: arrayVal = code[ptr++] === 1 ? arrPos[code[ptr++]] : code[ptr++]; break;
          case VARARR_ENTNOPLUS1: arrayVal = E.objectEntityPos + (code[ptr++] === 1 ? arrPos[code[ptr++]] : code[ptr++]); break;
          case VARARR_ENTNOMINUS1: arrayVal = E.objectEntityPos - (code[ptr++] === 1 ? arrPos[code[ptr++]] : code[ptr++]); break;
        }
        writeVar(E, code[ptr++], arrayVal, ops[i]);
      } else if (opcodeType === SCRIPTVAR_INTCONST) {
        ptr++;
      } else if (opcodeType === SCRIPTVAR_STRCONST) {
        const strLen = code[ptr++];
        ptr += strLen >> 2;
        ptr++;
      }
    }
  }
}

function callNative(E: Engine, id: number, ops: Int32Array, argIndex: number, text: string): void {
  const name = E.nativeFunctionNames[id];
  if (!name) return;
  E.host.nativeFunction?.(name, ops, argIndex, text);
}

function drawActName(E: Engine, frameOffset: number, sheet: number, ops: Int32Array): void {
  const draw = E.draw!;
  const t = E.titleCardText;
  const ch = (i: number) => (i < t.length ? t.charCodeAt(i) : 0);
  const glyph = (character: number, space: number): number => {
    if (character === 32) character = space;
    if (character === 45) character = 0;
    if (character >= 48 && character <= 57) character -= 22;
    if (character > 57 && character < 102) character -= 65;
    return character;
  };
  const put = (character: number, advanceLeft: boolean) => {
    if (character <= -1) {
      ops[1] += advanceLeft ? -(ops[5] + ops[6]) : ops[5] + ops[6];
      return;
    }
    character += ops[0];
    const f = E.scriptFrames[frameOffset + character];
    if (!f) return;
    if (advanceLeft) ops[1] -= f.width + ops[6];
    draw.DrawSprite(E, ops[1] + f.pivotX, ops[2] + f.pivotY, f.width, f.height, f.sprX, f.sprY, sheet);
    if (!advanceLeft) ops[1] += f.width + ops[6];
  };
  switch (ops[3]) {
    case 0: {
      let charID = 0;
      for (charID = 0; ; ++charID) {
        const next = ch(charID + 1);
        if (next === 45 || !next) break;
      }
      while (charID >= 0) {
        put(glyph(ch(charID), -1), true);
        charID--;
      }
      break;
    }
    case 1: {
      let charID = 0;
      if (ops[4] === 1 && ch(charID) !== 0) {
        put(glyph(ch(charID), -1), false);
        ops[0] += 26;
        charID++;
      }
      while (ch(charID) !== 0 && ch(charID) !== 45) {
        put(glyph(ch(charID), -1), false);
        charID++;
      }
      break;
    }
    case 2: {
      let charID = E.titleCardWord2;
      if (ops[4] === 1 && ch(charID) !== 0) {
        put(glyph(ch(charID), 0), false);
        ops[0] += 26;
        charID++;
      }
      while (ch(charID) !== 0) {
        put(glyph(ch(charID), 0), false);
        charID++;
      }
      break;
    }
  }
}

export { DRAWLAYER_COUNT };
