// Collision.cpp (RSDKv3), ported line for line: player tile collision (sensors, air collision, path grip), object
// tile collision and grip, and player-object collision. The sensors' coordinates switch between 16.16 fixed point
// and whole pixels part-way through, and a few quirks (FindRWallPosition's `startX >> 16`) are kept on purpose.

import type { Engine3, CollisionSensor3 } from "./engine.js";
import type { Player3 } from "./entity.js";
import * as C from "./consts.js";
import { sin256LookupTable, cos256LookupTable, ArcTanLookup } from "../math.js";

type Sensor = CollisionSensor3;
const TS = C.TILE_SIZE;
const TSM1 = C.TILE_SIZE - 1;
const abs = Math.abs;
const u8 = (v: number) => v & 0xff;

function playerHitbox(E: Engine3, player: Player3) {
  const animFile = E.animationFileList[player.animationFile];
  const ent = E.objectEntityList[player.boundEntity];
  const hitboxID = E.animFrames[E.animationList[animFile.aniListOffset + ent.animation].frameListOffset + ent.frame].hitboxID;
  return E.hitboxList[hitboxID + animFile.hitboxListOffset];
}

/** The 16x16 tile under a world pixel: chunk-local tile id, or -1 off the map. */
function tileAt(E: Engine3, x: number, y: number): number {
  const chunk = E.stageLayouts[0].tiles[(x >> 7) + ((y >> 7) << 8)];
  if (chunk === undefined) return -1;
  return (chunk << 6) + ((x & 0x7f) >> 4) + (((y & 0x7f) >> 4) << 3);
}

// ---- sensor searches (path grip) -------------------------------------------------------------------------------

export function FindFloorPosition(E: Engine3, player: Player3, sensor: Sensor, startY: number): void {
  const angle = sensor.angle;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = sensor.xpos >> 16;
    const YPos = (sensor.ypos >> 16) + i - TS;
    const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    const solid = t.collisionFlags[plane][tile];
    if (solid !== C.SOLID_LRB && solid !== C.SOLID_NONE && solid !== undefined) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if (cm.floorMasks[c] >= 0x40) break;
          sensor.ypos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = cm.angles[tileIndex] & 0xff;
          break;
        }
        case C.FLIP_X: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if (cm.floorMasks[c] >= 0x40) break;
          sensor.ypos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - (cm.angles[tileIndex] & 0xff);
          break;
        }
        case C.FLIP_Y: {
          const c = (XPos & 15) + (tileIndex << 4);
          if (cm.roofMasks[c] <= -0x40) break;
          sensor.ypos = TSM1 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          const cAngle = cm.angles[tileIndex] >>> 24;
          sensor.angle = u8(-0x80 - cAngle);
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if (cm.roofMasks[c] <= -0x40) break;
          sensor.ypos = TSM1 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          const cAngle = cm.angles[tileIndex] >>> 24;
          sensor.angle = 0x100 - u8(-0x80 - cAngle);
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.angle < 0) sensor.angle += 0x100;
      if (sensor.angle > 0xff) sensor.angle -= 0x100;
      if (abs(sensor.angle - angle) > 0x20 && abs(sensor.angle - 0x100 - angle) > 0x20 && abs(sensor.angle + 0x100 - angle) > 0x20) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
        sensor.angle = angle;
        i = TS * 3;
      } else if (sensor.ypos - startY > TS - 2) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
      } else if (sensor.ypos - startY < -(TS - 2)) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
      }
    }
  }
}

export function FindLWallPosition(E: Engine3, player: Player3, sensor: Sensor, startX: number): void {
  const angle = sensor.angle;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = (sensor.xpos >> 16) + i - TS;
    const YPos = sensor.ypos >> 16;
    const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    if (t.collisionFlags[plane][tile] < C.SOLID_NONE) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if (cm.lWallMasks[c] >= 0x40) break;
          sensor.xpos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          sensor.angle = (cm.angles[tileIndex] & 0xff00) >> 8;
          break;
        }
        case C.FLIP_X: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if (cm.rWallMasks[c] <= -0x40) break;
          sensor.xpos = TSM1 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - ((cm.angles[tileIndex] & 0xff0000) >> 16);
          break;
        }
        case C.FLIP_Y: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if (cm.lWallMasks[c] >= 0x40) break;
          sensor.xpos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          const cAngle = (cm.angles[tileIndex] & 0xff00) >> 8;
          sensor.angle = u8(-0x80 - cAngle);
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if (cm.rWallMasks[c] <= -0x40) break;
          sensor.xpos = TSM1 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          const cAngle = (cm.angles[tileIndex] & 0xff0000) >> 16;
          sensor.angle = 0x100 - u8(-0x80 - cAngle);
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.angle < 0) sensor.angle += 0x100;
      if (sensor.angle > 0xff) sensor.angle -= 0x100;
      if (abs(angle - sensor.angle) > 0x20) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
        sensor.angle = angle;
        i = TS * 3;
      } else if (sensor.xpos - startX > TS - 2) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      } else if (sensor.xpos - startX < -(TS - 2)) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      }
    }
  }
}

export function FindRoofPosition(E: Engine3, player: Player3, sensor: Sensor, startY: number): void {
  const angle = sensor.angle;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = sensor.xpos >> 16;
    const YPos = (sensor.ypos >> 16) + TS - i;
    const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    if (t.collisionFlags[plane][tile] < C.SOLID_NONE) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if (cm.roofMasks[c] <= -0x40) break;
          sensor.ypos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = cm.angles[tileIndex] >>> 24;
          break;
        }
        case C.FLIP_X: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if (cm.roofMasks[c] <= -0x40) break;
          sensor.ypos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - (cm.angles[tileIndex] >>> 24);
          break;
        }
        case C.FLIP_Y: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if (cm.floorMasks[c] >= 0x40) break;
          sensor.ypos = TSM1 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          const cAngle = cm.angles[tileIndex] & 0xff;
          sensor.angle = u8(-0x80 - cAngle);
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if (cm.floorMasks[c] >= 0x40) break;
          sensor.ypos = TSM1 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          const cAngle = cm.angles[tileIndex] & 0xff;
          sensor.angle = 0x100 - u8(-0x80 - cAngle);
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.angle < 0) sensor.angle += 0x100;
      if (sensor.angle > 0xff) sensor.angle -= 0x100;
      if (abs(sensor.angle - angle) <= 0x20) {
        if (sensor.ypos - startY > TSM1) {
          sensor.ypos = startY << 16;
          sensor.collided = 0;
        }
        if (sensor.ypos - startY < -TSM1) {
          sensor.ypos = startY << 16;
          sensor.collided = 0;
        }
      } else {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
        sensor.angle = angle;
        i = TS * 3;
      }
    }
  }
}

export function FindRWallPosition(E: Engine3, player: Player3, sensor: Sensor, startX: number): void {
  const angle = sensor.angle;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = (sensor.xpos >> 16) + TS - i;
    const YPos = sensor.ypos >> 16;
    const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    if (t.collisionFlags[plane][tile] < C.SOLID_NONE) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if (cm.rWallMasks[c] <= -0x40) break;
          sensor.xpos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          sensor.angle = (cm.angles[tileIndex] & 0xff0000) >> 16;
          break;
        }
        case C.FLIP_X: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if (cm.lWallMasks[c] >= 0x40) break;
          sensor.xpos = TSM1 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - ((cm.angles[tileIndex] & 0xff00) >> 8);
          break;
        }
        case C.FLIP_Y: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if (cm.rWallMasks[c] <= -0x40) break;
          sensor.xpos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          const cAngle = (cm.angles[tileIndex] & 0xff0000) >> 16;
          sensor.angle = u8(-0x80 - cAngle);
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if (cm.lWallMasks[c] >= 0x40) break;
          sensor.xpos = TSM1 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          const cAngle = (cm.angles[tileIndex] & 0xff00) >> 8;
          sensor.angle = 0x100 - u8(-0x80 - cAngle);
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.angle < 0) sensor.angle += 0x100;
      if (sensor.angle > 0xff) sensor.angle -= 0x100;
      if (abs(sensor.angle - angle) > 0x20) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
        sensor.angle = angle;
        i = TS * 3;
      } else if (sensor.xpos - startX > TS - 2) {
        sensor.xpos = startX >> 16; // sic
        sensor.collided = 0;
      } else if (sensor.xpos - startX < -(TS - 2)) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      }
    }
  }
}

// ---- sensor collisions (air) -----------------------------------------------------------------------------------

