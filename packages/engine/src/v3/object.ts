// Object.cpp and Player.cpp (RSDKv3): the object update loops and player control.

import type { Engine3 } from "./engine.js";
import type { Player3 } from "./entity.js";
import * as C from "./consts.js";
import { BTN } from "../input.js";
import { ProcessScript } from "./script/vm.js";
import { ClearAnimationData } from "./animation.js";
import { CAM3_STRIDE, CAM3_INDEX } from "./engine.js";

export function SetObjectTypeName(E: Engine3, objectName: string, objectID: number): void {
  E.typeNames[objectID] = objectName.replace(/ /g, "");
}

const hasCode = (E: Engine3, ptr: number) => E.scriptCode[ptr] > 0;

export function ProcessStartupObjects(E: Engine3): void {
  E.scriptFrameCount = 0;
  ClearAnimationData(E);
  E.activePlayer = 0;
  E.activePlayerCount = E.playerSlots > 1 ? E.playerSlots : 1;
  E.arrayPosition[2] = C.TEMPENTITY_START;
  const entity = E.objectEntityList[C.TEMPENTITY_START];
  for (let i = 0; i < C.OBJECT_COUNT; ++i) {
    const scriptInfo = E.objectScriptList[i];
    E.objectLoop = C.TEMPENTITY_START;
    E.curObjectType = i;
    scriptInfo.frameListOffset = E.scriptFrameCount;
    scriptInfo.spriteSheetID = 0;
    entity.type = i;
    if (hasCode(E, scriptInfo.subStartup.scriptCodePtr))
      ProcessScript(E, scriptInfo.subStartup.scriptCodePtr, scriptInfo.subStartup.jumpTablePtr, C.SUB_SETUP);
    scriptInfo.frameCount = E.scriptFrameCount - scriptInfo.frameListOffset;
  }
  entity.type = 0;
  E.curObjectType = 0;
}

/** Whether an entity is active this frame (in bounds of any player's camera, for the bounds priorities). */
function isActive(E: Engine3, objectLoop: number): boolean {
  const entity = E.objectEntityList[objectLoop];
  const priority = entity.priority;
  if (priority === C.PRIORITY_ACTIVE || priority === C.PRIORITY_ALWAYS) return true;
  if (priority === C.PRIORITY_INACTIVE) return false;
  if (priority !== C.PRIORITY_BOUNDS && priority !== C.PRIORITY_XBOUNDS && priority !== C.PRIORITY_BOUNDS_DESTROY) return false;
  const x = entity.xpos >> 16, y = entity.ypos >> 16;
  let inBounds = false;
  const prev = E.curCam;
  for (let c = 0; c < E.camCount && !inBounds; ++c) {
    E.setCamera(c);
    const inX = x > E.xScrollOffset - E.OBJECT_BORDER_X1 && x < E.OBJECT_BORDER_X2 + E.xScrollOffset;
    const inY = y > E.yScrollOffset - C.OBJECT_BORDER_Y1 && y < E.yScrollOffset + C.SCREEN_YSIZE + 0x100;
    inBounds = priority === C.PRIORITY_XBOUNDS ? inX : inX && inY;
  }
  E.setCamera(prev);
  if (!inBounds && priority === C.PRIORITY_BOUNDS_DESTROY) entity.type = 0;
  return inBounds;
}

/**
 * The camera an object's scripts see (co-op): a player's own camera for player slots, player 1's for always-active
 * controllers (StageSetup, the HUD), otherwise the nearest camera. Always camera 0 with one player.
 */
