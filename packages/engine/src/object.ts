// Object.cpp: running object scripts each frame.
//
// Multi-camera change: an object is active when it is within range of ANY player's camera (the 2P variant of the
// original did the same around player positions), and while an object's script runs, the "screen" it sees is the
// camera nearest to it. Player objects always see their own camera.

import type { Engine } from "./engine.js";
import type { Entity } from "./entity.js";
import {
  ENTITY_COUNT, TEMPENTITY_START, OBJECT_COUNT, TYPEGROUP_COUNT, GROUP_ALL, DRAWLAYER_COUNT, OBJ_TYPE_BLANKOBJECT,
  PRIORITY_BOUNDS, PRIORITY_ACTIVE, PRIORITY_ALWAYS, PRIORITY_XBOUNDS, PRIORITY_XBOUNDS_DESTROY, PRIORITY_INACTIVE,
  PRIORITY_BOUNDS_SMALL, PRIORITY_ACTIVE_SMALL, OBJECT_BORDER_Y1, OBJECT_BORDER_Y2, OBJECT_BORDER_Y3, OBJECT_BORDER_Y4,
  EVENT_MAIN, EVENT_SETUP,
} from "./c.js";
import { ProcessScript } from "./script/vm.js";
import { ClearAnimationData } from "./animation.js";
import { CAM_STRIDE, CAM_INDEX } from "./engine.js";
import { BTN } from "./input.js";

const XOFF = CAM_INDEX.xScrollOffset;
const YOFF = CAM_INDEX.yScrollOffset;

export function ProcessStartupObjects(E: Engine): void {
  E.scriptFrameCount = 0;
  ClearAnimationData(E);
  E.scriptEng.arrayPosition[8] = TEMPENTITY_START;
  E.OBJECT_BORDER_X1 = 0x80;
  E.OBJECT_BORDER_X3 = 0x20;
  E.OBJECT_BORDER_X2 = E.SCREEN_XSIZE + 0x80;
  E.OBJECT_BORDER_X4 = E.SCREEN_XSIZE + 0x20;
  const entity = E.objectEntityList[TEMPENTITY_START];
  E.objectEntityList[TEMPENTITY_START + 1].type = E.objectEntityList[0].type;
  E.foreachStack.fill(-1);
  E.jumpTableStack.fill(0);
  for (let i = 0; i < OBJECT_COUNT; ++i) {
    const scriptInfo = E.objectScriptList[i];
    E.objectEntityPos = TEMPENTITY_START;
    E.curObjectType = i;
    scriptInfo.frameListOffset = E.scriptFrameCount;
    scriptInfo.spriteSheetID = 0;
    entity.type = i;
    if (E.scriptCode[scriptInfo.eventStartup.scriptCodePtr] > 0)
      ProcessScript(E, scriptInfo.eventStartup.scriptCodePtr, scriptInfo.eventStartup.jumpTablePtr, EVENT_SETUP);
    scriptInfo.frameCount = E.scriptFrameCount - scriptInfo.frameListOffset;
  }
  entity.type = 0;
  E.curObjectType = 0;
}

/** Is the entity within the (large or small) activity bounds of camera c? */
function inCamBounds(E: Engine, c: number, x: number, y: number, small: boolean, xOnly: boolean): boolean {
  const xo = E.cams[c * CAM_STRIDE + XOFF];
  const yo = E.cams[c * CAM_STRIDE + YOFF];
  if (small) return x > xo - E.OBJECT_BORDER_X3 && x < E.OBJECT_BORDER_X4 + xo && y > yo - OBJECT_BORDER_Y3 && y < yo + OBJECT_BORDER_Y4;
  if (xOnly) return x > xo - E.OBJECT_BORDER_X1 && x < E.OBJECT_BORDER_X2 + xo;
  return x > xo - E.OBJECT_BORDER_X1 && x < xo + E.OBJECT_BORDER_X2 && y > yo - OBJECT_BORDER_Y1 && y < yo + OBJECT_BORDER_Y2;
}

function inAnyCam(E: Engine, x: number, y: number, small: boolean, xOnly: boolean): boolean {
  for (let c = 0; c < E.camCount; c++) if (inCamBounds(E, c, x, y, small, xOnly)) return true;
  return false;
}