export function FloorCollision(E: Engine3, player: Player3, sensor: Sensor): void {
  const startY = sensor.ypos >> 16;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = sensor.xpos >> 16;
    const YPos = (sensor.ypos >> 16) + i - TS;
    const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    const solid = t.collisionFlags[plane][tile];
    if (solid !== C.SOLID_LRB && solid !== C.SOLID_NONE && solid !== undefined) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) <= cm.floorMasks[c] + i - TS || cm.floorMasks[c] >= TSM1) break;
          sensor.ypos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = cm.angles[tileIndex] & 0xff;
          break;
        }
        case C.FLIP_X: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) <= cm.floorMasks[c] + i - TS || cm.floorMasks[c] >= TSM1) break;
          sensor.ypos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - (cm.angles[tileIndex] & 0xff);
          break;
        }
        case C.FLIP_Y: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) <= TSM1 - cm.roofMasks[c] + i - TS) break;
          sensor.ypos = TSM1 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          const cAngle = cm.angles[tileIndex] >>> 24;
          sensor.angle = u8(-0x80 - cAngle);
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) <= TSM1 - cm.roofMasks[c] + i - TS) break;
          sensor.ypos = TSM1 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          const cAngle = cm.angles[tileIndex] >>> 24;
          sensor.angle = 0x100 - u8(-0x80 - cAngle);
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.angle < 0) sensor.angle += 0x100;
      if (sensor.angle > 0xff) sensor.angle -= 0x100;
      if (sensor.ypos - startY > TS - 2) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
      } else if (sensor.ypos - startY < -(TS + 1)) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
      }
    }
  }
}

export function LWallCollision(E: Engine3, player: Player3, sensor: Sensor): void {
  const startX = sensor.xpos >> 16;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = (sensor.xpos >> 16) + i - TS;
    const YPos = sensor.ypos >> 16;
    const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    const solid = t.collisionFlags[plane][tile];
    if (solid !== C.SOLID_TOP && solid < C.SOLID_NONE) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) <= cm.lWallMasks[c] + i - TS) break;
          sensor.xpos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
        case C.FLIP_X: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) <= TSM1 - cm.rWallMasks[c] + i - TS) break;
          sensor.xpos = TSM1 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
        case C.FLIP_Y: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) <= cm.lWallMasks[c] + i - TS) break;
          sensor.xpos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) <= TSM1 - cm.rWallMasks[c] + i - TS) break;
          sensor.xpos = TSM1 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.xpos - startX > TSM1) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      } else if (sensor.xpos - startX < -TSM1) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      }
    }
  }
}

export function RoofCollision(E: Engine3, player: Player3, sensor: Sensor): void {
  const startY = sensor.ypos >> 16;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = sensor.xpos >> 16;
    const YPos = (sensor.ypos >> 16) + TS - i;
    const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    const solid = t.collisionFlags[plane][tile];
    if (solid !== C.SOLID_TOP && solid < C.SOLID_NONE) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) >= cm.roofMasks[c] + TS - i) break;
          sensor.ypos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = cm.angles[tileIndex] >>> 24;
          break;
        }
        case C.FLIP_X: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) >= cm.roofMasks[c] + TS - i) break;
          sensor.ypos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - (cm.angles[tileIndex] >>> 24);
          break;
        }
        case C.FLIP_Y: {
          const c = (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) >= TSM1 - cm.floorMasks[c] + TS - i) break;
          sensor.ypos = TSM1 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = u8(-0x80 - (cm.angles[tileIndex] & 0xff));
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (XPos & TSM1) + (tileIndex << 4);
          if ((YPos & TSM1) >= TSM1 - cm.floorMasks[c] + TS - i) break;
          sensor.ypos = TSM1 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
          sensor.collided = 1;
          sensor.angle = 0x100 - u8(-0x80 - (cm.angles[tileIndex] & 0xff));
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.angle < 0) sensor.angle += 0x100;
      if (sensor.angle > 0xff) sensor.angle -= 0x100;
      if (sensor.ypos - startY > TS - 2) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
      } else if (sensor.ypos - startY < -(TS - 2)) {
        sensor.ypos = startY << 16;
        sensor.collided = 0;
      }
    }
  }
}

export function RWallCollision(E: Engine3, player: Player3, sensor: Sensor): void {
  const startX = sensor.xpos >> 16;
  const plane = player.collisionPlane;
  const cm = E.collisionMasks[plane];
  const t = E.tiles128x128;
  for (let i = 0; i < TS * 3; i += TS) {
    if (sensor.collided) continue;
    const XPos = (sensor.xpos >> 16) + TS - i;
    const YPos = sensor.ypos >> 16;
    const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
    if (XPos <= -1 || YPos <= -1) continue;
    const tile = tileAt(E, XPos, YPos);
    const tileIndex = t.tileIndex[tile];
    const solid = t.collisionFlags[plane][tile];
    if (solid !== C.SOLID_TOP && solid < C.SOLID_NONE) {
      switch (t.direction[tile]) {
        case C.FLIP_NONE: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) >= cm.rWallMasks[c] + TS - i) break;
          sensor.xpos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
        case C.FLIP_X: {
          const c = (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) >= TSM1 - cm.lWallMasks[c] + TS - i) break;
          sensor.xpos = TSM1 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
        case C.FLIP_Y: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) >= cm.rWallMasks[c] + TS - i) break;
          sensor.xpos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
        case C.FLIP_XY: {
          const c = TSM1 - (YPos & TSM1) + (tileIndex << 4);
          if ((XPos & TSM1) >= TSM1 - cm.lWallMasks[c] + TS - i) break;
          sensor.xpos = TSM1 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
          sensor.collided = 1;
          break;
        }
      }
    }
    if (sensor.collided) {
      if (sensor.xpos - startX > TSM1) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      } else if (sensor.xpos - startX < -TSM1) {
        sensor.xpos = startX << 16;
        sensor.collided = 0;
      }
    }
  }
}

// ---- player tile collision -------------------------------------------------------------------------------------