export function cameraForEntity(E: Engine3, slot: number): number {
  if (E.camCount <= 1) return 0;
  if (slot < E.camCount) return slot;
  const ent = E.objectEntityList[slot];
  if (ent.priority === C.PRIORITY_ACTIVE || ent.priority === C.PRIORITY_ALWAYS) return 0;
  const x = ent.xpos >> 16, y = ent.ypos >> 16;
  const hw = E.SCREEN_XSIZE >> 1;
  let best = 0, bestD = Infinity;
  for (let c = 0; c < E.camCount; c++) {
    const b = c * CAM3_STRIDE;
    const d = Math.abs(x - (E.cams[b + CAM3_INDEX.xScrollOffset] + hw)) + Math.abs(y - (E.cams[b + CAM3_INDEX.yScrollOffset] + 120));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function runObject(E: Engine3, objectLoop: number, playerCount: number): void {
  const entity = E.objectEntityList[objectLoop];
  const scriptInfo = E.objectScriptList[entity.type];
  E.setCamera(cameraForEntity(E, objectLoop));
  E.activePlayer = 0;
  if (hasCode(E, scriptInfo.subMain.scriptCodePtr)) ProcessScript(E, scriptInfo.subMain.scriptCodePtr, scriptInfo.subMain.jumpTablePtr, C.SUB_MAIN);
  if (hasCode(E, scriptInfo.subPlayerInteraction.scriptCodePtr)) {
    while (E.activePlayer < playerCount) {
      if (E.playerList[E.activePlayer].objectInteractions)
        ProcessScript(E, scriptInfo.subPlayerInteraction.scriptCodePtr, scriptInfo.subPlayerInteraction.jumpTablePtr, C.SUB_PLAYERINTERACTION);
      ++E.activePlayer;
    }
  }
  E.setCamera(0);
  const order = entity.drawOrder;
  if (order < C.DRAWLAYER_COUNT) {
    const l = E.drawListEntries[order];
    l.entityRefs[l.listSize++] = objectLoop;
  }
}

export function ProcessObjects(E: Engine3): void {
  for (let i = 0; i < C.DRAWLAYER_COUNT; ++i) E.drawListEntries[i].listSize = 0;
  for (E.objectLoop = 0; E.objectLoop < C.ENTITY_COUNT; ++E.objectLoop) {
    const objectLoop = E.objectLoop;
    if (isActive(E, objectLoop) && E.objectEntityList[objectLoop].type > 0) runObject(E, objectLoop, E.activePlayerCount);
  }
}

export function ProcessPausedObjects(E: Engine3): void {
  for (let i = 0; i < C.DRAWLAYER_COUNT; ++i) E.drawListEntries[i].listSize = 0;
  for (E.objectLoop = 0; E.objectLoop < C.ENTITY_COUNT; ++E.objectLoop) {
    const objectLoop = E.objectLoop;
    const entity = E.objectEntityList[objectLoop];
    if (entity.priority === C.PRIORITY_ALWAYS && entity.type > 0) runObject(E, objectLoop, C.PLAYER_COUNT);
  }
}

/**
 * ProcessPlayerControl. In co-op each human player is driven by their own pad; otherwise (and for player 1 in a
 * single-player game) by keyDown / keyPress, as in the original.
 */
export function ProcessPlayerControl(E: Engine3, player: Player3): void {
  let down = E.keyDown, press = E.keyPress;
  if (E.playerSlots > 1 && player.slot < E.playerSlots) {
    down = E.inputDown[player.slot];
    press = E.inputPress[player.slot];
  }
  const bit = (mask: number, b: number) => ((mask & b) !== 0 ? 1 : 0);
  switch (player.controlMode) {
    default:
    case C.CONTROLMODE_NORMAL:
      player.up = bit(down, BTN.UP);
      player.down = bit(down, BTN.DOWN);
      if (!bit(down, BTN.LEFT) || !bit(down, BTN.RIGHT)) {
        player.left = bit(down, BTN.LEFT);
        player.right = bit(down, BTN.RIGHT);
      } else {
        player.left = 0;
        player.right = 0;
      }
      player.jumpHold = bit(down, BTN.C) | bit(down, BTN.B) | bit(down, BTN.A);
      player.jumpPress = bit(press, BTN.C) | bit(press, BTN.B) | bit(press, BTN.A);
      pushBuffers(E, player);
      break;
    case C.CONTROLMODE_NONE:
      pushBuffers(E, player);
      break;
    case C.CONTROLMODE_SIDEKICK:
      player.up = E.upBuffer >> 15;
      player.down = E.downBuffer >> 15;
      player.left = E.leftBuffer >> 15;
      player.right = E.rightBuffer >> 15;
      player.jumpPress = E.jumpPressBuffer >> 15;
      player.jumpHold = E.jumpHoldBuffer >> 15;
      break;
  }
}

function pushBuffers(E: Engine3, player: Player3): void {
  E.upBuffer = (E.upBuffer << 1) | player.up;
  E.downBuffer = (E.downBuffer << 1) | player.down;
  E.leftBuffer = (E.leftBuffer << 1) | player.left;
  E.rightBuffer = (E.rightBuffer << 1) | player.right;
  E.jumpPressBuffer = (E.jumpPressBuffer << 1) | player.jumpPress;
  E.jumpHoldBuffer = (E.jumpHoldBuffer << 1) | player.jumpHold;
}