/** The camera an entity's script sees: a player's own camera, otherwise the camera closest to the entity. */
export function cameraForEntity(E: Engine, slot: number): number {
  if (E.camCount <= 1) return 0;
  if (slot < E.camCount) return slot;
  const ent = E.objectEntityList[slot];
  // level controllers (always-active objects such as StageSetup and the HUD) follow player 1's camera
  if (ent.priority === PRIORITY_ACTIVE || ent.priority === PRIORITY_ALWAYS) return 0;
  const x = ent.xpos >> 16, y = ent.ypos >> 16;
  let best = 0, bestD = Infinity;
  const hw = E.SCREEN_XSIZE >> 1;
  for (let c = 0; c < E.camCount; c++) {
    const b = c * CAM_STRIDE;
    const d = Math.abs(x - (E.cams[b + XOFF] + hw)) + Math.abs(y - (E.cams[b + YOFF] + 120));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function activity(E: Engine, entity: Entity): boolean {
  const x = entity.xpos >> 16;
  const y = entity.ypos >> 16;
  switch (entity.priority) {
    case PRIORITY_BOUNDS: return inAnyCam(E, x, y, false, false);
    case PRIORITY_ACTIVE:
    case PRIORITY_ALWAYS:
    case PRIORITY_ACTIVE_SMALL: return true;
    case PRIORITY_XBOUNDS: return inAnyCam(E, x, y, false, true);
    case PRIORITY_XBOUNDS_DESTROY: {
      const r = inAnyCam(E, x, y, false, true);
      if (!r) entity.type = OBJ_TYPE_BLANKOBJECT;
      return r;
    }
    case PRIORITY_INACTIVE: return false;
    case PRIORITY_BOUNDS_SMALL: return inAnyCam(E, x, y, true, false);
    default: return false;
  }
}

function buildTypeGroupLists(E: Engine): void {
  for (let i = 0; i < TYPEGROUP_COUNT; ++i) E.objectTypeGroupList[i].listSize = 0;
  const all = E.objectTypeGroupList[GROUP_ALL];
  for (let p = 0; p < ENTITY_COUNT; ++p) {
    const entity = E.objectEntityList[p];
    if (E.processObjectFlag[p] && entity.objectInteractions) {
      if (entity.groupID >= OBJECT_COUNT) {
        const listCustom = E.objectTypeGroupList[entity.groupID];
        if (listCustom) listCustom.entityRefs[listCustom.listSize++] = p;
      }
      const listType = E.objectTypeGroupList[entity.type];
      listType.entityRefs[listType.listSize++] = p;
      all.entityRefs[all.listSize++] = p;
    }
  }
  E.objectEntityPos = ENTITY_COUNT;
}

function addToDrawList(E: Engine, entity: Entity, slot: number): void {
  if (entity.drawOrder < DRAWLAYER_COUNT) {
    const l = E.drawListEntries[entity.drawOrder];
    l.entityRefs[l.listSize++] = slot;
  }
}

function runMain(E: Engine, slot: number, entity: Entity): void {
  const scriptInfo = E.objectScriptList[entity.type];
  if (E.scriptCode[scriptInfo.eventUpdate.scriptCodePtr] > 0) {
    E.setCamera(cameraForEntity(E, slot));
    ProcessScript(E, scriptInfo.eventUpdate.scriptCodePtr, scriptInfo.eventUpdate.jumpTablePtr, EVENT_MAIN);
  }
}

export function ProcessObjects(E: Engine): void {
  for (let i = 0; i < DRAWLAYER_COUNT; ++i) E.drawListEntries[i].listSize = 0;
  for (E.objectEntityPos = 0; E.objectEntityPos < ENTITY_COUNT; ++E.objectEntityPos) {
    const slot = E.objectEntityPos;
    const entity = E.objectEntityList[slot];
    const active = activity(E, entity);
    E.processObjectFlag[slot] = +active;
    if (active && entity.type > OBJ_TYPE_BLANKOBJECT) {
      runMain(E, E.objectEntityPos, entity);
      // as in the original, the draw order comes from the entity that started the update and the slot from
      // objectEntityPos, which a script may have moved (stage.entityPos)
      addToDrawList(E, entity, E.objectEntityPos);
    }
  }
  buildTypeGroupLists(E);
  E.setCamera(0);
}

export function ProcessPausedObjects(E: Engine): void {
  for (let i = 0; i < DRAWLAYER_COUNT; ++i) E.drawListEntries[i].listSize = 0;
  for (E.objectEntityPos = 0; E.objectEntityPos < ENTITY_COUNT; ++E.objectEntityPos) {
    const entity = E.objectEntityList[E.objectEntityPos];
    if (entity.priority === PRIORITY_ALWAYS && entity.type > OBJ_TYPE_BLANKOBJECT) {
      runMain(E, E.objectEntityPos, entity);
      addToDrawList(E, entity, E.objectEntityPos);
    }
  }
  E.setCamera(0);
}

export function ProcessFrozenObjects(E: Engine): void {
  for (let i = 0; i < DRAWLAYER_COUNT; ++i) E.drawListEntries[i].listSize = 0;
  for (E.objectEntityPos = 0; E.objectEntityPos < ENTITY_COUNT; ++E.objectEntityPos) {
    const slot = E.objectEntityPos;
    const entity = E.objectEntityList[slot];
    const active = activity(E, entity);
    E.processObjectFlag[slot] = +active;
    if (active && entity.type > OBJ_TYPE_BLANKOBJECT) {
      if (entity.priority === PRIORITY_ALWAYS) runMain(E, slot, entity);
      addToDrawList(E, entity, slot);
    }
  }
  buildTypeGroupLists(E);
  E.setCamera(0);
}

/** The 2P mode of the original (activity around both players' positions rather than the camera). */
export function Process2PObjects(E: Engine): void {
  for (let i = 0; i < DRAWLAYER_COUNT; ++i) E.drawListEntries[i].listSize = 0;
  const bx1 = -(0x200 << 16), bx2 = 0x200 << 16, bx3 = -(0x180 << 16), bx4 = 0x180 << 16;
  const by1 = -(0x180 << 16), by2 = 0x180 << 16, by3 = -(0x100 << 16), by4 = 0x100 << 16;
  for (E.objectEntityPos = 0; E.objectEntityPos < ENTITY_COUNT; ++E.objectEntityPos) {
    const slot = E.objectEntityPos;
    const entity = E.objectEntityList[slot];
    const x = entity.xpos, y = entity.ypos;
    const p1 = E.objectEntityList[0], p2 = E.objectEntityList[1];
    const near = (dx1: number, dx2: number, dy1: number, dy2: number, xOnly: boolean) =>
      (x > p1.xpos + dx1 && x < p1.xpos + dx2 && (xOnly || (y > p1.ypos + dy1 && y < p1.ypos + dy2))) ||
      (x > p2.xpos + dx1 && x < p2.xpos + dx2 && (xOnly || (y > p2.ypos + dy1 && y < p2.ypos + dy2)));
    let active = false;
    switch (entity.priority) {
      case PRIORITY_BOUNDS: active = near(bx1, bx2, by1, by2, false); break;
      case PRIORITY_ACTIVE: case PRIORITY_ALWAYS: case PRIORITY_ACTIVE_SMALL: active = true; break;
      case PRIORITY_XBOUNDS: active = near(bx1, bx2, 0, 0, true); break;
      case PRIORITY_XBOUNDS_DESTROY: active = near(bx1, bx2, 0, 0, true); if (!active) entity.type = OBJ_TYPE_BLANKOBJECT; break;
      case PRIORITY_INACTIVE: active = false; break;
      case PRIORITY_BOUNDS_SMALL: active = near(bx3, bx4, by3, by4, false); break;
    }
    E.processObjectFlag[slot] = +active;
    if (active && entity.type > OBJ_TYPE_BLANKOBJECT) {
      runMain(E, slot, entity);
      addToDrawList(E, entity, slot);
    }
  }
  buildTypeGroupLists(E);
  E.setCamera(0);
}

/** VAR_OBJECTOUTOFBOUNDS: out of range of every camera. */
export function ObjectOutOfBounds(E: Engine, entity: Entity): boolean {
  const small = entity.priority === PRIORITY_BOUNDS_SMALL || entity.priority === PRIORITY_ACTIVE_SMALL;
  const x = entity.xpos >> 16, y = entity.ypos >> 16;
  for (let c = 0; c < E.camCount; c++) {
    const b = c * CAM_STRIDE;
    const xo = E.cams[b + XOFF], yo = E.cams[b + YOFF];
    const inside = small
      ? x > xo - E.OBJECT_BORDER_X3 && x < xo + E.OBJECT_BORDER_X4 && y > yo - OBJECT_BORDER_Y3 && y < yo + OBJECT_BORDER_Y4
      : x > xo - E.OBJECT_BORDER_X1 && x < xo + E.OBJECT_BORDER_X2 && y > yo - OBJECT_BORDER_Y1 && y < yo + OBJECT_BORDER_Y2;
    if (inside) return false;
  }
  return true;
}

/** ProcessObjectControl: copy a player's pad into the object (controlMode < 0 means control is locked). */
export function ProcessObjectControl(E: Engine, entity: Entity): void {
  const mode = entity.controlMode;
  if (mode < 0) return;
  // The mobile scripts set every player to CONTROLMODE_P1 (one pad); each player object reads its own pad.
  const pad = entity.slot < E.playerSlots ? entity.slot : mode;
  if (pad >= E.playerSlots) return;
  const down = E.inputDown[pad];
  const press = E.inputPress[pad];
  entity.up = (down & BTN.UP) !== 0;
  entity.down = (down & BTN.DOWN) !== 0;
  const l = (down & BTN.LEFT) !== 0, r = (down & BTN.RIGHT) !== 0;
  if (!l || !r) {
    entity.left = l;
    entity.right = r;
  } else {
    entity.left = false;
    entity.right = false;
  }
  entity.jumpHold = (down & (BTN.A | BTN.B | BTN.C)) !== 0;
  entity.jumpPress = (press & (BTN.A | BTN.B | BTN.C)) !== 0;
}