export function ProcessAirCollision(E: Engine3, player: Player3): void {
  const s = E.sensors;
  const hb = playerHitbox(E, player);
  E.collisionLeft = hb.left[0];
  E.collisionTop = hb.top[0];
  E.collisionRight = hb.right[0];
  E.collisionBottom = hb.bottom[0];
  const bound = E.objectEntityList[player.boundEntity];

  let movingDown = 0, movingUp = 1, movingLeft = 0, movingRight = 0;
  if (player.xvel < 0) {
    movingRight = 0;
  } else {
    movingRight = 1;
    s[0].ypos = player.ypos + 0x20000;
    s[0].collided = 0;
    s[0].xpos = player.xpos + (E.collisionRight << 16);
  }
  if (player.xvel > 0) {
    movingLeft = 0;
  } else {
    movingLeft = 1;
    s[1].ypos = player.ypos + 0x20000;
    s[1].collided = 0;
    s[1].xpos = player.xpos + ((E.collisionLeft - 1) << 16);
  }
  s[2].xpos = player.xpos + (hb.left[1] << 16);
  s[3].xpos = player.xpos + (hb.right[1] << 16);
  s[2].collided = 0;
  s[3].collided = 0;
  s[4].xpos = s[2].xpos;
  s[5].xpos = s[3].xpos;
  s[4].collided = 0;
  s[5].collided = 0;
  if (player.yvel < 0) {
    movingDown = 0;
  } else {
    movingDown = 1;
    s[2].ypos = player.ypos + (E.collisionBottom << 16);
    s[3].ypos = player.ypos + (E.collisionBottom << 16);
  }
  s[4].ypos = player.ypos + ((E.collisionTop - 1) << 16);
  s[5].ypos = player.ypos + ((E.collisionTop - 1) << 16);
  let cnt = abs(player.xvel) <= abs(player.yvel) ? (abs(player.yvel) >> 19) + 1 : (abs(player.xvel) >> 19) + 1;
  let XVel = (player.xvel / cnt) | 0;
  let YVel = (player.yvel / cnt) | 0;
  let XVel2 = player.xvel - XVel * (cnt - 1);
  const YVel2 = player.yvel - YVel * (cnt - 1);
  while (cnt > 0) {
    if (cnt < 2) {
      XVel = XVel2;
      YVel = YVel2;
    }
    cnt--;

    if (movingRight === 1) {
      s[0].xpos += XVel + 0x10000;
      s[0].ypos += YVel;
      LWallCollision(E, player, s[0]);
      if (s[0].collided) movingRight = 2;
    }
    if (movingLeft === 1) {
      s[1].xpos += XVel - 0x10000;
      s[1].ypos += YVel;
      RWallCollision(E, player, s[1]);
      if (s[1].collided) movingLeft = 2;
    }
    if (movingRight === 2) {
      player.xvel = 0;
      player.speed = 0;
      player.xpos = (s[0].xpos - E.collisionRight) << 16;
      s[2].xpos = player.xpos + ((E.collisionLeft + 1) << 16);
      s[3].xpos = player.xpos + ((E.collisionRight - 2) << 16);
      s[4].xpos = s[2].xpos;
      s[5].xpos = s[3].xpos;
      XVel = 0;
      XVel2 = 0;
      movingRight = 3;
    }
    if (movingLeft === 2) {
      player.xvel = 0;
      player.speed = 0;
      player.xpos = (s[1].xpos - E.collisionLeft + 1) << 16;
      s[2].xpos = player.xpos + ((E.collisionLeft + 1) << 16);
      s[3].xpos = player.xpos + ((E.collisionRight - 2) << 16);
      s[4].xpos = s[2].xpos;
      s[5].xpos = s[3].xpos;
      XVel = 0;
      XVel2 = 0;
      movingLeft = 3;
    }
    if (movingDown === 1) {
      for (let i = 2; i < 4; i++) {
        if (!s[i].collided) {
          s[i].xpos += XVel;
          s[i].ypos += YVel;
          FloorCollision(E, player, s[i]);
        }
      }
      if (s[2].collided || s[3].collided) {
        movingDown = 2;
        cnt = 0;
      }
    }
    if (movingUp === 1) {
      for (let i = 4; i < 6; i++) {
        if (!s[i].collided) {
          s[i].xpos += XVel;
          s[i].ypos += YVel;
          RoofCollision(E, player, s[i]);
        }
      }
      if (s[4].collided || s[5].collided) {
        movingUp = 2;
        cnt = 0;
      }
    }
  }

  if (movingRight < 2 && movingLeft < 2) player.xpos = player.xpos + player.xvel;
  if (movingUp < 2 && movingDown < 2) {
    player.ypos = player.ypos + player.yvel;
    return;
  }

  if (movingDown === 2) {
    player.gravity = 0;
    if (s[2].collided && s[3].collided) {
      if (s[2].ypos >= s[3].ypos) {
        player.ypos = (s[3].ypos - E.collisionBottom) << 16;
        player.angle = s[3].angle;
      } else {
        player.ypos = (s[2].ypos - E.collisionBottom) << 16;
        player.angle = s[2].angle;
      }
    } else if (s[2].collided === 1) {
      player.ypos = (s[2].ypos - E.collisionBottom) << 16;
      player.angle = s[2].angle;
    } else if (s[3].collided === 1) {
      player.ypos = (s[3].ypos - E.collisionBottom) << 16;
      player.angle = s[3].angle;
    }
    if (player.angle > 0xa0 && player.angle < 0xe0 && player.collisionMode !== C.CMODE_LWALL) {
      player.collisionMode = C.CMODE_LWALL;
      player.xpos = player.xpos - 0x40000;
    }
    if (player.angle > 0x20 && player.angle < 0x60 && player.collisionMode !== C.CMODE_RWALL) {
      player.collisionMode = C.CMODE_RWALL;
      player.xpos = player.xpos + 0x40000;
    }
    if (player.angle < 0x20 || player.angle > 0xe0) player.controlLock = 0;
    bound.rotation = player.angle << 1;

    const xv = player.xvel, yv = player.yvel;
    const yv12 = yv + ((yv / 12) | 0);
    let speed = 0;
    if (player.down) {
      if (player.angle < 128) {
        if (player.angle < 16) speed = xv;
        else if (player.angle >= 32) speed = abs(xv) <= abs(yv) ? yv12 : xv;
        else speed = abs(xv) <= abs(yv >> 1) ? yv12 >> 1 : xv;
      } else if (player.angle > 240) speed = xv;
      else if (player.angle <= 224) speed = abs(xv) <= abs(yv) ? -yv12 : xv;
      else speed = abs(xv) <= abs(yv >> 1) ? -(yv12 >> 1) : xv;
    } else if (player.angle < 0x80) {
      if (player.angle < 0x10) speed = xv;
      else if (player.angle >= 0x20) speed = abs(xv) <= abs(yv) ? yv : xv;
      else speed = abs(xv) <= abs(yv >> 1) ? yv >> 1 : xv;
    } else if (player.angle > 0xf0) speed = xv;
    else if (player.angle <= 0xe0) speed = abs(xv) <= abs(yv) ? -yv : xv;
    else speed = abs(xv) <= abs(yv >> 1) ? -(yv >> 1) : xv;

    if (speed < -0x180000) speed = -0x180000;
    if (speed > 0x180000) speed = 0x180000;
    player.speed = speed;
    player.yvel = 0;
    E.checkResult = 1;
  }

  if (movingUp === 2) {
    let sensorAngle = 0;
    if (s[4].collided && s[5].collided) {
      if (s[4].ypos <= s[5].ypos) {
        player.ypos = (s[5].ypos - E.collisionTop + 1) << 16;
        sensorAngle = s[5].angle;
      } else {
        player.ypos = (s[4].ypos - E.collisionTop + 1) << 16;
        sensorAngle = s[4].angle;
      }
    } else if (s[4].collided) {
      player.ypos = (s[4].ypos - E.collisionTop + 1) << 16;
      sensorAngle = s[4].angle;
    } else if (s[5].collided) {
      player.ypos = (s[5].ypos - E.collisionTop + 1) << 16;
      sensorAngle = s[5].angle;
    }
    sensorAngle &= 0xff;

    const angle = ArcTanLookup(player.xvel, player.yvel);
    if (sensorAngle > 0x40 && sensorAngle < 0x62 && angle > 0xa0 && angle < 0xc2) {
      player.gravity = 0;
      player.angle = sensorAngle;
      bound.rotation = player.angle << 1;
      player.collisionMode = C.CMODE_RWALL;
      player.xpos = player.xpos + 0x40000;
      player.ypos = player.ypos - 0x20000;
      if (player.angle <= 0x60) player.speed = player.yvel;
      else player.speed = player.yvel >> 1;
    }
    if (sensorAngle > 0x9e && sensorAngle < 0xc0 && angle > 0xbe && angle < 0xe0) {
      player.gravity = 0;
      player.angle = sensorAngle;
      bound.rotation = player.angle << 1;
      player.collisionMode = C.CMODE_LWALL;
      player.xpos = player.xpos - 0x40000;
      player.ypos = player.ypos - 0x20000;
      if (player.angle >= 0xa0) player.speed = -player.yvel;
      else player.speed = -player.yvel >> 1;
    }
    if (player.yvel < 0) player.yvel = 0;
    E.checkResult = 2;
  }
}

export function SetPathGripSensors(E: Engine3, player: Player3): void {
  const s = E.sensors;
  const hb = playerHitbox(E, player);
  switch (player.collisionMode) {
    case C.CMODE_FLOOR:
      E.collisionLeft = hb.left[0];
      E.collisionTop = hb.top[0];
      E.collisionRight = hb.right[0];
      E.collisionBottom = hb.bottom[0];
      s[0].ypos = s[4].ypos + (E.collisionBottom << 16);
      s[1].ypos = s[0].ypos;
      s[2].ypos = s[0].ypos;
      s[3].ypos = s[4].ypos + 0x40000;
      s[0].xpos = s[4].xpos + ((hb.left[1] - 1) << 16);
      s[1].xpos = s[4].xpos;
      s[2].xpos = s[4].xpos + (hb.right[1] << 16);
      s[3].xpos = player.speed > 0 ? s[4].xpos + ((E.collisionRight + 1) << 16) : s[4].xpos + ((E.collisionLeft - 1) << 16);
      return;
    case C.CMODE_LWALL:
      E.collisionLeft = hb.left[2];
      E.collisionTop = hb.top[2];
      E.collisionRight = hb.right[2];
      E.collisionBottom = hb.bottom[2];
      s[0].xpos = s[4].xpos + (E.collisionRight << 16);
      s[1].xpos = s[0].xpos;
      s[2].xpos = s[0].xpos;
      s[3].xpos = s[4].xpos + 0x40000;
      s[0].ypos = s[4].ypos + ((hb.top[3] - 1) << 16);
      s[1].ypos = s[4].ypos;
      s[2].ypos = s[4].ypos + (hb.bottom[3] << 16);
      s[3].ypos = player.speed > 0 ? s[4].ypos + (E.collisionTop << 16) : s[4].ypos + ((E.collisionBottom - 1) << 16);
      return;
    case C.CMODE_ROOF:
      E.collisionLeft = hb.left[4];
      E.collisionTop = hb.top[4];
      E.collisionRight = hb.right[4];
      E.collisionBottom = hb.bottom[4];
      s[0].ypos = s[4].ypos + ((E.collisionTop - 1) << 16);
      s[1].ypos = s[0].ypos;
      s[2].ypos = s[0].ypos;
      s[3].ypos = s[4].ypos - 0x40000;
      s[0].xpos = s[4].xpos + ((hb.left[5] - 1) << 16);
      s[1].xpos = s[4].xpos;
      s[2].xpos = s[4].xpos + (hb.right[5] << 16);
      s[3].xpos = player.speed < 0 ? s[4].xpos + ((E.collisionRight + 1) << 16) : s[4].xpos + ((E.collisionLeft - 1) << 16);
      return;
    case C.CMODE_RWALL:
      E.collisionLeft = hb.left[6];
      E.collisionTop = hb.top[6];
      E.collisionRight = hb.right[6];
      E.collisionBottom = hb.bottom[6];
      s[0].xpos = s[4].xpos + ((E.collisionLeft - 1) << 16);
      s[1].xpos = s[0].xpos;
      s[2].xpos = s[0].xpos;
      s[3].xpos = s[4].xpos - 0x40000;
      s[0].ypos = s[4].ypos + ((hb.top[7] - 1) << 16);
      s[1].ypos = s[4].ypos;
      s[2].ypos = s[4].ypos + (hb.bottom[7] << 16);
      s[3].ypos = player.speed > 0 ? s[4].ypos + (E.collisionBottom << 16) : s[4].ypos + ((E.collisionTop - 1) << 16);
      return;
  }
}

export function ProcessPathGrip(E: Engine3, player: Player3): void {
  const s = E.sensors;
  const bound = E.objectEntityList[player.boundEntity];
  s[4].xpos = player.xpos;
  s[4].ypos = player.ypos;
  for (let i = 0; i < 6; ++i) {
    s[i].angle = player.angle;
    s[i].collided = 0;
  }
  SetPathGripSensors(E, player);
  let absSpeed = abs(player.speed);
  let checkDist = absSpeed >> 18;
  absSpeed &= 0x3ffff;
  const cMode = player.collisionMode;

  while (checkDist > -1) {
    let cosValue256: number, sinValue256: number;
    if (checkDist >= 1) {
      cosValue256 = cos256LookupTable[player.angle] << 10;
      sinValue256 = sin256LookupTable[player.angle] << 10;
      checkDist--;
    } else {
      cosValue256 = Math.imul(absSpeed, cos256LookupTable[player.angle]) >> 8;
      sinValue256 = Math.imul(absSpeed, sin256LookupTable[player.angle]) >> 8;
      checkDist = -1;
    }
    if (player.speed < 0) {
      cosValue256 = -cosValue256;
      sinValue256 = -sinValue256;
    }

    s[0].collided = 0;
    s[1].collided = 0;
    s[2].collided = 0;
    s[4].xpos += cosValue256;
    s[4].ypos += sinValue256;
    let tileDistance = -1;
    switch (player.collisionMode) {
      case C.CMODE_FLOOR: {
        s[3].xpos += cosValue256;
        s[3].ypos += sinValue256;
        if (player.speed > 0) LWallCollision(E, player, s[3]);
        if (player.speed < 0) RWallCollision(E, player, s[3]);
        if (s[3].collided) {
          cosValue256 = 0;
          checkDist = -1;
        }
        for (let i = 0; i < 3; i++) {
          s[i].xpos += cosValue256;
          s[i].ypos += sinValue256;
          FindFloorPosition(E, player, s[i], s[i].ypos >> 16);
        }
        tileDistance = -1;
        for (let i = 0; i < 3; i++) {
          if (tileDistance > -1) {
            if (s[i].collided) {
              if (s[i].ypos < s[tileDistance].ypos) tileDistance = i;
              if (s[i].ypos === s[tileDistance].ypos && (s[i].angle < 0x08 || s[i].angle > 0xf8)) tileDistance = i;
            }
          } else if (s[i].collided) tileDistance = i;
        }
        if (tileDistance <= -1) {
          checkDist = -1;
        } else {
          s[0].ypos = s[tileDistance].ypos << 16;
          s[0].angle = s[tileDistance].angle;
          s[1].ypos = s[0].ypos;
          s[1].angle = s[0].angle;
          s[2].ypos = s[0].ypos;
          s[2].angle = s[0].angle;
          s[3].ypos = s[0].ypos - 0x40000;
          s[3].angle = s[0].angle;
          s[4].xpos = s[1].xpos;
          s[4].ypos = s[0].ypos - (E.collisionBottom << 16);
        }
        if (s[0].angle < 0xde && s[0].angle > 0x80) player.collisionMode = C.CMODE_LWALL;
        if (s[0].angle > 0x22 && s[0].angle < 0x80) player.collisionMode = C.CMODE_RWALL;
        break;
      }
      case C.CMODE_LWALL: {
        s[3].xpos += cosValue256;
        s[3].ypos += sinValue256;
        if (player.speed > 0) RoofCollision(E, player, s[3]);
        if (player.speed < 0) FloorCollision(E, player, s[3]);
        if (s[3].collided) {
          sinValue256 = 0;
          checkDist = -1;
        }
        for (let i = 0; i < 3; i++) {
          s[i].xpos += cosValue256;
          s[i].ypos += sinValue256;
          FindLWallPosition(E, player, s[i], s[i].xpos >> 16);
        }
        tileDistance = -1;
        for (let i = 0; i < 3; i++) {
          if (tileDistance > -1) {
            if (s[i].xpos < s[tileDistance].xpos && s[i].collided) tileDistance = i;
          } else if (s[i].collided) tileDistance = i;
        }
        if (tileDistance <= -1) {
          checkDist = -1;
        } else {
          s[0].xpos = s[tileDistance].xpos << 16;
          s[0].angle = s[tileDistance].angle;
          s[1].xpos = s[0].xpos;
          s[1].angle = s[0].angle;
          s[2].xpos = s[0].xpos;
          s[2].angle = s[0].angle;
          s[4].ypos = s[1].ypos;
          s[4].xpos = s[1].xpos - (E.collisionRight << 16);
        }
        if (s[0].angle > 0xe2) player.collisionMode = C.CMODE_FLOOR;
        if (s[0].angle < 0x9e) player.collisionMode = C.CMODE_ROOF;
        break;
      }
      case C.CMODE_ROOF: {
        s[3].xpos += cosValue256;
        s[3].ypos += sinValue256;
        if (player.speed > 0) RWallCollision(E, player, s[3]);
        if (player.speed < 0) LWallCollision(E, player, s[3]);
        if (s[3].collided) {
          cosValue256 = 0;
          checkDist = -1;
        }
        for (let i = 0; i < 3; i++) {
          s[i].xpos += cosValue256;
          s[i].ypos += sinValue256;
          FindRoofPosition(E, player, s[i], s[i].ypos >> 16);
        }
        tileDistance = -1;
        for (let i = 0; i < 3; i++) {
          if (tileDistance > -1) {
            if (s[i].ypos > s[tileDistance].ypos && s[i].collided) tileDistance = i;
          } else if (s[i].collided) tileDistance = i;
        }
        if (tileDistance <= -1) {
          checkDist = -1;
        } else {
          s[0].ypos = s[tileDistance].ypos << 16;
          s[0].angle = s[tileDistance].angle;
          s[1].ypos = s[0].ypos;
          s[1].angle = s[0].angle;
          s[2].ypos = s[0].ypos;
          s[2].angle = s[0].angle;
          s[3].ypos = s[0].ypos + 0x40000;
          s[3].angle = s[0].angle;
          s[4].xpos = s[1].xpos;
          s[4].ypos = s[0].ypos - ((E.collisionTop - 1) << 16);
        }
        if (s[0].angle > 0xa2) player.collisionMode = C.CMODE_LWALL;
        if (s[0].angle < 0x5e) player.collisionMode = C.CMODE_RWALL;
        break;
      }
      case C.CMODE_RWALL: {
        s[3].xpos += cosValue256;
        s[3].ypos += sinValue256;
        if (player.speed > 0) FloorCollision(E, player, s[3]);
        if (player.speed < 0) RoofCollision(E, player, s[3]);
        if (s[3].collided) {
          sinValue256 = 0;
          checkDist = -1;
        }
        for (let i = 0; i < 3; i++) {
          s[i].xpos += cosValue256;
          s[i].ypos += sinValue256;
          FindRWallPosition(E, player, s[i], s[i].xpos >> 16);
        }
        tileDistance = -1;
        for (let i = 0; i < 3; i++) {
          if (tileDistance > -1) {
            if (s[i].xpos > s[tileDistance].xpos && s[i].collided) tileDistance = i;
          } else if (s[i].collided) tileDistance = i;
        }
        if (tileDistance <= -1) {
          checkDist = -1;
        } else {
          s[0].xpos = s[tileDistance].xpos << 16;
          s[0].angle = s[tileDistance].angle;
          s[1].xpos = s[0].xpos;
          s[1].angle = s[0].angle;
          s[2].xpos = s[0].xpos;
          s[2].angle = s[0].angle;
          s[4].ypos = s[1].ypos;
          s[4].xpos = s[1].xpos - ((E.collisionLeft - 1) << 16);
        }
        if (s[0].angle < 0x1e) player.collisionMode = C.CMODE_FLOOR;
        if (s[0].angle > 0x62) player.collisionMode = C.CMODE_ROOF;
        break;
      }
    }
    if (tileDistance > -1) player.angle = s[0].angle;
    if (!s[3].collided) SetPathGripSensors(E, player);
    else checkDist = -2;
  }

  const fallOff = () => {
    player.gravity = 1;
    player.collisionMode = C.CMODE_FLOOR;
    player.xvel = Math.imul(cos256LookupTable[player.angle], player.speed) >> 8;
    player.yvel = Math.imul(sin256LookupTable[player.angle], player.speed) >> 8;
  };
  const clampYVel = () => {
    if (player.yvel < -0x100000) player.yvel = -0x100000;
    if (player.yvel > 0x100000) player.yvel = 0x100000;
  };

  switch (cMode) {
    case C.CMODE_FLOOR: {
      if (s[0].collided || s[1].collided || s[2].collided) {
        player.angle = s[0].angle;
        bound.rotation = player.angle << 1;
        player.setFlailing(0, s[0].collided);
        player.setFlailing(1, s[1].collided);
        player.setFlailing(2, s[2].collided);
        if (!s[3].collided) {
          player.pushing = 0;
          player.xpos = s[4].xpos;
        } else {
          if (player.speed > 0) player.xpos = (s[3].xpos - E.collisionRight) << 16;
          if (player.speed < 0) player.xpos = (s[3].xpos - E.collisionLeft + 1) << 16;
          player.speed = 0;
          if ((player.left || player.right) && player.pushing < 2) player.pushing++;
        }
        player.ypos = s[4].ypos;
        return;
      }
      fallOff();
      clampYVel();
      player.speed = player.xvel;
      player.angle = 0;
      if (!s[3].collided) {
        player.pushing = 0;
        player.xpos = player.xpos + player.xvel;
      } else {
        if (player.speed > 0) player.xpos = (s[3].xpos - E.collisionRight) << 16;
        if (player.speed < 0) player.xpos = (s[3].xpos - E.collisionLeft + 1) << 16;
        player.speed = 0;
        if ((player.left || player.right) && player.pushing < 2) player.pushing++;
      }
      player.ypos = player.ypos + player.yvel;
      return;
    }
    case C.CMODE_LWALL: {
      if (!s[0].collided && !s[1].collided && !s[2].collided) {
        fallOff();
        clampYVel();
        player.speed = player.xvel;
        player.angle = 0;
      } else if (player.speed >= 0x28000 || player.speed <= -0x28000 || player.controlLock !== 0) {
        player.angle = s[0].angle;
        bound.rotation = player.angle << 1;
      } else {
        player.gravity = 1;
        player.angle = 0;
        player.collisionMode = C.CMODE_FLOOR;
        player.speed = player.xvel;
        player.controlLock = 30;
      }
      if (!s[3].collided) {
        player.ypos = s[4].ypos;
      } else {
        if (player.speed > 0) player.ypos = (s[3].ypos - E.collisionTop) << 16;
        if (player.speed < 0) player.ypos = (s[3].ypos - E.collisionBottom) << 16;
        player.speed = 0;
      }
      player.xpos = s[4].xpos;
      return;
    }
    case C.CMODE_ROOF: {
      if (!s[0].collided && !s[1].collided && !s[2].collided) {
        fallOff();
        player.setFlailing(0, 0);
        player.setFlailing(1, 0);
        player.setFlailing(2, 0);
        clampYVel();
        player.angle = 0;
        player.speed = player.xvel;
        if (!s[3].collided) {
          player.xpos = player.xpos + player.xvel;
        } else {
          if (player.speed > 0) player.xpos = (s[3].xpos - E.collisionRight) << 16;
          if (player.speed < 0) player.xpos = (s[3].xpos - E.collisionLeft + 1) << 16;
          player.speed = 0;
        }
      } else if (player.speed <= -0x28000 || player.speed >= 0x28000) {
        player.angle = s[0].angle;
        bound.rotation = player.angle << 1;
        if (!s[3].collided) {
          player.xpos = s[4].xpos;
        } else {
          if (player.speed < 0) player.xpos = (s[3].xpos - E.collisionRight) << 16;
          if (player.speed > 0) player.xpos = (s[3].xpos - E.collisionLeft + 1) << 16;
          player.speed = 0;
        }
      } else {
        player.gravity = 1;
        player.angle = 0;
        player.collisionMode = C.CMODE_FLOOR;
        player.speed = player.xvel;
        player.setFlailing(0, 0);
        player.setFlailing(1, 0);
        player.setFlailing(2, 0);
        if (!s[3].collided) {
          player.xpos = player.xpos + player.xvel;
        } else {
          if (player.speed > 0) player.xpos = (s[3].xpos - E.collisionRight) << 16;
          if (player.speed < 0) player.xpos = (s[3].xpos - E.collisionLeft + 1) << 16;
          player.speed = 0;
        }
      }
      player.ypos = s[4].ypos;
      return;
    }
    case C.CMODE_RWALL: {
      if (!s[0].collided && !s[1].collided && !s[2].collided) {
        fallOff();
        clampYVel();
        player.speed = player.xvel;
        player.angle = 0;
      } else if (player.speed <= -0x28000 || player.speed >= 0x28000 || player.controlLock !== 0) {
        player.angle = s[0].angle;
        bound.rotation = player.angle << 1;
      } else {
        player.gravity = 1;
        player.angle = 0;
        player.collisionMode = C.CMODE_FLOOR;
        player.speed = player.xvel;
        player.controlLock = 30;
      }
      if (!s[3].collided) {
        player.ypos = s[4].ypos;
      } else {
        if (player.speed > 0) player.ypos = (s[3].ypos - E.collisionBottom) << 16;
        if (player.speed < 0) player.ypos = (s[3].ypos - E.collisionTop + 1) << 16;
        player.speed = 0;
      }
      player.xpos = s[4].xpos;
      return;
    }
  }
}

export function ProcessPlayerTileCollisions(E: Engine3, player: Player3): void {
  player.setFlailing(0, 0);
  player.setFlailing(1, 0);
  player.setFlailing(2, 0);
  E.checkResult = 0;
  if (player.gravity === 1) ProcessAirCollision(E, player);
  else ProcessPathGrip(E, player);
}

// ---- object tile collision -------------------------------------------------------------------------------------

function inStage(E: Engine3, x: number, y: number): boolean {
  return x > 0 && x < E.stageLayouts[0].xsize << 7 && y > 0 && y < E.stageLayouts[0].ysize << 7;
}

export function ObjectFloorCollision(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  const XPos = (entity.xpos >> 16) + xOffset;
  let YPos = (entity.ypos >> 16) + yOffset;
  if (!inStage(E, XPos, YPos)) return;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
  const chunk = tileAt(E, XPos, YPos);
  const tileIndex = t.tileIndex[chunk];
  const solid = t.collisionFlags[cPath][chunk];
  if (solid !== C.SOLID_LRB && solid !== C.SOLID_NONE) {
    switch (t.direction[chunk]) {
      case 0: {
        const c = (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) <= cm.floorMasks[c]) break;
        YPos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
      case 1: {
        const c = 15 - (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) <= cm.floorMasks[c]) break;
        YPos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
      case 2: {
        const c = (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) <= 15 - cm.roofMasks[c]) break;
        YPos = 15 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
      case 3: {
        const c = 15 - (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) <= 15 - cm.roofMasks[c]) break;
        YPos = 15 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
    }
  }
  if (E.checkResult) entity.ypos = (YPos - yOffset) << 16;
}

export function ObjectLWallCollision(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  let XPos = (entity.xpos >> 16) + xOffset;
  const YPos = (entity.ypos >> 16) + yOffset;
  if (!inStage(E, XPos, YPos)) return;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
  const chunk = tileAt(E, XPos, YPos);
  const tileIndex = t.tileIndex[chunk];
  const solid = t.collisionFlags[cPath][chunk];
  if (solid !== C.SOLID_TOP && solid < C.SOLID_NONE) {
    switch (t.direction[chunk]) {
      case 0: {
        const c = (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) <= cm.lWallMasks[c]) break;
        XPos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
      case 1: {
        const c = (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) <= 15 - cm.rWallMasks[c]) break;
        XPos = 15 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
      case 2: {
        const c = 15 - (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) <= cm.lWallMasks[c]) break;
        XPos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
      case 3: {
        const c = 15 - (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) <= 15 - cm.rWallMasks[c]) break;
        XPos = 15 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
    }
  }
  if (E.checkResult) entity.xpos = (XPos - xOffset) << 16;
}

export function ObjectRoofCollision(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  const XPos = (entity.xpos >> 16) + xOffset;
  let YPos = (entity.ypos >> 16) + yOffset;
  if (!inStage(E, XPos, YPos)) return;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
  const chunk = tileAt(E, XPos, YPos);
  const tileIndex = t.tileIndex[chunk];
  const solid = t.collisionFlags[cPath][chunk];
  if (solid !== C.SOLID_TOP && solid < C.SOLID_NONE) {
    switch (t.direction[chunk]) {
      case 0: {
        const c = (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) >= cm.roofMasks[c]) break;
        YPos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
      case 1: {
        const c = 15 - (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) >= cm.roofMasks[c]) break;
        YPos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
      case 2: {
        const c = (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) >= 15 - cm.floorMasks[c]) break;
        YPos = 15 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
      case 3: {
        const c = 15 - (XPos & 15) + (tileIndex << 4);
        if ((YPos & 15) >= 15 - cm.floorMasks[c]) break;
        YPos = 15 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
        E.checkResult = 1;
        break;
      }
    }
  }
  if (E.checkResult) entity.ypos = (YPos - yOffset) << 16;
}

export function ObjectRWallCollision(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  let XPos = (entity.xpos >> 16) + xOffset;
  const YPos = (entity.ypos >> 16) + yOffset;
  if (!inStage(E, XPos, YPos)) return;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
  const chunk = tileAt(E, XPos, YPos);
  const tileIndex = t.tileIndex[chunk];
  const solid = t.collisionFlags[cPath][chunk];
  if (solid !== C.SOLID_TOP && solid < C.SOLID_NONE) {
    switch (t.direction[chunk]) {
      case 0: {
        const c = (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) >= cm.rWallMasks[c]) break;
        XPos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
      case 1: {
        const c = (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) >= 15 - cm.lWallMasks[c]) break;
        XPos = 15 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
      case 2: {
        const c = 15 - (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) >= cm.rWallMasks[c]) break;
        XPos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
      case 3: {
        const c = 15 - (YPos & 15) + (tileIndex << 4);
        if ((XPos & 15) >= 15 - cm.lWallMasks[c]) break;
        XPos = 15 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
        E.checkResult = 1;
        break;
      }
    }
  }
  if (E.checkResult) entity.xpos = (XPos - xOffset) << 16;
}

// The grips write the found surface (in whole pixels) into the entity position before converting it, as the original does.

export function ObjectFloorGrip(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  const XPos = (entity.xpos >> 16) + xOffset;
  let YPos = (entity.ypos >> 16) + yOffset;
  const startY = YPos;
  YPos -= 16;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  for (let i = 3; i > 0; i--) {
    if (inStage(E, XPos, YPos) && !E.checkResult) {
      const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
      const chunk = tileAt(E, XPos, YPos);
      const tileIndex = t.tileIndex[chunk];
      const solid = t.collisionFlags[cPath][chunk];
      if (solid !== C.SOLID_LRB && solid !== C.SOLID_NONE) {
        switch (t.direction[chunk]) {
          case 0: {
            const c = (XPos & 15) + (tileIndex << 4);
            if (cm.floorMasks[c] >= 64) break;
            entity.ypos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
          case 1: {
            const c = 15 - (XPos & 15) + (tileIndex << 4);
            if (cm.floorMasks[c] >= 64) break;
            entity.ypos = cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
          case 2: {
            const c = (XPos & 15) + (tileIndex << 4);
            if (cm.roofMasks[c] <= -64) break;
            entity.ypos = 15 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
          case 3: {
            const c = 15 - (XPos & 15) + (tileIndex << 4);
            if (cm.roofMasks[c] <= -64) break;
            entity.ypos = 15 - cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
        }
      }
    }
    YPos += 16;
  }
  if (E.checkResult) {
    if (abs(entity.ypos - startY) < 16) {
      entity.ypos = (entity.ypos - yOffset) << 16;
      return;
    }
    entity.ypos = (startY - yOffset) << 16;
    E.checkResult = 0;
  }
}

export function ObjectLWallGrip(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  let XPos = (entity.xpos >> 16) + xOffset;
  const YPos = (entity.ypos >> 16) + yOffset;
  const startX = XPos;
  XPos -= 16;
  let chunk = xOffset;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  for (let i = 3; i > 0; i--) {
    if (inStage(E, XPos, YPos) && !E.checkResult) {
      const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
      chunk = tileAt(E, XPos, YPos);
      const tileIndex = t.tileIndex[chunk];
      if (t.collisionFlags[cPath][chunk] < C.SOLID_NONE) {
        switch (t.direction[chunk]) {
          case 0: {
            const c = (YPos & 15) + (tileIndex << 4);
            if (cm.lWallMasks[c] >= 64) break;
            entity.xpos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
          case 1: {
            const c = (YPos & 15) + (tileIndex << 4);
            if (cm.rWallMasks[c] <= -64) break;
            entity.xpos = 15 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
          case 2: {
            const c = 15 - (YPos & 15) + (tileIndex << 4);
            if (cm.lWallMasks[c] >= 64) break;
            entity.xpos = cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
          case 3: {
            const c = 15 - (YPos & 15) + (tileIndex << 4);
            if (cm.rWallMasks[c] <= -64) break;
            entity.xpos = 15 - cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
        }
      }
    }
    XPos += 16;
  }
  if (E.checkResult) {
    if (abs(entity.xpos - startX) < 16) {
      entity.xpos = (entity.xpos - xOffset) << 16;
      return;
    }
    entity.xpos = (startX - xOffset) << 16;
    E.checkResult = +(t.collisionFlags[cPath][chunk] === 1);
  }
}

export function ObjectRoofGrip(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  const XPos = (entity.xpos >> 16) + xOffset;
  let YPos = (entity.ypos >> 16) + yOffset;
  const startY = YPos;
  YPos += 16;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  for (let i = 3; i > 0; i--) {
    if (inStage(E, XPos, YPos) && !E.checkResult) {
      const chunkY = YPos >> 7, tileY = (YPos & 0x7f) >> 4;
      const chunk = tileAt(E, XPos, YPos);
      const tileIndex = t.tileIndex[chunk];
      if (t.collisionFlags[cPath][chunk] < C.SOLID_NONE) {
        switch (t.direction[chunk]) {
          case 0: {
            const c = (XPos & 15) + (tileIndex << 4);
            if (cm.roofMasks[c] <= -64) break;
            entity.ypos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
          case 1: {
            const c = 15 - (XPos & 15) + (tileIndex << 4);
            if (cm.roofMasks[c] <= -64) break;
            entity.ypos = cm.roofMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
          case 2: {
            const c = (XPos & 15) + (tileIndex << 4);
            if (cm.floorMasks[c] >= 64) break;
            entity.ypos = 15 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
          case 3: {
            const c = 15 - (XPos & 15) + (tileIndex << 4);
            if (cm.floorMasks[c] >= 64) break;
            entity.ypos = 15 - cm.floorMasks[c] + (chunkY << 7) + (tileY << 4);
            E.checkResult = 1;
            break;
          }
        }
      }
    }
    YPos -= 16;
  }
  if (E.checkResult) {
    if (abs(entity.ypos - startY) < 16) {
      entity.ypos = (entity.ypos - yOffset) << 16;
      return;
    }
    entity.ypos = (startY - yOffset) << 16;
    E.checkResult = 0;
  }
}

export function ObjectRWallGrip(E: Engine3, xOffset: number, yOffset: number, cPath: number): void {
  E.checkResult = 0;
  const entity = E.objectEntityList[E.objectLoop];
  let XPos = (entity.xpos >> 16) + xOffset;
  const YPos = (entity.ypos >> 16) + yOffset;
  const startX = XPos;
  XPos += 16;
  let chunk = xOffset;
  const cm = E.collisionMasks[cPath], t = E.tiles128x128;
  for (let i = 3; i > 0; i--) {
    if (inStage(E, XPos, YPos) && !E.checkResult) {
      const chunkX = XPos >> 7, tileX = (XPos & 0x7f) >> 4;
      chunk = tileAt(E, XPos, YPos);
      const tileIndex = t.tileIndex[chunk];
      if (t.collisionFlags[cPath][chunk] < C.SOLID_NONE) {
        switch (t.direction[chunk]) {
          case 0: {
            const c = (YPos & 15) + (tileIndex << 4);
            if (cm.rWallMasks[c] <= -64) break;
            entity.xpos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
          case 1: {
            const c = (YPos & 15) + (tileIndex << 4);
            if (cm.lWallMasks[c] >= 64) break;
            entity.xpos = 15 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
          case 2: {
            const c = 15 - (YPos & 15) + (tileIndex << 4);
            if (cm.rWallMasks[c] <= -64) break;
            entity.xpos = cm.rWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
          case 3: {
            const c = 15 - (YPos & 15) + (tileIndex << 4);
            if (cm.lWallMasks[c] >= 64) break;
            entity.xpos = 15 - cm.lWallMasks[c] + (chunkX << 7) + (tileX << 4);
            E.checkResult = 1;
            break;
          }
        }
      }
    }
    XPos -= 16;
  }
  if (E.checkResult) {
    if (abs(entity.xpos - startX) < 16) {
      entity.xpos = (entity.xpos - xOffset) << 16;
      return;
    }
    entity.xpos = (startX - xOffset) << 16;
    E.checkResult = +(t.collisionFlags[cPath][chunk] === 1);
  }
}

// ---- collision storage (Origins Plus): [entityNo, type, left, right, top, bottom] per slot ----------------------

const CS_ENTITY = 0, CS_TYPE = 1, CS_LEFT = 2, CS_RIGHT = 3, CS_TOP = 4, CS_BOTTOM = 5;

export function ResetCollisionStorage(E: Engine3): void {
  for (let i = 0; i < C.COLSTORE_COUNT; i++) {
    const o = i * 6;
    E.collisionStorage[o + CS_ENTITY] = -1;
    E.collisionStorage[o + CS_TYPE] = -1;
    E.collisionStorage[o + CS_LEFT] = 0;
    E.collisionStorage[o + CS_TOP] = 0;
    E.collisionStorage[o + CS_RIGHT] = 0;
    E.collisionStorage[o + CS_BOTTOM] = 0;
  }
}

function storeCollision(E: Engine3): void {
  const cs = E.collisionStorage;
  for (let i = 0; i < C.COLSTORE_COUNT; i++) {
    const o = i * 6;
    if (cs[o + CS_ENTITY] === E.objectLoop) break;
    if (cs[o + CS_ENTITY] === -1) {
      cs[o + CS_ENTITY] = E.objectLoop;
      cs[o + CS_TYPE] = (E.objectEntityList[E.objectLoop].type << 24) >> 24; // sbyte
      cs[o + CS_LEFT] = E.operands[1];
      cs[o + CS_TOP] = E.operands[2];
      cs[o + CS_RIGHT] = E.operands[3];
      cs[o + CS_BOTTOM] = E.operands[4];
      break;
    }
  }
}

export function ObjectEntityGrip(E: Engine3, direction: number, extendBottomCol: number, effect: number): void {
  const player = E.playerList[E.activePlayer];
  const hb = playerHitbox(E, player);
  E.collisionLeft = hb.left[0];
  E.collisionTop = hb.top[0];
  E.collisionRight = hb.right[0];
  E.collisionBottom = hb.bottom[0];
  const cs = E.collisionStorage;
  let storePos = 0, storeCount = 0;
  E.checkResult = 0;
  for (let i = 0; i < C.COLSTORE_COUNT; i++) {
    if (cs[i * 6 + CS_ENTITY] !== -1) {
      storeCount++;
      storePos = i;
      E.checkResult = 1;
    }
  }
  switch (effect) {
    case C.ECEFFECT_NONE:
    case C.ECEFFECT_RESETSTORAGE: {
      if (storeCount === 1) {
        E.checkResult = 0;
        const o = storePos * 6;
        const extendedBottomCol = extendBottomCol ? E.collisionBottom + 5 : -5;
        const entity = E.objectEntityList[cs[o + CS_ENTITY]];
        const xCheck1 = (cs[o + CS_LEFT] << 16) + entity.xpos;
        const xCheck2 = (cs[o + CS_RIGHT] << 16) + entity.xpos;
        const yCheck1 = ((cs[o + CS_TOP] + extendedBottomCol) << 16) + entity.ypos;
        const yCheck2 = ((cs[o + CS_BOTTOM] + extendedBottomCol) << 16) + entity.ypos;
        const vertical = () => yCheck1 < player.ypos + (E.collisionBottom << 16) && player.ypos + (E.collisionTop << 16) < yCheck2;
        if (direction) {
          if ((E.collisionLeft << 16) + player.xpos <= xCheck2 && xCheck2 < player.xpos - player.xvel) {
            if (vertical()) {
              player.xpos = xCheck2 - (E.collisionLeft << 16);
              E.checkResult = 1;
            } else if (effect === C.ECEFFECT_RESETSTORAGE) ResetCollisionStorage(E);
          }
        } else if ((E.collisionRight << 16) + player.xpos >= xCheck1 && xCheck1 > player.xpos - player.xvel) {
          player.xpos = xCheck1 - (E.collisionRight << 16);
          if (vertical()) {
            E.checkResult = 1;
            player.xpos = xCheck1 - (E.collisionRight << 16);
          } else if (effect === C.ECEFFECT_RESETSTORAGE) ResetCollisionStorage(E);
        }
      } else if (effect === 1) {
        ResetCollisionStorage(E);
      }
      break;
    }
    case C.ECEFFECT_BOXCOL3: {
      const o = storePos * 6;
      for (let n = 0; n < C.ENTITY_COUNT; n++) {
        const entity = E.objectEntityList[n];
        if (cs[o + CS_TYPE] === entity.type) {
          BoxCollision3(E, entity.xpos + (cs[o + CS_LEFT] << 16), entity.ypos + (cs[o + CS_TOP] << 16),
            entity.xpos + (cs[o + CS_RIGHT] << 16), entity.ypos + (cs[o + CS_BOTTOM] << 16));
        }
      }
      break;
    }
  }
}

// ---- player / object collision ---------------------------------------------------------------------------------

export function TouchCollision(E: Engine3, left: number, top: number, right: number, bottom: number): void {
  const player = E.playerList[E.activePlayer];
  const hb = playerHitbox(E, player);
  E.collisionLeft = (player.xpos >> 16) + hb.left[0];
  E.collisionTop = (player.ypos >> 16) + hb.top[0];
  E.collisionRight = (player.xpos >> 16) + hb.right[0];
  E.collisionBottom = (player.ypos >> 16) + hb.bottom[0];
  E.checkResult = +(E.collisionRight > left && E.collisionLeft < right && E.collisionBottom > top && E.collisionTop < bottom);
}

function setHitboxBounds(E: Engine3, player: Player3) {
  const hb = playerHitbox(E, player);
  E.collisionLeft = hb.left[0];
  E.collisionTop = hb.top[0];
  E.collisionRight = hb.right[0];
  E.collisionBottom = hb.bottom[0];
}

function boxSpeed(player: Player3): number {
  switch (player.collisionMode) {
    case C.CMODE_FLOOR:
    case C.CMODE_ROOF:
      return player.xvel ? abs(player.xvel) : abs(player.speed);
    case C.CMODE_LWALL:
    case C.CMODE_RWALL:
      return abs(player.xvel);
    default:
      return 0;
  }
}

/** Landing on the top of a box. */
function boxTop(E: Engine3, player: Player3, left: number, top: number, right: number): boolean {
  const s = E.sensors;
  s[0].collided = s[1].collided = s[2].collided = 0;
  s[0].xpos = player.xpos + ((E.collisionLeft + 2) << 16);
  s[1].xpos = player.xpos;
  s[2].xpos = player.xpos + ((E.collisionRight - 2) << 16);
  s[0].ypos = player.ypos + (E.collisionBottom << 16);
  s[1].ypos = s[0].ypos;
  s[2].ypos = s[0].ypos;
  if (player.yvel > -1) {
    for (let i = 0; i < 3; ++i) {
      if (s[i].xpos > left && s[i].xpos < right && s[i].ypos >= top && player.ypos - player.yvel < top) {
        s[i].collided = 1;
        player.setFlailing(i, 1);
      }
    }
  }
  if (!(s[2].collided || s[1].collided || s[0].collided)) return false;
  if (!player.gravity && (player.collisionMode === C.CMODE_RWALL || player.collisionMode === C.CMODE_LWALL)) {
    player.xvel = 0;
    player.speed = 0;
  }
  player.ypos = top - (E.collisionBottom << 16);
  player.gravity = 0;
  player.yvel = 0;
  player.angle = 0;
  E.objectEntityList[player.boundEntity].rotation = 0;
  player.controlLock = 0;
  E.checkResult = 1;
  return true;
}

/** Hitting the bottom of a box. */
function boxBottom(E: Engine3, player: Player3, left: number, right: number, bottom: number): boolean {
  const s = E.sensors;
  s[0].collided = s[1].collided = 0;
  s[0].xpos = player.xpos + ((E.collisionLeft + 2) << 16);
  s[1].xpos = player.xpos + ((E.collisionRight - 2) << 16);
  s[0].ypos = player.ypos + (E.collisionTop << 16);
  s[1].ypos = s[0].ypos;
  for (let i = 0; i < 2; ++i) {
    if (s[i].xpos > left && s[i].xpos < right && s[i].ypos <= bottom && player.ypos - player.yvel > bottom) s[i].collided = 1;
  }
  if (!(s[1].collided || s[0].collided)) return false;
  if (player.gravity === 1) player.ypos = bottom - (E.collisionTop << 16);
  if (player.yvel < 1) player.yvel = 0;
  E.checkResult = 4;
  return true;
}

/** Pushing against the left side of a box. `v2` uses BoxCollision2's sensor heights. */
function boxLeft(E: Engine3, player: Player3, left: number, top: number, bottom: number, v2: boolean): boolean {
  const s = E.sensors;
  s[0].collided = s[1].collided = 0;
  s[0].xpos = player.xpos + (E.collisionRight << 16);
  s[1].xpos = s[0].xpos;
  let hit = false;
  if (v2) {
    s[0].ypos = player.ypos + ((E.collisionBottom - 2) << 16);
    s[1].ypos = player.ypos + ((E.collisionTop + 2) << 16);
    for (let i = 0; i < 2; ++i) if (s[i].xpos >= left && player.xpos - player.xvel < left && s[0].ypos > top && s[1].ypos < bottom) s[i].collided = 1;
  } else {
    s[0].ypos = player.ypos - 0x20000;
    s[1].ypos = player.ypos + 0x80000;
    for (let i = 0; i < 2; ++i) if (s[i].xpos >= left && player.xpos - player.xvel < left && s[1].ypos > top && s[0].ypos < bottom) s[i].collided = 1;
  }
  hit = !!(s[1].collided || s[0].collided);
  if (!hit) return false;
  player.xpos = left - (E.collisionRight << 16);
  if (player.xvel > 0) {
    if (!E.objectEntityList[player.boundEntity].direction) player.pushing = 2;
    player.xvel = 0;
    player.speed = 0;
  }
  E.checkResult = 2;
  return true;
}

/** Pushing against the right side of a box. BoxCollision2 leaves sensor 0 on the player's right edge (sic). */
function boxRight(E: Engine3, player: Player3, right: number, top: number, bottom: number, v2: boolean): boolean {
  const s = E.sensors;
  s[0].collided = s[1].collided = 0;
  if (v2) {
    s[1].xpos = player.xpos + (E.collisionLeft << 16);
    s[0].ypos = player.ypos + ((E.collisionBottom - 2) << 16);
    s[1].ypos = player.ypos + ((E.collisionTop + 2) << 16);
    for (let i = 0; i < 2; ++i) if (s[i].xpos <= right && player.xpos - player.xvel > right && s[0].ypos > top && s[1].ypos < bottom) s[i].collided = 1;
  } else {
    s[0].xpos = player.xpos + (E.collisionLeft << 16);
    s[1].xpos = s[0].xpos;
    s[0].ypos = player.ypos - 0x20000;
    s[1].ypos = player.ypos + 0x80000;
    for (let i = 0; i < 2; ++i) if (s[i].xpos <= right && player.xpos - player.xvel > right && s[1].ypos > top && s[0].ypos < bottom) s[i].collided = 1;
  }
  if (!(s[1].collided || s[0].collided)) return false;
  player.xpos = right - (E.collisionLeft << 16);
  if (player.xvel < 0) {
    if (E.objectEntityList[player.boundEntity].direction === C.FLIP_X) player.pushing = 2;
    player.xvel = 0;
    player.speed = 0;
  }
  E.checkResult = 3;
  return true;
}

function boxCollision(E: Engine3, left: number, top: number, right: number, bottom: number, v2: boolean): void {
  const player = E.playerList[E.activePlayer];
  setHitboxBounds(E, player);
  E.checkResult = 0;
  if (boxSpeed(player) <= abs(player.yvel)) {
    if (!boxTop(E, player, left, top, right) && !boxBottom(E, player, left, right, bottom) && !boxLeft(E, player, left, top, bottom, v2))
      boxRight(E, player, right, top, bottom, v2);
  } else {
    if (!boxLeft(E, player, left, top, bottom, v2) && !boxRight(E, player, right, top, bottom, v2) && !boxTop(E, player, left, top, right))
      boxBottom(E, player, left, right, bottom);
  }
}

export function BoxCollision(E: Engine3, left: number, top: number, right: number, bottom: number): void {
  boxCollision(E, left, top, right, bottom, false);
}

export function BoxCollision2(E: Engine3, left: number, top: number, right: number, bottom: number): void {
  boxCollision(E, left, top, right, bottom, true);
}

export function PlatformCollision(E: Engine3, left: number, top: number, right: number, bottom: number): void {
  const player = E.playerList[E.activePlayer];
  setHitboxBounds(E, player);
  const s = E.sensors;
  s[0].collided = s[1].collided = s[2].collided = 0;
  s[0].xpos = player.xpos + ((E.collisionLeft + 1) << 16);
  s[1].xpos = player.xpos;
  s[2].xpos = player.xpos + (E.collisionRight << 16);
  s[0].ypos = player.ypos + (E.collisionBottom << 16);
  s[1].ypos = s[0].ypos;
  s[2].ypos = s[0].ypos;
  E.checkResult = 0;
  for (let i = 0; i < 3; ++i) {
    if (s[i].xpos > left && s[i].xpos < right && s[i].ypos > top - 2 && s[i].ypos < bottom && player.yvel >= 0) {
      s[i].collided = 1;
      player.setFlailing(i, 1);
    }
  }
  if (s[0].collided || s[1].collided || s[2].collided) {
    if (!player.gravity && (player.collisionMode === C.CMODE_RWALL || player.collisionMode === C.CMODE_LWALL)) {
      player.xvel = 0;
      player.speed = 0;
    }
    player.ypos = top - (E.collisionBottom << 16);
    player.gravity = 0;
    player.yvel = 0;
    player.angle = 0;
    E.objectEntityList[player.boundEntity].rotation = 0;
    player.controlLock = 0;
    E.checkResult = 1;
  }
}

export function BoxCollision3(E: Engine3, left: number, top: number, right: number, bottom: number): void {
  const player = E.playerList[E.activePlayer];
  setHitboxBounds(E, player);
  E.checkResult = 0;
  const s = E.sensors;
  if (boxTop(E, player, left, top, right)) return;
  // bottom: left < x < right, y <= bottom < ypos - yvel
  s[0].collided = s[1].collided = 0;
  s[0].xpos = player.xpos + ((E.collisionLeft + 2) << 16);
  s[1].xpos = player.xpos + ((E.collisionRight - 2) << 16);
  s[0].ypos = player.ypos + (E.collisionTop << 16);
  s[1].ypos = s[0].ypos;
  for (let i = 0; i < 2; ++i) if (left < s[i].xpos && s[i].xpos < right && s[i].ypos <= bottom && bottom < player.ypos - player.yvel) s[i].collided = 1;
  if (s[0].collided || s[1].collided) {
    if (player.gravity === 1) player.ypos = bottom - (E.collisionTop << 16);
    if (player.yvel < 1) player.yvel = 0;
    E.checkResult = 4;
    return;
  }
  s[0].collided = s[1].collided = 0;
  if (left <= player.xpos + (E.collisionRight << 16) && player.xpos - player.xvel < left) {
    for (let i = 0; i < 2; ++i) if (top < player.ypos + (E.collisionBottom << 16) && s[i].ypos < bottom) s[i].collided = 1;
  }
  if (s[0].collided || s[1].collided) {
    E.checkResult = 2;
    player.xpos = left - (E.collisionRight << 16);
    storeCollision(E);
    return;
  }
  s[0].collided = s[1].collided = 0;
  if ((E.collisionLeft << 16) + player.xpos <= right && right < player.xpos - player.xvel) {
    for (let i = 0; i < 2; ++i) if (top < (E.collisionBottom << 16) + player.ypos && s[i].ypos < bottom) s[i].collided = 1;
  }
  if (s[0].collided || s[1].collided) {
    E.checkResult = 3;
    player.xpos = right - (E.collisionLeft << 16);
    storeCollision(E);
  }
}

const hammerJumpHitbox = [-25, -25, 25, 25, -25, -25, 25, 25, -25, -25, 25, 25, -25, -25, 25, 25];
const hammerDashHitbox = [
  -10, -17, 23, 17, -23, -17, 10, 17, -18, -24, 10, 17, -10, -26, 25, 17,
  -10, -17, 23, 17, -23, -17, 10, 17, -18, -24, 10, 17, -10, -26, 25, 17,
];
const chibiHammerJumpHitbox = [-15, -11, 15, 20, -15, -11, 15, 20];
const chibiHammerDashHitbox = [-14, -12, 8, 12, -10, -12, 8, 12, -8, -12, 16, 12];

/** EnemyCollision (Origins Plus; the decompilation's reconstruction): touch, plus Amy's hammer reach. */
export function EnemyCollision(E: Engine3, left: number, top: number, right: number, bottom: number): void {
  TouchCollision(E, left, top, right, bottom);
  const player = E.playerList[E.activePlayer];
  const ent = E.objectEntityList[player.boundEntity];
  const g = (name: string, def: number) => {
    const i = E.globalVariableNames.indexOf(name);
    const v = i < 0 ? 0 : E.globalVariables[i];
    return v ? v : def;
  };
  const mini = g("Mini_PlayerFlag", 0) !== 0;
  const playerAmy = (g("PLAYER_AMY", 5) << 24) >> 24;
  const aniHammerJump = (g("ANI_HAMMER_JUMP", 45) << 24) >> 24;
  const aniHammerDash = (g("ANI_HAMMER_DASH", 46) << 24) >> 24;
  E.collisionLeft = player.xpos >> 16;
  E.collisionTop = player.ypos >> 16;
  E.collisionRight = E.collisionLeft;
  E.collisionBottom = E.collisionTop;
  if (E.checkResult || E.playerListPos !== playerAmy) return;
  let hl = 0, ht = 0, hr = 0, hbm = 0;
  if (ent.animation === aniHammerDash) {
    const frame = (mini ? ent.frame % 3 : ent.frame % 8) * 4;
    const tbl = mini ? chibiHammerDashHitbox : hammerDashHitbox;
    [hl, ht, hr, hbm] = [tbl[frame], tbl[frame + 1], tbl[frame + 2], tbl[frame + 3]];
  }
  if (ent.animation === aniHammerJump) {
    const frame = (mini ? ent.frame % 2 : ent.frame % 4) * 4;
    const tbl = mini ? chibiHammerJumpHitbox : hammerJumpHitbox;
    [hl, ht, hr, hbm] = [tbl[frame], tbl[frame + 1], tbl[frame + 2], tbl[frame + 3]];
  }
  if (ent.direction) [hl, hr] = [-hr, -hl];
  E.checkResult = +(E.collisionRight + hr > left && E.collisionLeft + hl < right && E.collisionBottom + hbm > top && E.collisionTop + ht < bottom);
}
