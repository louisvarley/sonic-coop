// Collision.cpp: tile collision (sensors, path grip, air collision) and object-vs-object collision boxes.
// Converted from the decompilation; behaviour is kept identical, including its quirks.
/* eslint-disable */
import type { Engine, Hitbox, CollisionSensor } from "./engine.js";
import type { Entity } from "./entity.js";
import {
  TILE_SIZE, SOLID_ALL, SOLID_TOP, SOLID_LRB, SOLID_NONE, SOLID_TOP_NOGRIP, FLIP_NONE, FLIP_X, FLIP_Y, FLIP_XY,
  CMODE_FLOOR, CMODE_LWALL, CMODE_ROOF, CMODE_RWALL, C_BOX,
} from "./c.js";
import { cos256LookupTable, sin256LookupTable, ArcTanLookup } from "./math.js";

export const H_TYPE_TOUCH = 0, H_TYPE_BOX = 1, H_TYPE_PLAT = 2, H_TYPE_FINGER = 3;
const DEBUG_HITBOX_COUNT = 0x400;

/** Records a hitbox for the developer collision overlay (only while E.showHitboxes is on). */
export function AddDebugHitbox(E: Engine, type: number, entity: Entity | null, left: number, top: number, right: number, bottom: number): number {
  const list = E.debugHitboxList;
  let i = 0;
  for (; i < E.debugHitboxCount; ++i) {
    const h = list[i];
    if (h.left === left && h.top === top && h.right === right && h.bottom === bottom && entity && h.xpos === entity.xpos && h.ypos === entity.ypos && h.entity === entity.slot)
      return i;
  }
  if (i < DEBUG_HITBOX_COUNT) {
    list[i] = { type, entity: entity ? entity.slot : -1, collision: 0, left, top, right, bottom, xpos: entity ? entity.xpos : 0, ypos: entity ? entity.ypos : 0 };
    return E.debugHitboxCount++;
  }
  return -1;
}

export function GetHitbox(E: Engine, entity: Entity): Hitbox
{
    const thisAnim = E.objectScriptList[entity.type].animFile;
    return E.hitboxList[thisAnim.hitboxListOffset
                       + E.animFrames[E.animationList[thisAnim.aniListOffset + entity.animation].frameListOffset + entity.frame].hitboxID];
}

export function FindFloorPosition(E: Engine, player: Entity, sensor: CollisionSensor, startY: number): void
{
    let c = 0;
    let angle = sensor.angle;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = sensor.xpos >> 16;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = (sensor.ypos >> 16) - TILE_SIZE + i;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile += tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_LRB
                    && E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].floorMasks[c] >= 0x40)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF;
                            break;
                        }
                        case FLIP_X: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].floorMasks[c] >= 0x40)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF);
                            break;
                        }
                        case FLIP_Y: {
                            c = (XPos & 15) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].roofMasks[c] <= -0x40)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24))) & 0xFF);
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].roofMasks[c] <= -0x40)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle = 0x100 - (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24))) & 0xFF);
                            break;
                        }
                    }
                }

                if (sensor.collided) {
                    if (sensor.angle < 0)
                        sensor.angle += 0x100;

                    if (sensor.angle >= 0x100)
                        sensor.angle -= 0x100;

                    if ((Math.abs(sensor.angle - angle) > 0x20) && (Math.abs(sensor.angle - 0x100 - angle) > 0x20)
                        && (Math.abs(sensor.angle + 0x100 - angle) > 0x20)) {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                        sensor.angle    = angle;
                        i                = TILE_SIZE * 3;
                    }
                    else if (sensor.ypos - startY > E.collisionTolerance || sensor.ypos - startY < -E.collisionTolerance) {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}
export function FindLWallPosition(E: Engine, player: Entity, sensor: CollisionSensor, startX: number): void
{
    let c = 0;
    let angle = sensor.angle;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = (sensor.xpos >> 16) - TILE_SIZE + i;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = sensor.ypos >> 16;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile          = tile + tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] < SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].lWallMasks[c] >= 0x40)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF00) >> 8);
                            break;
                        }
                        case FLIP_X: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].rWallMasks[c] <= -0x40)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF0000) >> 16);
                            break;
                        }
                        case FLIP_Y: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].lWallMasks[c] >= 0x40)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF00) >> 8))) & 0xFF);
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].rWallMasks[c] <= -0x40)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF0000) >> 16))) & 0xFF);
                            break;
                        }
                    }
                }
                if (sensor.collided) {
                    if (sensor.angle < 0)
                        sensor.angle += 0x100;

                    if (sensor.angle >= 0x100)
                        sensor.angle -= 0x100;

                    if (Math.abs(angle - sensor.angle) > 0x20) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                        sensor.angle    = angle;
                        i                = TILE_SIZE * 3;
                    }
                    else if (sensor.xpos - startX > E.collisionTolerance || sensor.xpos - startX < -E.collisionTolerance) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}
export function FindRoofPosition(E: Engine, player: Entity, sensor: CollisionSensor, startY: number): void
{
    let c = 0;
    let angle = sensor.angle;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = sensor.xpos >> 16;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = (sensor.ypos >> 16) + TILE_SIZE - i;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile          = tile + tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] < SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].roofMasks[c] <= -0x40)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24;
                            break;
                        }
                        case FLIP_X: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].roofMasks[c] <= -0x40)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24);
                            break;
                        }
                        case FLIP_Y: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].floorMasks[c] >= 0x40)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = (((0x180 - (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF))) & 0xFF);
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].floorMasks[c] >= 0x40)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - (((0x180 - (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF))) & 0xFF);
                            break;
                        }
                    }
                }

                if (sensor.collided) {
                    if (sensor.angle < 0)
                        sensor.angle += 0x100;

                    if (sensor.angle >= 0x100)
                        sensor.angle -= 0x100;

                    if (Math.abs(sensor.angle - angle) <= 0x20) {
                        if (sensor.ypos - startY > E.collisionTolerance || sensor.ypos - startY < -E.collisionTolerance) {
                            sensor.ypos     = startY << 16;
                            sensor.collided = 0;
                        }
                    }
                    else {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                        sensor.angle    = angle;
                        i                = TILE_SIZE * 3;
                    }
                }
            }
        }
    }
}
export function FindRWallPosition(E: Engine, player: Entity, sensor: CollisionSensor, startX: number): void
{
    let c = 0;
    let angle = sensor.angle;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = (sensor.xpos >> 16) + TILE_SIZE - i;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = sensor.ypos >> 16;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile          = tile + tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] < SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].rWallMasks[c] <= -0x40)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = ((((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF0000) >> 16)) & 0xFF);
                            break;
                        }
                        case FLIP_X: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].lWallMasks[c] >= 0x40)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF00) >> 8);
                            break;
                        }
                        case FLIP_Y: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].rWallMasks[c] <= -0x40)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF0000) >> 16))) & 0xFF);
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if (E.collisionMasks[player.collisionPlane].lWallMasks[c] >= 0x40)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF00) >> 8))) & 0xFF);
                            break;
                        }
                    }
                }
                if (sensor.collided) {
                    if (sensor.angle < 0)
                        sensor.angle += 0x100;

                    if (sensor.angle >= 0x100)
                        sensor.angle -= 0x100;

                    if (Math.abs(sensor.angle - angle) > 0x20) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                        sensor.angle    = angle;
                        i                = TILE_SIZE * 3;
                    }
                    else if (sensor.xpos - startX > E.collisionTolerance || sensor.xpos - startX < -E.collisionTolerance) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}

export function FloorCollision(E: Engine, player: Entity, sensor: CollisionSensor): void
{
    let c = 0;
    let startY = sensor.ypos >> 16;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = sensor.xpos >> 16;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = (sensor.ypos >> 16) - TILE_SIZE + i;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile += tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_LRB
                    && E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) <= E.collisionMasks[player.collisionPlane].floorMasks[c] - TILE_SIZE + i
                                || E.collisionMasks[player.collisionPlane].floorMasks[c] >= tsm1)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF;
                            break;
                        }
                        case FLIP_X: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) <= E.collisionMasks[player.collisionPlane].floorMasks[c] - TILE_SIZE + i
                                || E.collisionMasks[player.collisionPlane].floorMasks[c] >= tsm1)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF);
                            break;
                        }
                        case FLIP_Y: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) <= tsm1 - E.collisionMasks[player.collisionPlane].roofMasks[c] - TILE_SIZE + i)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            let cAngle = (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24;
                            sensor.angle    = (((0x180 - cAngle)) & 0xFF);
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) <= tsm1 - E.collisionMasks[player.collisionPlane].roofMasks[c] - TILE_SIZE + i)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle = 0x100 - (((0x180 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24))) & 0xFF);
                            break;
                        }
                    }
                }

                if (sensor.collided) {
                    if (sensor.angle < 0)
                        sensor.angle += 0x100;

                    if (sensor.angle >= 0x100)
                        sensor.angle -= 0x100;

                    if (sensor.ypos - startY > (TILE_SIZE - 2)) {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                    }
                    else if (sensor.ypos - startY < -(TILE_SIZE + 1)) {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}
export function LWallCollision(E: Engine, player: Entity, sensor: CollisionSensor): void
{
    let c = 0;
    let startX = sensor.xpos >> 16;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = (sensor.xpos >> 16) - TILE_SIZE + i;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = sensor.ypos >> 16;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile += tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_TOP
                    && E.tiles128x128.collisionFlags[player.collisionPlane][tile] < SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) <= E.collisionMasks[player.collisionPlane].lWallMasks[c] - TILE_SIZE + i)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                        case FLIP_X: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) <= tsm1 - E.collisionMasks[player.collisionPlane].rWallMasks[c] - TILE_SIZE + i)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                        case FLIP_Y: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) <= E.collisionMasks[player.collisionPlane].lWallMasks[c] - TILE_SIZE + i)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) <= tsm1 - E.collisionMasks[player.collisionPlane].rWallMasks[c] - TILE_SIZE + i)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                    }
                }

                if (sensor.collided) {
                    if (sensor.xpos - startX > tsm1) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                    }
                    else if (sensor.xpos - startX < -tsm1) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}
export function RoofCollision(E: Engine, player: Entity, sensor: CollisionSensor): void
{
    let c = 0;
    let startY = sensor.ypos >> 16;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = sensor.xpos >> 16;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = (sensor.ypos >> 16) + TILE_SIZE - i;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile += tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_TOP
                    && E.tiles128x128.collisionFlags[player.collisionPlane][tile] < SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) >= E.collisionMasks[player.collisionPlane].roofMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24);
                            break;
                        }
                        case FLIP_X: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) >= E.collisionMasks[player.collisionPlane].roofMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.ypos     = E.collisionMasks[player.collisionPlane].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - ((E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF000000) >>> 24);
                            break;
                        }
                        case FLIP_Y: {
                            c = (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) >= tsm1 - E.collisionMasks[player.collisionPlane].floorMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x180 - (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF);
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (XPos & tsm1) + (tileIndex << 4);
                            if ((YPos & tsm1) >= tsm1 - E.collisionMasks[player.collisionPlane].floorMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.ypos     = tsm1 - E.collisionMasks[player.collisionPlane].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                            sensor.collided = 1;
                            sensor.angle    = 0x100 - (((0x180 - (E.collisionMasks[player.collisionPlane].angles[tileIndex] & 0xFF))) & 0xFF);
                            break;
                        }
                    }
                }

                if (sensor.collided) {
                    if (sensor.angle < 0)
                        sensor.angle += 0x100;

                    if (sensor.angle >= 0x100)
                        sensor.angle -= 0x100;

                    if (sensor.ypos - startY > (tsm1 - 1)) {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                    }
                    else if (sensor.ypos - startY < -(tsm1 - 1)) {
                        sensor.ypos     = startY << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}
export function RWallCollision(E: Engine, player: Entity, sensor: CollisionSensor): void
{
    let c = 0;
    let startX = sensor.xpos >> 16;
    let tsm1 = (TILE_SIZE - 1);
    for (let i = 0; i < TILE_SIZE * 3; i += TILE_SIZE) {
        if (!sensor.collided) {
            let XPos = (sensor.xpos >> 16) + TILE_SIZE - i;
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let YPos = sensor.ypos >> 16;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            if (XPos > -1 && YPos > -1) {
                let tile = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
                tile += tileX + (tileY << 3);
                let tileIndex = E.tiles128x128.tileIndex[tile];
                if (E.tiles128x128.collisionFlags[player.collisionPlane][tile] != SOLID_TOP
                    && E.tiles128x128.collisionFlags[player.collisionPlane][tile] < SOLID_NONE) {
                    switch (E.tiles128x128.direction[tile]) {
                        case FLIP_NONE: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) >= E.collisionMasks[player.collisionPlane].rWallMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                        case FLIP_X: {
                            c = (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) >= tsm1 - E.collisionMasks[player.collisionPlane].lWallMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                        case FLIP_Y: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) >= E.collisionMasks[player.collisionPlane].rWallMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.xpos     = E.collisionMasks[player.collisionPlane].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                        case FLIP_XY: {
                            c = tsm1 - (YPos & tsm1) + (tileIndex << 4);
                            if ((XPos & tsm1) >= tsm1 - E.collisionMasks[player.collisionPlane].lWallMasks[c] + TILE_SIZE - i)
                                break;

                            sensor.xpos     = tsm1 - E.collisionMasks[player.collisionPlane].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                            sensor.collided = 1;
                            break;
                        }
                    }
                }

                if (sensor.collided) {
                    if (sensor.xpos - startX > tsm1) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                    }
                    else if (sensor.xpos - startX < -tsm1) {
                        sensor.xpos     = startX << 16;
                        sensor.collided = 0;
                    }
                }
            }
        }
    }
}

export function ProcessAirCollision(E: Engine, entity: Entity): void
{
    let playerHitbox = GetHitbox(E, entity);
    E.collisionLeft        = playerHitbox.left[0];
    E.collisionTop         = playerHitbox.top[0];
    E.collisionRight       = playerHitbox.right[0];
    E.collisionBottom      = playerHitbox.bottom[0];

    let movingDown = 0;
    let movingUp = 0;
    let movingLeft = 0;
    let movingRight = 0;

    if (entity.xvel < 0) {
        movingRight = 0;
    }
    else {
        movingRight         = 1;
        E.sensors[0].ypos     = entity.ypos + 0x40000;
        E.sensors[0].collided = 0;
        E.sensors[0].xpos     = entity.xpos + (E.collisionRight << 16);
    }
    if (entity.xvel > 0) {
        movingLeft = 0;
    }
    else {
        movingLeft          = 1;
        E.sensors[1].ypos     = entity.ypos + 0x40000;
        E.sensors[1].collided = 0;
        E.sensors[1].xpos     = entity.xpos + ((E.collisionLeft - 1) << 16);
    }
    E.sensors[2].xpos     = entity.xpos + (playerHitbox.left[1] << 16);
    E.sensors[3].xpos     = entity.xpos + (playerHitbox.right[1] << 16);
    E.sensors[2].collided = 0;
    E.sensors[3].collided = 0;
    E.sensors[4].xpos     = E.sensors[2].xpos;
    E.sensors[5].xpos     = E.sensors[3].xpos;
    E.sensors[4].collided = 0;
    E.sensors[5].collided = 0;
    if (entity.yvel < 0) {
        movingDown = 0;
    }
    else {
        movingDown      = 1;
        E.sensors[2].ypos = entity.ypos + (E.collisionBottom << 16);
        E.sensors[3].ypos = entity.ypos + (E.collisionBottom << 16);
    }

    if (Math.abs(entity.xvel) > 0x10000 || entity.yvel < 0) {
        movingUp        = 1;
        E.sensors[4].ypos = entity.ypos + ((E.collisionTop - 1) << 16);
        E.sensors[5].ypos = entity.ypos + ((E.collisionTop - 1) << 16);
    }

    let cnt = (Math.abs(entity.xvel) <= Math.abs(entity.yvel) ? (Math.abs(entity.yvel) >> 19) + 1 : (Math.abs(entity.xvel) >> 19) + 1);
    let XVel = Math.trunc(entity.xvel / cnt);
    let YVel = Math.trunc(entity.yvel / cnt);
    let XVel2 = entity.xvel - XVel * (cnt - 1);
    let YVel2 = entity.yvel - YVel * (cnt - 1);
    while (cnt > 0) {
        if (cnt < 2) {
            XVel = XVel2;
            YVel = YVel2;
        }
        cnt--;

        if (movingRight == 1) {
            E.sensors[0].xpos += XVel;
            E.sensors[0].ypos += YVel;
            LWallCollision(E, entity, E.sensors[0]);
            if (E.sensors[0].collided) {
                movingRight = 2;
            }
            else if (entity.xvel < 0x20000) {
                E.sensors[0].ypos -= 0x80000;
                LWallCollision(E, entity, E.sensors[0]);
                if (E.sensors[0].collided)
                    movingRight = 2;
                E.sensors[0].ypos += 0x80000;
            }
        }

        if (movingLeft == 1) {
            E.sensors[1].xpos += XVel;
            E.sensors[1].ypos += YVel;
            RWallCollision(E, entity, E.sensors[1]);
            if (E.sensors[1].collided) {
                movingLeft = 2;
            }
            else if (entity.xvel > -0x20000) {
                E.sensors[1].ypos -= 0x80000;
                RWallCollision(E, entity, E.sensors[1]);
                if (E.sensors[1].collided)
                    movingLeft = 2;
                E.sensors[1].ypos += 0x80000;
            }
        }

        if (movingRight == 2) {
            entity.xvel    = 0;
            entity.speed   = 0;
            entity.xpos    = (E.sensors[0].xpos - E.collisionRight) << 16;
            E.sensors[2].xpos = entity.xpos + ((E.collisionLeft + 1) << 16);
            E.sensors[3].xpos = entity.xpos + ((E.collisionRight - 2) << 16);
            E.sensors[4].xpos = E.sensors[2].xpos;
            E.sensors[5].xpos = E.sensors[3].xpos;
            XVel            = 0;
            XVel2           = 0;
            movingRight     = 3;
        }

        if (movingLeft == 2) {
            entity.xvel    = 0;
            entity.speed   = 0;
            entity.xpos    = (E.sensors[1].xpos - E.collisionLeft + 1) << 16;
            E.sensors[2].xpos = entity.xpos + ((E.collisionLeft + 1) << 16);
            E.sensors[3].xpos = entity.xpos + ((E.collisionRight - 2) << 16);
            E.sensors[4].xpos = E.sensors[2].xpos;
            E.sensors[5].xpos = E.sensors[3].xpos;
            XVel            = 0;
            XVel2           = 0;
            movingLeft      = 3;
        }

        if (movingDown == 1) {
            for (let i = 2; i < 4; i++) {
                if (!E.sensors[i].collided) {
                    E.sensors[i].xpos += XVel;
                    E.sensors[i].ypos += YVel;
                    FloorCollision(E, entity, E.sensors[i]);
                }
            }
            if (E.sensors[2].collided || E.sensors[3].collided) {
                movingDown = 2;
                cnt        = 0;
            }
        }

        if (movingUp == 1) {
            for (let i = 4; i < 6; i++) {
                if (!E.sensors[i].collided) {
                    E.sensors[i].xpos += XVel;
                    E.sensors[i].ypos += YVel;
                    RoofCollision(E, entity, E.sensors[i]);
                }
            }
            if (E.sensors[4].collided || E.sensors[5].collided) {
                movingUp = 2;
                cnt      = 0;
            }
        }
    }

    if (movingRight < 2 && movingLeft < 2)
        entity.xpos = entity.xpos + entity.xvel;

    if (movingUp < 2 && movingDown < 2) {
        entity.ypos = entity.ypos + entity.yvel;
        return;
    }

    if (movingDown == 2) {
        entity.gravity = 0;
        if (E.sensors[2].collided && E.sensors[3].collided) {
            if (E.sensors[2].ypos >= E.sensors[3].ypos) {
                entity.ypos  = (E.sensors[3].ypos - E.collisionBottom) << 16;
                entity.angle = E.sensors[3].angle;
            }
            else {
                entity.ypos  = (E.sensors[2].ypos - E.collisionBottom) << 16;
                entity.angle = E.sensors[2].angle;
            }
        }
        else if (E.sensors[2].collided == 1) {
            entity.ypos  = (E.sensors[2].ypos - E.collisionBottom) << 16;
            entity.angle = E.sensors[2].angle;
        }
        else if (E.sensors[3].collided == 1) {
            entity.ypos  = (E.sensors[3].ypos - E.collisionBottom) << 16;
            entity.angle = E.sensors[3].angle;
        }
        if (entity.angle > 0xA0 && entity.angle < 0xE0 && entity.collisionMode != CMODE_LWALL) {
            entity.collisionMode = CMODE_LWALL;
            entity.xpos -= 0x40000;
        }
        if (entity.angle > 0x20 && entity.angle < 0x60 && entity.collisionMode != CMODE_RWALL) {
            entity.collisionMode = CMODE_RWALL;
            entity.xpos += 0x40000;
        }
        if (entity.angle < 0x20 || entity.angle > 0xE0) {
            entity.controlLock = 0;
        }
        entity.rotation = entity.angle << 1;

        let speed = 0;
        if (entity.down) {
            if (entity.angle < 128) {
                if (entity.angle < 16) {
                    speed = entity.xvel;
                }
                else if (entity.angle >= 32) {
                    speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel) ? entity.yvel + Math.trunc(entity.yvel / 12) : entity.xvel);
                }
                else {
                    speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel >> 1) ? (entity.yvel + Math.trunc(entity.yvel / 12)) >> 1 : entity.xvel);
                }
            }
            else if (entity.angle > 240) {
                speed = entity.xvel;
            }
            else if (entity.angle <= 224) {
                speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel) ? -(entity.yvel + Math.trunc(entity.yvel / 12)) : entity.xvel);
            }
            else {
                speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel >> 1) ? -((entity.yvel + Math.trunc(entity.yvel / 12)) >> 1) : entity.xvel);
            }
        }
        else if (entity.angle < 0x80) {
            if (entity.angle < 0x10) {
                speed = entity.xvel;
            }
            else if (entity.angle >= 0x20) {
                speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel) ? entity.yvel : entity.xvel);
            }
            else {
                speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel >> 1) ? entity.yvel >> 1 : entity.xvel);
            }
        }
        else if (entity.angle > 0xF0) {
            speed = entity.xvel;
        }
        else if (entity.angle <= 0xE0) {
            speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel) ? -entity.yvel : entity.xvel);
        }
        else {
            speed = (Math.abs(entity.xvel) <= Math.abs(entity.yvel >> 1) ? -(entity.yvel >> 1) : entity.xvel);
        }

        if (speed < -0x180000)
            speed = -0x180000;
        if (speed > 0x180000)
            speed = 0x180000;
        entity.speed         = speed;
        entity.yvel          = 0;
        E.scriptEng.checkResult = 1;
    }

    if (movingUp == 2) {
        let sensorAngle = 0;
        if (E.sensors[4].collided && E.sensors[5].collided) {
            if (E.sensors[4].ypos <= E.sensors[5].ypos) {
                entity.ypos = (E.sensors[5].ypos - E.collisionTop + 1) << 16;
                sensorAngle  = E.sensors[5].angle;
            }
            else {
                entity.ypos = (E.sensors[4].ypos - E.collisionTop + 1) << 16;
                sensorAngle  = E.sensors[4].angle;
            }
        }
        else if (E.sensors[4].collided) {
            entity.ypos = (E.sensors[4].ypos - E.collisionTop + 1) << 16;
            sensorAngle  = E.sensors[4].angle;
        }
        else if (E.sensors[5].collided) {
            entity.ypos = (E.sensors[5].ypos - E.collisionTop + 1) << 16;
            sensorAngle  = E.sensors[5].angle;
        }
        sensorAngle &= 0xFF;

        let angle = ArcTanLookup(entity.xvel, entity.yvel);
        if (sensorAngle > 0x40 && sensorAngle < 0x62 && angle > 0xA0 && angle < 0xC2) {
            entity.gravity       = 0;
            entity.angle         = sensorAngle;
            entity.rotation      = entity.angle << 1;
            entity.collisionMode = CMODE_RWALL;
            entity.xpos += 0x40000;
            entity.ypos -= 0x20000;
            if (entity.angle <= 0x60)
                entity.speed = entity.yvel;
            else
                entity.speed = entity.yvel >> 1;
        }
        if (sensorAngle > 0x9E && sensorAngle < 0xC0 && angle > 0xBE && angle < 0xE0) {
            entity.gravity       = 0;
            entity.angle         = sensorAngle;
            entity.rotation      = entity.angle << 1;
            entity.collisionMode = CMODE_LWALL;
            entity.xpos -= 0x40000;
            entity.ypos -= 0x20000;
            if (entity.angle >= 0xA0)
                entity.speed = -entity.yvel;
            else
                entity.speed = -entity.yvel >> 1;
        }
        if (entity.yvel < 0)
            entity.yvel = 0;
        E.scriptEng.checkResult = 2;
    }
}
export function ProcessPathGrip(E: Engine, entity: Entity): void
{
    let cosValue256 = 0;
    let sinValue256 = 0;
    E.sensors[4].xpos = entity.xpos;
    E.sensors[4].ypos = entity.ypos;
    for (let i = 0; i < (7); ++i) {
        E.sensors[i].angle    = entity.angle;
        E.sensors[i].collided = 0;
    }
    SetPathGripSensors(E, entity);
    let absSpeed = Math.abs(entity.speed);
    let checkDist = absSpeed >> 18;
    absSpeed &= 0x3FFFF;
    let cMode = entity.collisionMode;

    while (checkDist > -1) {
        if (checkDist >= 1) {
            cosValue256 = cos256LookupTable[entity.angle] << 10;
            sinValue256 = sin256LookupTable[entity.angle] << 10;
            checkDist--;
        }
        else {
            cosValue256 = absSpeed * cos256LookupTable[entity.angle] >> 8;
            sinValue256 = absSpeed * sin256LookupTable[entity.angle] >> 8;
            checkDist   = -1;
        }

        if (entity.speed < 0) {
            cosValue256 = -cosValue256;
            sinValue256 = -sinValue256;
        }

        E.sensors[0].collided = 0;
        E.sensors[1].collided = 0;
        E.sensors[2].collided = 0;
        E.sensors[5].collided = 0;
        E.sensors[6].collided = 0;
        E.sensors[4].xpos += cosValue256;
        E.sensors[4].ypos += sinValue256;
        let tileDistance = -1;

        switch (entity.collisionMode) {
            case CMODE_FLOOR: {
                E.sensors[3].xpos += cosValue256;
                E.sensors[3].ypos += sinValue256;

                if (entity.speed > 0) {
                    LWallCollision(E, entity, E.sensors[3]);
                    if (E.sensors[3].collided) {
                        E.sensors[2].xpos = (E.sensors[3].xpos - 2) << 16;
                    }
                }

                if (entity.speed < 0) {
                    RWallCollision(E, entity, E.sensors[3]);
                    if (E.sensors[3].collided) {
                        E.sensors[0].xpos = (E.sensors[3].xpos + 2) << 16;
                    }
                }

                if (E.sensors[3].collided) {
                    cosValue256 = 0;
                    checkDist   = -1;
                }

                for (let i = 0; i < 3; i++) {
                    E.sensors[i].xpos += cosValue256;
                    E.sensors[i].ypos += sinValue256;
                    FindFloorPosition(E, entity, E.sensors[i], E.sensors[i].ypos >> 16);
                }

                for (let i = 5; i < 7; i++) {
                    E.sensors[i].xpos += cosValue256;
                    E.sensors[i].ypos += sinValue256;
                    FindFloorPosition(E, entity, E.sensors[i], E.sensors[i].ypos >> 16);
                }

                tileDistance = -1;
                for (let i = 0; i < 3; i++) {
                    if (tileDistance > -1) {
                        if (E.sensors[i].collided) {
                            if (E.sensors[i].ypos < E.sensors[tileDistance].ypos)
                                tileDistance = i;

                            if (E.sensors[i].ypos == E.sensors[tileDistance].ypos && (E.sensors[i].angle < 0x08 || E.sensors[i].angle > 0xF8))
                                tileDistance = i;
                        }
                    }
                    else if (E.sensors[i].collided)
                        tileDistance = i;
                }

                if (tileDistance <= -1) {
                    checkDist = -1;
                }
                else {
                    E.sensors[0].ypos  = E.sensors[tileDistance].ypos << 16;
                    E.sensors[0].angle = E.sensors[tileDistance].angle;
                    E.sensors[1].ypos  = E.sensors[0].ypos;
                    E.sensors[1].angle = E.sensors[0].angle;
                    E.sensors[2].ypos  = E.sensors[0].ypos;
                    E.sensors[2].angle = E.sensors[0].angle;
                    E.sensors[3].ypos  = E.sensors[0].ypos - 0x40000;
                    E.sensors[3].angle = E.sensors[0].angle;
                    E.sensors[4].xpos  = E.sensors[1].xpos;
                    E.sensors[4].ypos  = E.sensors[0].ypos - (E.collisionBottom << 16);
                }

                if (E.sensors[0].angle < 0xDE && E.sensors[0].angle > 0x80)
                    entity.collisionMode = CMODE_LWALL;
                if (E.sensors[0].angle > 0x22 && E.sensors[0].angle < 0x80)
                    entity.collisionMode = CMODE_RWALL;
                break;
            }
            case CMODE_LWALL: {
                E.sensors[3].xpos += cosValue256;
                E.sensors[3].ypos += sinValue256;

                if (entity.speed > 0)
                    RoofCollision(E, entity, E.sensors[3]);

                if (entity.speed < 0)
                    FloorCollision(E, entity, E.sensors[3]);

                if (E.sensors[3].collided) {
                    sinValue256 = 0;
                    checkDist   = -1;
                }
                for (let i = 0; i < 3; i++) {
                    E.sensors[i].xpos += cosValue256;
                    E.sensors[i].ypos += sinValue256;
                    FindLWallPosition(E, entity, E.sensors[i], E.sensors[i].xpos >> 16);
                }

                tileDistance = -1;
                for (let i = 0; i < 3; i++) {
                    if (tileDistance > -1) {
                        if (E.sensors[i].xpos < E.sensors[tileDistance].xpos && E.sensors[i].collided) {
                            tileDistance = i;
                        }
                    }
                    else if (E.sensors[i].collided) {
                        tileDistance = i;
                    }
                }

                if (tileDistance <= -1) {
                    checkDist = -1;
                }
                else {
                    E.sensors[0].xpos  = E.sensors[tileDistance].xpos << 16;
                    E.sensors[0].angle = E.sensors[tileDistance].angle;
                    E.sensors[1].xpos  = E.sensors[0].xpos;
                    E.sensors[1].angle = E.sensors[0].angle;
                    E.sensors[2].xpos  = E.sensors[0].xpos;
                    E.sensors[2].angle = E.sensors[0].angle;
                    E.sensors[4].ypos  = E.sensors[1].ypos;
                    E.sensors[4].xpos  = E.sensors[1].xpos - (E.collisionRight << 16);
                }

                if (E.sensors[0].angle > 0xE2)
                    entity.collisionMode = CMODE_FLOOR;
                if (E.sensors[0].angle < 0x9E)
                    entity.collisionMode = CMODE_ROOF;
                break;
                break;
            }
            case CMODE_ROOF: {
                E.sensors[3].xpos += cosValue256;
                E.sensors[3].ypos += sinValue256;

                if (entity.speed > 0)
                    RWallCollision(E, entity, E.sensors[3]);

                if (entity.speed < 0)
                    LWallCollision(E, entity, E.sensors[3]);

                if (E.sensors[3].collided) {
                    cosValue256 = 0;
                    checkDist   = -1;
                }
                for (let i = 0; i < 3; i++) {
                    E.sensors[i].xpos += cosValue256;
                    E.sensors[i].ypos += sinValue256;
                    FindRoofPosition(E, entity, E.sensors[i], E.sensors[i].ypos >> 16);
                }

                tileDistance = -1;
                for (let i = 0; i < 3; i++) {
                    if (tileDistance > -1) {
                        if (E.sensors[i].ypos > E.sensors[tileDistance].ypos && E.sensors[i].collided) {
                            tileDistance = i;
                        }
                    }
                    else if (E.sensors[i].collided) {
                        tileDistance = i;
                    }
                }

                if (tileDistance <= -1) {
                    checkDist = -1;
                }
                else {
                    E.sensors[0].ypos  = E.sensors[tileDistance].ypos << 16;
                    E.sensors[0].angle = E.sensors[tileDistance].angle;
                    E.sensors[1].ypos  = E.sensors[0].ypos;
                    E.sensors[1].angle = E.sensors[0].angle;
                    E.sensors[2].ypos  = E.sensors[0].ypos;
                    E.sensors[2].angle = E.sensors[0].angle;
                    E.sensors[3].ypos  = E.sensors[0].ypos + 0x40000;
                    E.sensors[3].angle = E.sensors[0].angle;
                    E.sensors[4].xpos  = E.sensors[1].xpos;
                    E.sensors[4].ypos  = E.sensors[0].ypos - ((E.collisionTop - 1) << 16);
                }

                if (E.sensors[0].angle > 0xA2)
                    entity.collisionMode = CMODE_LWALL;
                if (E.sensors[0].angle < 0x5E)
                    entity.collisionMode = CMODE_RWALL;
                break;
            }
            case CMODE_RWALL: {
                E.sensors[3].xpos += cosValue256;
                E.sensors[3].ypos += sinValue256;

                if (entity.speed > 0)
                    FloorCollision(E, entity, E.sensors[3]);

                if (entity.speed < 0)
                    RoofCollision(E, entity, E.sensors[3]);

                if (E.sensors[3].collided) {
                    sinValue256 = 0;
                    checkDist   = -1;
                }
                for (let i = 0; i < 3; i++) {
                    E.sensors[i].xpos += cosValue256;
                    E.sensors[i].ypos += sinValue256;
                    FindRWallPosition(E, entity, E.sensors[i], E.sensors[i].xpos >> 16);
                }

                tileDistance = -1;
                for (let i = 0; i < 3; i++) {
                    if (tileDistance > -1) {
                        if (E.sensors[i].xpos > E.sensors[tileDistance].xpos && E.sensors[i].collided) {
                            tileDistance = i;
                        }
                    }
                    else if (E.sensors[i].collided) {
                        tileDistance = i;
                    }
                }

                if (tileDistance <= -1) {
                    checkDist = -1;
                }
                else {
                    E.sensors[0].xpos  = E.sensors[tileDistance].xpos << 16;
                    E.sensors[0].angle = E.sensors[tileDistance].angle;
                    E.sensors[1].xpos  = E.sensors[0].xpos;
                    E.sensors[1].angle = E.sensors[0].angle;
                    E.sensors[2].xpos  = E.sensors[0].xpos;
                    E.sensors[2].angle = E.sensors[0].angle;
                    E.sensors[4].ypos  = E.sensors[1].ypos;
                    E.sensors[4].xpos  = E.sensors[1].xpos - ((E.collisionLeft - 1) << 16);
                }

                if (E.sensors[0].angle < 0x1E)
                    entity.collisionMode = CMODE_FLOOR;
                if (E.sensors[0].angle > 0x62)
                    entity.collisionMode = CMODE_ROOF;
                break;
            }
        }
        if (tileDistance != -1)
            entity.angle = E.sensors[0].angle;

        if (!E.sensors[3].collided)
            SetPathGripSensors(E, entity);
        else
            checkDist = -2;
    }

    switch (cMode) {
        case CMODE_FLOOR: {
            if (E.sensors[0].collided || E.sensors[1].collided || E.sensors[2].collided) {
                entity.angle           = E.sensors[0].angle;
                entity.rotation        = entity.angle << 1;
                entity.floorSensors[0] = E.sensors[0].collided;
                entity.floorSensors[1] = E.sensors[1].collided;
                entity.floorSensors[2] = E.sensors[2].collided;
                entity.floorSensors[3] = E.sensors[5].collided;
                entity.floorSensors[4] = E.sensors[6].collided;
                if (!E.sensors[3].collided) {
                    entity.pushing = 0;
                    entity.xpos    = E.sensors[4].xpos;
                }
                else {
                    if (entity.speed > 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionRight) << 16;

                    if (entity.speed < 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionLeft + 1) << 16;

                    entity.speed = 0;
                    if ((entity.left || entity.right) && entity.pushing < 2)
                        entity.pushing++;
                }
                entity.ypos = E.sensors[4].ypos;
            }
            else {
                entity.gravity       = 1;
                entity.collisionMode = CMODE_FLOOR;
                entity.xvel          = cos256LookupTable[entity.angle] * entity.speed >> 8;
                entity.yvel          = sin256LookupTable[entity.angle] * entity.speed >> 8;
                if (entity.yvel < -0x100000)
                    entity.yvel = -0x100000;

                if (entity.yvel > 0x100000)
                    entity.yvel = 0x100000;

                entity.speed = entity.xvel;
                entity.angle = 0;
                if (!E.sensors[3].collided) {
                    entity.pushing = 0;
                    entity.xpos += entity.xvel;
                }
                else {
                    if (entity.speed > 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionRight) << 16;
                    if (entity.speed < 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionLeft + 1) << 16;

                    entity.speed = 0;
                    if ((entity.left || entity.right) && entity.pushing < 2)
                        entity.pushing++;
                }
                entity.ypos += entity.yvel;
            }
            break;
        }
        case CMODE_LWALL: {
            if (!E.sensors[0].collided && !E.sensors[1].collided && !E.sensors[2].collided) {
                entity.gravity       = 1;
                entity.collisionMode = CMODE_FLOOR;
                entity.xvel          = cos256LookupTable[entity.angle] * entity.speed >> 8;
                entity.yvel          = sin256LookupTable[entity.angle] * entity.speed >> 8;
                if (entity.yvel < -0x100000) {
                    entity.yvel = -0x100000;
                }
                if (entity.yvel > 0x100000) {
                    entity.yvel = 0x100000;
                }
                entity.speed = entity.xvel;
                entity.angle = 0;
            }
            else if (entity.speed >= 0x28000 || entity.speed <= -0x28000 || entity.controlLock != 0) {
                entity.angle    = E.sensors[0].angle;
                entity.rotation = entity.angle << 1;
            }
            else {
                entity.gravity       = 1;
                entity.angle         = 0;
                entity.collisionMode = CMODE_FLOOR;
                entity.speed         = entity.xvel;
                entity.controlLock   = 30;
            }
            if (!E.sensors[3].collided) {
                entity.ypos = E.sensors[4].ypos;
            }
            else {
                if (entity.speed > 0)
                    entity.ypos = (E.sensors[3].ypos - E.collisionTop) << 16;

                if (entity.speed < 0)
                    entity.ypos = (E.sensors[3].ypos - E.collisionBottom) << 16;

                entity.speed = 0;
            }
            entity.xpos = E.sensors[4].xpos;
            break;
        }
        case CMODE_ROOF: {
            if (!E.sensors[0].collided && !E.sensors[1].collided && !E.sensors[2].collided) {
                entity.gravity         = 1;
                entity.collisionMode   = CMODE_FLOOR;
                entity.xvel            = cos256LookupTable[entity.angle] * entity.speed >> 8;
                entity.yvel            = sin256LookupTable[entity.angle] * entity.speed >> 8;
                entity.floorSensors[0] = 0;
                entity.floorSensors[1] = 0;
                entity.floorSensors[2] = 0;
                if (entity.yvel < -0x100000)
                    entity.yvel = -0x100000;

                if (entity.yvel > 0x100000)
                    entity.yvel = 0x100000;

                entity.angle = 0;
                entity.speed = entity.xvel;
                if (!E.sensors[3].collided) {
                    entity.xpos = entity.xpos + entity.xvel;
                }
                else {
                    if (entity.speed > 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionRight) << 16;

                    if (entity.speed < 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionLeft + 1) << 16;

                    entity.speed = 0;
                }
            }
            else if (entity.speed <= -0x28000 || entity.speed >= 0x28000) {
                entity.angle    = E.sensors[0].angle;
                entity.rotation = entity.angle << 1;
                if (!E.sensors[3].collided) {
                    entity.xpos = E.sensors[4].xpos;
                }
                else {
                    if (entity.speed < 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionRight) << 16;

                    if (entity.speed > 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionLeft + 1) << 16;
                    entity.speed = 0;
                }
            }
            else {
                entity.gravity         = 1;
                entity.angle           = 0;
                entity.collisionMode   = CMODE_FLOOR;
                entity.speed           = entity.xvel;
                entity.floorSensors[0] = 0;
                entity.floorSensors[1] = 0;
                entity.floorSensors[2] = 0;
                if (!E.sensors[3].collided) {
                    entity.xpos = entity.xpos + entity.xvel;
                }
                else {
                    if (entity.speed > 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionRight) << 16;

                    if (entity.speed < 0)
                        entity.xpos = (E.sensors[3].xpos - E.collisionLeft + 1) << 16;
                    entity.speed = 0;
                }
            }
            entity.ypos = E.sensors[4].ypos;
            break;
        }
        case CMODE_RWALL: {
            if (!E.sensors[0].collided && !E.sensors[1].collided && !E.sensors[2].collided) {
                entity.gravity       = 1;
                entity.collisionMode = CMODE_FLOOR;
                entity.xvel          = cos256LookupTable[entity.angle] * entity.speed >> 8;
                entity.yvel          = sin256LookupTable[entity.angle] * entity.speed >> 8;
                if (entity.yvel < -0x100000)
                    entity.yvel = -0x100000;

                if (entity.yvel > 0x100000)
                    entity.yvel = 0x100000;

                entity.speed = entity.xvel;
                entity.angle = 0;
            }
            else if (entity.speed <= -0x28000 || entity.speed >= 0x28000 || entity.controlLock != 0) {
                entity.angle    = E.sensors[0].angle;
                entity.rotation = entity.angle << 1;
            }
            else {
                entity.gravity       = 1;
                entity.angle         = 0;
                entity.collisionMode = CMODE_FLOOR;
                entity.speed         = entity.xvel;
                entity.controlLock   = 30;
            }
            if (!E.sensors[3].collided) {
                entity.ypos = E.sensors[4].ypos;
            }
            else {
                if (entity.speed > 0)
                    entity.ypos = (E.sensors[3].ypos - E.collisionBottom) << 16;

                if (entity.speed < 0)
                    entity.ypos = (E.sensors[3].ypos - E.collisionTop + 1) << 16;

                entity.speed = 0;
            }
            entity.xpos = E.sensors[4].xpos;
            break;
        }
        default: break;
    }
}

export function SetPathGripSensors(E: Engine, player: Entity): void
{
    let playerHitbox = GetHitbox(E, player);

    switch (player.collisionMode) {
        case CMODE_FLOOR: {
            E.collisionLeft   = playerHitbox.left[0];
            E.collisionTop    = playerHitbox.top[0];
            E.collisionRight  = playerHitbox.right[0];
            E.collisionBottom = playerHitbox.bottom[0];
            E.sensors[0].ypos = E.sensors[4].ypos + (E.collisionBottom << 16);
            E.sensors[1].ypos = E.sensors[0].ypos;
            E.sensors[2].ypos = E.sensors[0].ypos;
            E.sensors[3].ypos = E.sensors[4].ypos + 0x40000;
            E.sensors[5].ypos = E.sensors[0].ypos;
            E.sensors[6].ypos = E.sensors[0].ypos;

            E.sensors[0].xpos = E.sensors[4].xpos + ((playerHitbox.left[1] - 1) << 16);
            E.sensors[1].xpos = E.sensors[4].xpos;
            E.sensors[2].xpos = E.sensors[4].xpos + (playerHitbox.right[1] << 16);
            E.sensors[5].xpos = E.sensors[4].xpos + (playerHitbox.left[1] << 15);
            E.sensors[6].xpos = E.sensors[4].xpos + (playerHitbox.right[1] << 15);
            if (player.speed > 0) {
                E.sensors[3].xpos = E.sensors[4].xpos + ((E.collisionRight + 1) << 16);
            }
            else {
                E.sensors[3].xpos = E.sensors[4].xpos + ((E.collisionLeft - 1) << 16);
            }
            return;
        }
        case CMODE_LWALL: {
            E.collisionLeft   = playerHitbox.left[2];
            E.collisionTop    = playerHitbox.top[2];
            E.collisionRight  = playerHitbox.right[2];
            E.collisionBottom = playerHitbox.bottom[2];
            E.sensors[0].xpos = E.sensors[4].xpos + (E.collisionRight << 16);
            E.sensors[1].xpos = E.sensors[0].xpos;
            E.sensors[2].xpos = E.sensors[0].xpos;
            E.sensors[3].xpos = E.sensors[4].xpos + 0x40000;
            E.sensors[0].ypos = E.sensors[4].ypos + ((playerHitbox.top[3] - 1) << 16);
            E.sensors[1].ypos = E.sensors[4].ypos;
            E.sensors[2].ypos = E.sensors[4].ypos + (playerHitbox.bottom[3] << 16);
            if (player.speed > 0) {
                E.sensors[3].ypos = E.sensors[4].ypos + (E.collisionTop << 16);
            }
            else {
                E.sensors[3].ypos = E.sensors[4].ypos + ((E.collisionBottom - 1) << 16);
            }
            return;
        }
        case CMODE_ROOF: {
            E.collisionLeft   = playerHitbox.left[4];
            E.collisionTop    = playerHitbox.top[4];
            E.collisionRight  = playerHitbox.right[4];
            E.collisionBottom = playerHitbox.bottom[4];
            E.sensors[0].ypos = E.sensors[4].ypos + ((E.collisionTop - 1) << 16);
            E.sensors[1].ypos = E.sensors[0].ypos;
            E.sensors[2].ypos = E.sensors[0].ypos;
            E.sensors[3].ypos = E.sensors[4].ypos - 0x40000;
            E.sensors[0].xpos = E.sensors[4].xpos + ((playerHitbox.left[5] - 1) << 16);
            E.sensors[1].xpos = E.sensors[4].xpos;
            E.sensors[2].xpos = E.sensors[4].xpos + (playerHitbox.right[5] << 16);
            if (player.speed < 0) {
                E.sensors[3].xpos = E.sensors[4].xpos + ((E.collisionRight + 1) << 16);
            }
            else {
                E.sensors[3].xpos = E.sensors[4].xpos + ((E.collisionLeft - 1) << 16);
            }
            return;
        }
        case CMODE_RWALL: {
            E.collisionLeft   = playerHitbox.left[6];
            E.collisionTop    = playerHitbox.top[6];
            E.collisionRight  = playerHitbox.right[6];
            E.collisionBottom = playerHitbox.bottom[6];
            E.sensors[0].xpos = E.sensors[4].xpos + ((E.collisionLeft - 1) << 16);
            E.sensors[1].xpos = E.sensors[0].xpos;
            E.sensors[2].xpos = E.sensors[0].xpos;
            E.sensors[3].xpos = E.sensors[4].xpos - 0x40000;
            E.sensors[0].ypos = E.sensors[4].ypos + ((playerHitbox.top[7] - 1) << 16);
            E.sensors[1].ypos = E.sensors[4].ypos;
            E.sensors[2].ypos = E.sensors[4].ypos + (playerHitbox.bottom[7] << 16);
            if (player.speed > 0) {
                E.sensors[3].ypos = E.sensors[4].ypos + (E.collisionBottom << 16);
            }
            else {
                E.sensors[3].ypos = E.sensors[4].ypos + ((E.collisionTop - 1) << 16);
            }
            return;
        }
        default: return;
    }
}

export function ProcessTileCollisions(E: Engine, player: Entity): void
{
    player.floorSensors[0] = 0;
    player.floorSensors[1] = 0;
    player.floorSensors[2] = 0;
    player.floorSensors[3] = 0;
    player.floorSensors[4] = 0;
    E.scriptEng.checkResult = 0;

    E.collisionTolerance = 15;
    if (player.speed < 0x60000)
        E.collisionTolerance = (((player.angle) << 24) >> 24) == 0 ? 8 : 15;

    if (player.gravity == 1)
        ProcessAirCollision(E, player);
    else
        ProcessPathGrip(E, player);
}

export function ObjectFloorCollision(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let c = 0;
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7) {
        let chunkX = XPos >> 7;
        let tileX = (XPos & 0x7F) >> 4;
        let chunkY = YPos >> 7;
        let tileY = (YPos & 0x7F) >> 4;
        let chunk = (E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6) + tileX + (tileY << 3);
        let tileIndex = E.tiles128x128.tileIndex[chunk];
        if (E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_LRB && E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_NONE) {
            switch (E.tiles128x128.direction[chunk]) {
                case 0: {
                    c = (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) <= E.collisionMasks[cPath].floorMasks[c]) {
                        break;
                    }
                    YPos                  = E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 1: {
                    c = 15 - (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) <= E.collisionMasks[cPath].floorMasks[c]) {
                        break;
                    }
                    YPos                  = E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 2: {
                    c = (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) <= 15 - E.collisionMasks[cPath].roofMasks[c]) {
                        break;
                    }
                    YPos                  = 15 - E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 3: {
                    c = 15 - (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) <= 15 - E.collisionMasks[cPath].roofMasks[c]) {
                        break;
                    }
                    YPos                  = 15 - E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
            }
        }
        if (E.scriptEng.checkResult) {
            entity.ypos = (YPos - yOffset) << 16;
        }
    }
}
export function ObjectLWallCollision(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7) {
        let chunkX = XPos >> 7;
        let tileX = (XPos & 0x7F) >> 4;
        let chunkY = YPos >> 7;
        let tileY = (YPos & 0x7F) >> 4;
        let chunk = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
        chunk         = chunk + tileX + (tileY << 3);
        let tileIndex = E.tiles128x128.tileIndex[chunk];
        if (E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_TOP && E.tiles128x128.collisionFlags[cPath][chunk] < SOLID_NONE) {
            switch (E.tiles128x128.direction[chunk]) {
                case 0: {
                    c = (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) <= E.collisionMasks[cPath].lWallMasks[c]) {
                        break;
                    }
                    XPos                  = E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 1: {
                    c = (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) <= 15 - E.collisionMasks[cPath].rWallMasks[c]) {
                        break;
                    }
                    XPos                  = 15 - E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 2: {
                    c = 15 - (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) <= E.collisionMasks[cPath].lWallMasks[c]) {
                        break;
                    }
                    XPos                  = E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 3: {
                    c = 15 - (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) <= 15 - E.collisionMasks[cPath].rWallMasks[c]) {
                        break;
                    }
                    XPos                  = 15 - E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
            }
        }
        if (E.scriptEng.checkResult) {
            entity.xpos = (XPos - xOffset) << 16;
        }
    }
}
export function ObjectRoofCollision(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7) {
        let chunkX = XPos >> 7;
        let tileX = (XPos & 0x7F) >> 4;
        let chunkY = YPos >> 7;
        let tileY = (YPos & 0x7F) >> 4;
        let chunk = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
        chunk         = chunk + tileX + (tileY << 3);
        let tileIndex = E.tiles128x128.tileIndex[chunk];
        if (E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_TOP && E.tiles128x128.collisionFlags[cPath][chunk] < SOLID_NONE) {
            switch (E.tiles128x128.direction[chunk]) {
                case 0: {
                    c = (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) >= E.collisionMasks[cPath].roofMasks[c]) {
                        break;
                    }
                    YPos                  = E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 1: {
                    c = 15 - (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) >= E.collisionMasks[cPath].roofMasks[c]) {
                        break;
                    }
                    YPos                  = E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 2: {
                    c = (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) >= 15 - E.collisionMasks[cPath].floorMasks[c]) {
                        break;
                    }
                    YPos                  = 15 - E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 3: {
                    c = 15 - (XPos & 15) + (tileIndex << 4);
                    if ((YPos & 15) >= 15 - E.collisionMasks[cPath].floorMasks[c]) {
                        break;
                    }
                    YPos                  = 15 - E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
            }
        }
        if (E.scriptEng.checkResult) {
            entity.ypos = (YPos - yOffset) << 16;
        }
    }
}
export function ObjectRWallCollision(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7) {
        let chunkX = XPos >> 7;
        let tileX = (XPos & 0x7F) >> 4;
        let chunkY = YPos >> 7;
        let tileY = (YPos & 0x7F) >> 4;
        let chunk = E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6;
        chunk         = chunk + tileX + (tileY << 3);
        let tileIndex = E.tiles128x128.tileIndex[chunk];
        if (E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_TOP && E.tiles128x128.collisionFlags[cPath][chunk] < SOLID_NONE) {
            switch (E.tiles128x128.direction[chunk]) {
                case 0: {
                    c = (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) >= E.collisionMasks[cPath].rWallMasks[c]) {
                        break;
                    }
                    XPos                  = E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 1: {
                    c = (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) >= 15 - E.collisionMasks[cPath].lWallMasks[c]) {
                        break;
                    }
                    XPos                  = 15 - E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 2: {
                    c = 15 - (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) >= E.collisionMasks[cPath].rWallMasks[c]) {
                        break;
                    }
                    XPos                  = E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
                case 3: {
                    c = 15 - (YPos & 15) + (tileIndex << 4);
                    if ((XPos & 15) >= 15 - E.collisionMasks[cPath].lWallMasks[c]) {
                        break;
                    }
                    XPos                  = 15 - E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                    E.scriptEng.checkResult = 1;
                    break;
                }
            }
        }
        if (E.scriptEng.checkResult) {
            entity.xpos = (XPos - xOffset) << 16;
        }
    }
}

export function ObjectFloorGrip(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    let chunkX = YPos;
    YPos                  = YPos - 16;
    for (let i = 3; i > 0; i--) {
        if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7 && !E.scriptEng.checkResult) {
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            let chunk = (E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6) + tileX + (tileY << 3);
            let tileIndex = E.tiles128x128.tileIndex[chunk];
            if (E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_LRB && E.tiles128x128.collisionFlags[cPath][chunk] != SOLID_NONE) {
                switch (E.tiles128x128.direction[chunk]) {
                    case 0: {
                        c = (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].floorMasks[c] >= 64) {
                            break;
                        }
                        entity.ypos          = E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 1: {
                        c = 15 - (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].floorMasks[c] >= 64) {
                            break;
                        }
                        entity.ypos          = E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 2: {
                        c = (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].roofMasks[c] <= -64) {
                            break;
                        }
                        entity.ypos          = 15 - E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 3: {
                        c = 15 - (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].roofMasks[c] <= -64) {
                            break;
                        }
                        entity.ypos          = 15 - E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                }
            }
        }
        YPos += 16;
    }

    if (E.scriptEng.checkResult) {
        if (Math.abs(entity.ypos - chunkX) < 16) {
            entity.ypos = (entity.ypos - yOffset) << 16;
            return;
        }
        entity.ypos          = (chunkX - yOffset) << 16;
        E.scriptEng.checkResult = 0;
    }
}
export function ObjectLWallGrip(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    let startX = XPos;
    XPos                  = XPos - 16;
    for (let i = 3; i > 0; i--) {
        if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7 && !E.scriptEng.checkResult) {
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            let chunk = (E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6) + tileX + (tileY << 3);
            let tileIndex = E.tiles128x128.tileIndex[chunk];
            if (E.tiles128x128.collisionFlags[cPath][chunk] < SOLID_NONE) {
                switch (E.tiles128x128.direction[chunk]) {
                    case 0: {
                        c = (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].lWallMasks[c] >= 64) {
                            break;
                        }
                        entity.xpos          = E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 1: {
                        c = (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].rWallMasks[c] <= -64) {
                            break;
                        }
                        entity.xpos          = 15 - E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 2: {
                        c = 15 - (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].lWallMasks[c] >= 64) {
                            break;
                        }
                        entity.xpos          = E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 3: {
                        c = 15 - (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].rWallMasks[c] <= -64) {
                            break;
                        }
                        entity.xpos          = 15 - E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                }
            }
        }
        XPos += 16;
    }
    if (E.scriptEng.checkResult) {
        if (Math.abs(entity.xpos - startX) < 16) {
            entity.xpos = (entity.xpos - xOffset) << 16;
            return;
        }
        entity.xpos          = (startX - xOffset) << 16;
        E.scriptEng.checkResult = 0;
    }
}
export function ObjectRoofGrip(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    let startY = YPos;
    YPos                  = YPos + 16;
    for (let i = 3; i > 0; i--) {
        if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7 && !E.scriptEng.checkResult) {
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            let chunk = (E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6) + tileX + (tileY << 3);
            let tileIndex = E.tiles128x128.tileIndex[chunk];
            if (E.tiles128x128.collisionFlags[cPath][chunk] < SOLID_NONE) {
                switch (E.tiles128x128.direction[chunk]) {
                    case 0: {
                        c = (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].roofMasks[c] <= -64) {
                            break;
                        }
                        entity.ypos          = E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 1: {
                        c = 15 - (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].roofMasks[c] <= -64) {
                            break;
                        }
                        entity.ypos          = E.collisionMasks[cPath].roofMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 2: {
                        c = (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].floorMasks[c] >= 64) {
                            break;
                        }
                        entity.ypos          = 15 - E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 3: {
                        c = 15 - (XPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].floorMasks[c] >= 64) {
                            break;
                        }
                        entity.ypos          = 15 - E.collisionMasks[cPath].floorMasks[c] + (chunkY << 7) + (tileY << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                }
            }
        }
        YPos -= 16;
    }
    if (E.scriptEng.checkResult) {
        if (Math.abs(entity.ypos - startY) < 16) {
            entity.ypos = (entity.ypos - yOffset) << 16;
            return;
        }
        entity.ypos          = (startY - yOffset) << 16;
        E.scriptEng.checkResult = 0;
    }
}
export function ObjectRWallGrip(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    let c = 0;
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let XPos = (entity.xpos >> 16) + xOffset;
    let YPos = (entity.ypos >> 16) + yOffset;
    let startX = XPos;
    XPos                  = XPos + 16;
    for (let i = 3; i > 0; i--) {
        if (XPos > 0 && XPos < E.stageLayouts[0].xsize << 7 && YPos > 0 && YPos < E.stageLayouts[0].ysize << 7 && !E.scriptEng.checkResult) {
            let chunkX = XPos >> 7;
            let tileX = (XPos & 0x7F) >> 4;
            let chunkY = YPos >> 7;
            let tileY = (YPos & 0x7F) >> 4;
            let chunk = (E.stageLayouts[0].tiles[chunkX + (chunkY << 8)] << 6) + tileX + (tileY << 3);
            let tileIndex = E.tiles128x128.tileIndex[chunk];
            if (E.tiles128x128.collisionFlags[cPath][chunk] < SOLID_NONE) {
                switch (E.tiles128x128.direction[chunk]) {
                    case 0: {
                        c = (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].rWallMasks[c] <= -64) {
                            break;
                        }
                        entity.xpos          = E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 1: {
                        c = (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].lWallMasks[c] >= 64) {
                            break;
                        }
                        entity.xpos          = 15 - E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 2: {
                        c = 15 - (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].rWallMasks[c] <= -64) {
                            break;
                        }
                        entity.xpos          = E.collisionMasks[cPath].rWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                    case 3: {
                        c = 15 - (YPos & 15) + (tileIndex << 4);
                        if (E.collisionMasks[cPath].lWallMasks[c] >= 64) {
                            break;
                        }
                        entity.xpos          = 15 - E.collisionMasks[cPath].lWallMasks[c] + (chunkX << 7) + (tileX << 4);
                        E.scriptEng.checkResult = 1;
                        break;
                    }
                }
            }
        }
        XPos -= 16;
    }
    if (E.scriptEng.checkResult) {
        if (Math.abs(entity.xpos - startX) < 16) {
            entity.xpos = (entity.xpos - xOffset) << 16;
            return;
        }
        entity.xpos          = (startX - xOffset) << 16;
        E.scriptEng.checkResult = 0;
    }
}
export function ObjectLEntityGrip(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let mBlockID = entity.values[44];
    let XPos = (entity.xpos >> 16) + xOffset - 16;
    let YPos = (entity.ypos >> 16) + yOffset;
    let check = 0;
    if (mBlockID > 0 && E.objectTypeGroupList[mBlockID].listSize > 0) {
        const mBlockGroupList = E.objectTypeGroupList[mBlockID];
        for (let i = 0; i < E.objectTypeGroupList[mBlockID].listSize; i++) {
            let entRef = mBlockGroupList.entityRefs[i];
            let otherEntity = E.objectEntityList[entRef];
            let XPos2 = otherEntity.xpos >> 16;
            let YPos2 = otherEntity.ypos >> 16;
            if (((((XPos2 - 16) <= XPos) && (XPos <= (XPos2 + 16))) && ((YPos2 - 16) <= YPos)) && (YPos <= (YPos2 + 16))) {
                entity.xpos = otherEntity.xpos - (xOffset << 16) - 0x100000;
                if (otherEntity.values[0] == 0) {
                    check                 = 2;
                    E.scriptEng.checkResult = check;
                }
                else {
                    E.scriptEng.checkResult = check;
                    if (check != 2) {
                        check                 = 1;
                        E.scriptEng.checkResult = check;
                    }
                }
            }
            if ((((XPos2 - 16) <= (XPos + 16) && ((XPos + 16) <= (XPos2 + 16))) && (YPos2 - 16) <= YPos) && (YPos <= (YPos2 + 16))) {
                entity.xpos = otherEntity.xpos - (xOffset << 16) - 0x100000;
                if (otherEntity.values[0] == 0) {
                    check                 = 2;
                    E.scriptEng.checkResult = check;
                }
                else {
                    E.scriptEng.checkResult = check;
                    if (check != 2) {
                        E.scriptEng.checkResult = check;
                    }
                }
            }

            if (((XPos2 <= (XPos + 32)) && ((XPos + 32) <= (XPos2 + 16))) && (((YPos2 - 16) <= YPos && YPos <= (YPos2 + 16)))) {
                entity.xpos = otherEntity.xpos - (xOffset << 16) - 0x100000;
                if (otherEntity.values[0] == 0) {
                    check                 = 2;
                    E.scriptEng.checkResult = check;
                }
                else {
                    E.scriptEng.checkResult = check;
                    if (check != 2) {
                        check                 = 1;
                        E.scriptEng.checkResult = check;
                    }
                }
            }

            if (check != 0) {
                return;
            }
        }
    }
    ObjectLWallGrip(E, xOffset, yOffset, cPath);
}
export function ObjectREntityGrip(E: Engine, xOffset: number, yOffset: number, cPath: number): void
{
    E.scriptEng.checkResult = 0;
    let entity = E.objectEntityList[E.objectEntityPos];
    let mBlockID = entity.values[44];
    let XPos = (entity.xpos >> 16) + xOffset + 16;
    let YPos = (entity.ypos >> 16) + yOffset;
    let check = 0;
    if (mBlockID > 0 && E.objectTypeGroupList[mBlockID].listSize > 0) {
        const mBlockGroupList = E.objectTypeGroupList[mBlockID];
        for (let i = 0; i < E.objectTypeGroupList[mBlockID].listSize; i++) {
            let entRef = mBlockGroupList.entityRefs[i];
            let otherEntity = E.objectEntityList[entRef];
            let XPos2 = otherEntity.xpos >> 16;
            let YPos2 = otherEntity.ypos >> 16;
            if (((((XPos2 - 16) <= XPos) && (XPos <= (XPos2 + 16))) && ((YPos2 - 16) <= YPos)) && (YPos <= (YPos2 + 16))) {
                entity.xpos = otherEntity.xpos + ((16 - xOffset) << 16);
                if (otherEntity.values[0] == 0) {
                    check                 = 2;
                    E.scriptEng.checkResult = check;
                }
                else {
                    E.scriptEng.checkResult = check;
                    if (check != 2) {
                        check                 = 1;
                        E.scriptEng.checkResult = check;
                    }
                }
            }
            if ((((XPos2 - 16) <= (XPos + 16) && ((XPos - 16) <= (XPos2 + 16))) && (YPos2 - 16) <= YPos) && (YPos <= (YPos2 + 16))) {
                entity.xpos = otherEntity.xpos + ((16 - xOffset) << 16);
                if (otherEntity.values[0] == 0) {
                    check                 = 2;
                    E.scriptEng.checkResult = check;
                }
                else {
                    E.scriptEng.checkResult = check;
                    if (check != 2) {
                        E.scriptEng.checkResult = check;
                    }
                }
            }

            if (((XPos2 <= (XPos - 32)) && ((XPos - 32) <= (XPos2 + 16))) && (((YPos2 - 16) <= YPos && YPos <= (YPos2 + 16)))) {
                entity.xpos = otherEntity.xpos + ((16 - xOffset) << 16);
                if (otherEntity.values[0] == 0) {
                    check                 = 2;
                    E.scriptEng.checkResult = check;
                }
                else {
                    E.scriptEng.checkResult = check;
                    if (check != 2) {
                        check                 = 1;
                        E.scriptEng.checkResult = check;
                    }
                }
            }

            if (check != 0) {
                return;
            }
        }
    }
    ObjectRWallGrip(E, xOffset, yOffset, cPath);
}
export function TouchCollision(E: Engine, thisEntity: Entity, thisLeft: number, thisTop: number, thisRight: number, thisBottom: number, otherEntity: Entity, otherLeft: number, otherTop: number, otherRight: number, otherBottom: number): void
{
    let thisHitbox = GetHitbox(E, thisEntity);
    let otherHitbox = GetHitbox(E, otherEntity);

    if (thisLeft == C_BOX)
        thisLeft = thisHitbox.left[0];

    if (thisTop == C_BOX)
        thisTop = thisHitbox.top[0];

    if (thisRight == C_BOX)
        thisRight = thisHitbox.right[0];

    if (thisBottom == C_BOX)
        thisBottom = thisHitbox.bottom[0];

    if (otherLeft == C_BOX)
        otherLeft = otherHitbox.left[0];

    if (otherTop == C_BOX)
        otherTop = otherHitbox.top[0];

    if (otherRight == C_BOX)
        otherRight = otherHitbox.right[0];

    if (otherBottom == C_BOX)
        otherBottom = otherHitbox.bottom[0];

    let thisHitboxID = 0;
    let otherHitboxID = 0;
    if (E.showHitboxes) {
        thisHitboxID  = AddDebugHitbox(E, H_TYPE_TOUCH, thisEntity, thisLeft, thisTop, thisRight, thisBottom);
        otherHitboxID = AddDebugHitbox(E, H_TYPE_TOUCH, otherEntity, otherLeft, otherTop, otherRight, otherBottom);
    }

    thisLeft += thisEntity.xpos >> 16;
    thisTop += thisEntity.ypos >> 16;
    thisRight += thisEntity.xpos >> 16;
    thisBottom += thisEntity.ypos >> 16;

    otherLeft += otherEntity.xpos >> 16;
    otherTop += otherEntity.ypos >> 16;
    otherRight += otherEntity.xpos >> 16;
    otherBottom += otherEntity.ypos >> 16;

    E.scriptEng.checkResult = otherRight > thisLeft && otherLeft < thisRight && otherBottom > thisTop && otherTop < thisBottom;

    if (E.showHitboxes) {
        if (thisHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[thisHitboxID].collision |= 1;
        if (otherHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[otherHitboxID].collision |= 1;
    }
}
export function BoxCollision(E: Engine, thisEntity: Entity, thisLeft: number, thisTop: number, thisRight: number, thisBottom: number, otherEntity: Entity, otherLeft: number, otherTop: number, otherRight: number, otherBottom: number): void
{
    let thisHitbox = GetHitbox(E, thisEntity);
    let otherHitbox = GetHitbox(E, otherEntity);

    if (thisLeft == C_BOX)
        thisLeft = thisHitbox.left[0];

    if (thisTop == C_BOX)
        thisTop = thisHitbox.top[0];

    if (thisRight == C_BOX)
        thisRight = thisHitbox.right[0];

    if (thisBottom == C_BOX)
        thisBottom = thisHitbox.bottom[0];

    if (otherLeft == C_BOX)
        otherLeft = otherHitbox.left[0];

    if (otherTop == C_BOX)
        otherTop = otherHitbox.top[0];

    if (otherRight == C_BOX)
        otherRight = otherHitbox.right[0];

    if (otherBottom == C_BOX)
        otherBottom = otherHitbox.bottom[0];

    let thisHitboxID = 0;
    let otherHitboxID = 0;
    if (E.showHitboxes) {
        thisHitboxID  = AddDebugHitbox(E, H_TYPE_BOX, thisEntity, thisLeft, thisTop, thisRight, thisBottom);
        otherHitboxID = AddDebugHitbox(E, H_TYPE_BOX, otherEntity, otherLeft, otherTop, otherRight, otherBottom);
    }

    thisLeft += thisEntity.xpos >> 16;
    thisTop += thisEntity.ypos >> 16;
    thisRight += thisEntity.xpos >> 16;
    thisBottom += thisEntity.ypos >> 16;

    thisLeft <<= 16;
    thisTop <<= 16;
    thisRight <<= 16;
    thisBottom <<= 16;

    otherLeft <<= 16;
    otherTop <<= 16;
    otherRight <<= 16;
    otherBottom <<= 16;

    E.scriptEng.checkResult = 0;

    let rx = otherEntity.xpos >> 16 << 16;
    let ry = otherEntity.ypos >> 16 << 16;

    let xDif = otherEntity.xpos - thisRight;
    if (thisEntity.xpos > otherEntity.xpos)
        xDif = thisLeft - otherEntity.xpos;
    let yDif = thisTop - otherEntity.ypos;
    if (thisEntity.ypos <= otherEntity.ypos)
        yDif = otherEntity.ypos - thisBottom;

    if (xDif <= yDif && Math.abs(otherEntity.xvel) >> 1 <= Math.abs(otherEntity.yvel)) {
        E.sensors[0].collided = 0;
        E.sensors[1].collided = 0;
        E.sensors[2].collided = 0;
        E.sensors[3].collided = 0;
        E.sensors[4].collided = 0;
        E.sensors[0].xpos     = rx + otherLeft + 0x20000;
        E.sensors[1].xpos     = rx;
        E.sensors[2].xpos     = rx + otherRight - 0x20000;
        E.sensors[3].xpos     = (E.sensors[0].xpos + rx) >> 1;
        E.sensors[4].xpos     = (E.sensors[2].xpos + rx) >> 1;

        E.sensors[0].ypos = ry + otherBottom;

        if (otherEntity.yvel >= 0) {
            for (let i = 0; i < 5; ++i) {
                if (thisLeft < E.sensors[i].xpos && thisRight > E.sensors[i].xpos && thisTop <= E.sensors[0].ypos
                    && thisTop > otherEntity.ypos - otherEntity.yvel) {
                    E.sensors[i].collided          = 1;
                    otherEntity.floorSensors[i] = 1;
                }
            }
        }

        if (E.sensors[0].collided || E.sensors[1].collided || E.sensors[2].collided) {
            if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
                otherEntity.xvel  = 0;
                otherEntity.speed = 0;
            }
            otherEntity.ypos        = thisTop - otherBottom;
            otherEntity.gravity     = 0;
            otherEntity.yvel        = 0;
            otherEntity.angle       = 0;
            otherEntity.rotation    = 0;
            otherEntity.controlLock = 0;
            E.scriptEng.checkResult    = 1;
        }
        else {
            E.sensors[0].collided = 0;
            E.sensors[1].collided = 0;
            E.sensors[0].xpos     = rx + otherLeft + 0x20000;
            E.sensors[1].xpos     = rx + otherRight - 0x20000;

            E.sensors[0].ypos = ry + otherTop;

            for (let i = 0; i < 2; ++i) {
                if (thisLeft < E.sensors[1].xpos && thisRight > E.sensors[0].xpos && thisBottom > E.sensors[0].ypos
                    && thisBottom < otherEntity.ypos - otherEntity.yvel) {
                    E.sensors[i].collided = 1;
                }
            }

            if (E.sensors[1].collided || E.sensors[0].collided) {
                if (otherEntity.gravity == 1)
                    otherEntity.ypos = thisBottom - otherTop;

                if (otherEntity.yvel <= 0)
                    otherEntity.yvel = 0;
                E.scriptEng.checkResult = 4;
            }
            else {
                E.sensors[0].collided = 0;
                E.sensors[1].collided = 0;
                E.sensors[0].xpos     = rx + otherRight;

                E.sensors[0].ypos = ry + otherTop + 0x20000;
                E.sensors[1].ypos = ry + otherBottom - 0x20000;
                for (let i = 0; i < 2; ++i) {
                    if (thisLeft <= E.sensors[0].xpos && thisLeft > otherEntity.xpos - otherEntity.xvel && thisTop < E.sensors[1].ypos
                        && thisBottom > E.sensors[0].ypos) {
                        E.sensors[i].collided = 1;
                    }
                }

                if (E.sensors[1].collided || E.sensors[0].collided) {
                    otherEntity.xpos = thisLeft - otherRight;
                    if (otherEntity.xvel > 0) {
                        if (!otherEntity.direction)
                            otherEntity.pushing = 2;

                        otherEntity.xvel = 0;
                        if (otherEntity.collisionMode || !otherEntity.left)
                            otherEntity.speed = 0;
                        else
                            otherEntity.speed = -0x8000;
                    }
                    E.scriptEng.checkResult = 2;
                }
                else {
                    E.sensors[0].collided = 0;
                    E.sensors[1].collided = 0;
                    E.sensors[0].xpos     = rx + otherLeft;

                    E.sensors[0].ypos = ry + otherTop + 0x20000;
                    E.sensors[1].ypos = ry + otherBottom - 0x20000;
                    for (let i = 0; i < 2; ++i) {
                        if (thisRight > E.sensors[0].xpos && thisRight < otherEntity.xpos - otherEntity.xvel && thisTop < E.sensors[1].ypos
                            && thisBottom > E.sensors[0].ypos) {
                            E.sensors[i].collided = 1;
                        }
                    }

                    if (E.sensors[1].collided || E.sensors[0].collided) {
                        otherEntity.xpos = thisRight - otherLeft;
                        if (otherEntity.xvel < 0) {
                            if (otherEntity.direction == FLIP_X)
                                otherEntity.pushing = 2;

                            if (otherEntity.xvel < -0x10000)
                                otherEntity.xpos += 0x8000;

                            otherEntity.xvel = 0;
                            if (otherEntity.collisionMode || !otherEntity.right)
                                otherEntity.speed = 0;
                            else
                                otherEntity.speed = 0x8000;
                        }
                        E.scriptEng.checkResult = 3;
                    }
                }
            }
        }
    }
    else {
        E.sensors[0].collided = 0;
        E.sensors[1].collided = 0;
        E.sensors[0].xpos     = rx + otherRight;

        E.sensors[0].ypos = ry + otherTop + 0x20000;
        E.sensors[1].ypos = ry + otherBottom - 0x20000;
        for (let i = 0; i < 2; ++i) {
            if (thisLeft <= E.sensors[0].xpos && thisLeft > otherEntity.xpos - otherEntity.xvel && thisTop < E.sensors[1].ypos
                && thisBottom > E.sensors[0].ypos) {
                E.sensors[i].collided = 1;
            }
        }
        if (E.sensors[1].collided || E.sensors[0].collided) {
            otherEntity.xpos = thisLeft - otherRight;
            if (otherEntity.xvel > 0) {
                if (!otherEntity.direction)
                    otherEntity.pushing = 2;

                otherEntity.xvel = 0;
                if (otherEntity.collisionMode || !otherEntity.left)
                    otherEntity.speed = 0;
                else
                    otherEntity.speed = -0x8000;
            }
            E.scriptEng.checkResult = 2;
        }
        else {
            E.sensors[0].collided = 0;
            E.sensors[1].collided = 0;
            E.sensors[0].xpos     = rx + otherLeft;

            E.sensors[0].ypos = ry + otherTop + 0x20000;
            E.sensors[1].ypos = ry + otherBottom - 0x20000;
            for (let i = 0; i < 2; ++i) {
                if (thisRight > E.sensors[0].xpos && thisRight < otherEntity.xpos - otherEntity.xvel && thisTop < E.sensors[1].ypos
                    && thisBottom > E.sensors[0].ypos) {
                    E.sensors[i].collided = 1;
                }
            }

            if (E.sensors[0].collided || E.sensors[1].collided) {
                otherEntity.xpos = thisRight - otherLeft;
                if (otherEntity.xvel < 0) {
                    if (otherEntity.direction == FLIP_X)
                        otherEntity.pushing = 2;

                    if (otherEntity.xvel < -0x10000)
                        otherEntity.xpos += 0x8000;

                    otherEntity.xvel = 0;
                    if (otherEntity.collisionMode || !otherEntity.right)
                        otherEntity.speed = 0;
                    else
                        otherEntity.speed = 0x8000;
                }
                E.scriptEng.checkResult = 3;
            }
            else {
                E.sensors[0].collided = 0;
                E.sensors[1].collided = 0;
                E.sensors[2].collided = 0;
                E.sensors[3].collided = 0;
                E.sensors[4].collided = 0;
                E.sensors[0].xpos     = rx + otherLeft + 0x20000;
                E.sensors[1].xpos     = rx;
                E.sensors[2].xpos     = rx + otherRight - 0x20000;
                E.sensors[3].xpos     = (E.sensors[0].xpos + rx) >> 1;
                E.sensors[4].xpos     = (E.sensors[2].xpos + rx) >> 1;

                E.sensors[0].ypos = ry + otherBottom;
                if (otherEntity.yvel >= 0) {
                    for (let i = 0; i < 5; ++i) {
                        if (thisLeft < E.sensors[i].xpos && thisRight > E.sensors[i].xpos && thisTop <= E.sensors[0].ypos
                            && thisTop > otherEntity.ypos - otherEntity.yvel) {
                            E.sensors[i].collided          = 1;
                            otherEntity.floorSensors[i] = 1;
                        }
                    }
                }
                if (E.sensors[2].collided || E.sensors[1].collided || E.sensors[0].collided) {
                    if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
                        otherEntity.xvel  = 0;
                        otherEntity.speed = 0;
                    }
                    otherEntity.ypos        = thisTop - otherBottom;
                    otherEntity.gravity     = 0;
                    otherEntity.yvel        = 0;
                    otherEntity.angle       = 0;
                    otherEntity.rotation    = 0;
                    otherEntity.controlLock = 0;
                    E.scriptEng.checkResult    = 1;
                }
                else {
                    E.sensors[0].collided = 0;
                    E.sensors[1].collided = 0;
                    E.sensors[0].xpos     = rx + otherLeft + 0x20000;
                    E.sensors[1].xpos     = rx + otherRight - 0x20000;
                    E.sensors[0].ypos     = ry + otherTop;

                    for (let i = 0; i < 2; ++i) {
                        if (thisLeft < E.sensors[1].xpos && thisRight > E.sensors[0].xpos && thisBottom > E.sensors[0].ypos
                            && thisBottom < otherEntity.ypos - otherEntity.yvel) {
                            E.sensors[i].collided = 1;
                        }
                    }

                    if (E.sensors[1].collided || E.sensors[0].collided) {
                        if (otherEntity.gravity == 1)
                            otherEntity.ypos = thisBottom - otherTop;

                        if (otherEntity.yvel <= 0)
                            otherEntity.yvel = 0;
                        E.scriptEng.checkResult = 4;
                    }
                }
            }
        }
    }

    if (E.showHitboxes) {
        if (thisHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[thisHitboxID].collision |= 1 << (E.scriptEng.checkResult - 1);
        if (otherHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[otherHitboxID].collision |= 1 << (4 - E.scriptEng.checkResult);
    }
}
export function BoxCollision2(E: Engine, thisEntity: Entity, thisLeft: number, thisTop: number, thisRight: number, thisBottom: number, otherEntity: Entity, otherLeft: number, otherTop: number, otherRight: number, otherBottom: number): void
{
    let thisHitbox = GetHitbox(E, thisEntity);
    let otherHitbox = GetHitbox(E, otherEntity);

    if (thisLeft == C_BOX)
        thisLeft = thisHitbox.left[0];

    if (thisTop == C_BOX)
        thisTop = thisHitbox.top[0];

    if (thisRight == C_BOX)
        thisRight = thisHitbox.right[0];

    if (thisBottom == C_BOX)
        thisBottom = thisHitbox.bottom[0];

    if (otherLeft == C_BOX)
        otherLeft = otherHitbox.left[0];

    if (otherTop == C_BOX)
        otherTop = otherHitbox.top[0];

    if (otherRight == C_BOX)
        otherRight = otherHitbox.right[0];

    if (otherBottom == C_BOX)
        otherBottom = otherHitbox.bottom[0];

    let thisHitboxID = 0;
    let otherHitboxID = 0;
    if (E.showHitboxes) {
        thisHitboxID  = AddDebugHitbox(E, H_TYPE_BOX, thisEntity, thisLeft, thisTop, thisRight, thisBottom);
        otherHitboxID = AddDebugHitbox(E, H_TYPE_BOX, otherEntity, otherLeft, otherTop, otherRight, otherBottom);
    }

    thisLeft += thisEntity.xpos >> 16;
    thisTop += thisEntity.ypos >> 16;
    thisRight += thisEntity.xpos >> 16;
    thisBottom += thisEntity.ypos >> 16;

    thisLeft <<= 16;
    thisTop <<= 16;
    thisRight <<= 16;
    thisBottom <<= 16;

    otherLeft <<= 16;
    otherTop <<= 16;
    otherRight <<= 16;
    otherBottom <<= 16;

    E.scriptEng.checkResult = 0;

    let rx = otherEntity.xpos >> 16 << 16;
    let ry = otherEntity.ypos >> 16 << 16;

    let xDif = thisLeft - rx;
    if (thisEntity.xpos <= rx)
        xDif = rx - thisRight;
    let yDif = thisTop - ry;
    if (thisEntity.ypos <= ry)
        yDif = ry - thisBottom;

    if (xDif <= yDif) {
        E.sensors[0].collided = 0;
        E.sensors[1].collided = 0;
        E.sensors[2].collided = 0;
        E.sensors[0].xpos     = rx + otherLeft + 0x20000;
        E.sensors[1].xpos     = rx;
        E.sensors[2].xpos     = rx + otherRight - 0x20000;

        E.sensors[0].ypos = ry + otherBottom;

        if (otherEntity.yvel >= 0) {
            // this should prolly be using all 5 E.sensors, but this was barely used in S2 so it was prolly forgotten about
            for (let i = 0; i < 3; ++i) {
                if (thisLeft < E.sensors[i].xpos && thisRight > E.sensors[i].xpos && thisTop <= E.sensors[0].ypos && thisEntity.ypos > E.sensors[0].ypos) {
                    E.sensors[i].collided          = 1;
                    otherEntity.floorSensors[i] = 1;
                }
            }
        }

        if (E.sensors[0].collided || E.sensors[1].collided || E.sensors[2].collided) {
            if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
                otherEntity.xvel  = 0;
                otherEntity.speed = 0;
            }
            otherEntity.ypos        = thisTop - otherBottom;
            otherEntity.gravity     = 0;
            otherEntity.yvel        = 0;
            otherEntity.angle       = 0;
            otherEntity.rotation    = 0;
            otherEntity.controlLock = 0;
            E.scriptEng.checkResult    = 1;
        }
        else {
            E.sensors[0].collided = 0;
            E.sensors[1].collided = 0;
            E.sensors[0].xpos     = rx + otherLeft + 0x20000;
            E.sensors[1].xpos     = rx + otherRight - 0x20000;

            E.sensors[0].ypos = ry + otherTop;

            for (let i = 0; i < 2; ++i) {
                if (thisLeft < E.sensors[1].xpos && thisRight > E.sensors[0].xpos && thisBottom > E.sensors[0].ypos && thisEntity.ypos < E.sensors[0].ypos) {
                    E.sensors[i].collided = 1;
                }
            }

            if (E.sensors[1].collided || E.sensors[0].collided) {
                if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
                    otherEntity.xvel  = 0;
                    otherEntity.speed = 0;
                }

                otherEntity.ypos = thisBottom - otherTop;
                if (otherEntity.yvel < 0)
                    otherEntity.yvel = 0;
                E.scriptEng.checkResult = 4;
            }
            else {
                E.sensors[0].collided = 0;
                E.sensors[1].collided = 0;
                E.sensors[0].xpos     = rx + otherRight;

                E.sensors[0].ypos = ry + otherTop + 0x20000;
                E.sensors[1].ypos = ry + otherBottom - 0x20000;
                for (let i = 0; i < 2; ++i) {
                    if (thisLeft <= E.sensors[0].xpos && thisEntity.xpos > E.sensors[0].xpos && thisTop < E.sensors[1].ypos
                        && thisBottom > E.sensors[0].ypos) {
                        E.sensors[i].collided = 1;
                    }
                }

                if (E.sensors[1].collided || E.sensors[0].collided) {
                    otherEntity.xpos = thisLeft - otherRight;
                    if (otherEntity.xvel > 0) {
                        if (!otherEntity.direction)
                            otherEntity.pushing = 2;

                        otherEntity.xvel  = 0;
                        otherEntity.speed = 0;
                    }
                    E.scriptEng.checkResult = 2;
                }
                else {
                    E.sensors[0].collided = 0;
                    E.sensors[1].collided = 0;
                    E.sensors[0].xpos     = rx + otherLeft;

                    E.sensors[0].ypos = ry + otherTop + 0x20000;
                    E.sensors[1].ypos = ry + otherBottom - 0x20000;
                    for (let i = 0; i < 2; ++i) {
                        if (thisRight > E.sensors[0].xpos && thisEntity.xpos < E.sensors[0].xpos && thisTop < E.sensors[1].ypos
                            && thisBottom > E.sensors[0].ypos) {
                            E.sensors[i].collided = 1;
                        }
                    }

                    if (E.sensors[1].collided || E.sensors[0].collided) {
                        otherEntity.xpos = thisRight - otherLeft;
                        if (otherEntity.xvel < 0) {
                            if (otherEntity.direction == FLIP_X)
                                otherEntity.pushing = 2;

                            if (otherEntity.xvel < -0x10000)
                                otherEntity.xpos += 0x8000;

                            otherEntity.xvel  = 0;
                            otherEntity.speed = 0;
                        }
                        E.scriptEng.checkResult = 3;
                    }
                }
            }
        }
    }
    else {
        E.sensors[0].collided = 0;
        E.sensors[1].collided = 0;
        E.sensors[0].xpos     = rx + otherRight;

        E.sensors[0].ypos = ry + otherTop + 0x20000;
        E.sensors[1].ypos = ry + otherBottom - 0x20000;
        for (let i = 0; i < 2; ++i) {
            if (thisLeft <= E.sensors[0].xpos && thisEntity.xpos > E.sensors[0].xpos && thisTop < E.sensors[1].ypos && thisBottom > E.sensors[0].ypos) {
                E.sensors[i].collided = 1;
            }
        }
        if (E.sensors[1].collided || E.sensors[0].collided) {
            otherEntity.xpos = thisLeft - otherRight;
            if (otherEntity.xvel > 0) {
                if (!otherEntity.direction)
                    otherEntity.pushing = 2;

                otherEntity.xvel  = 0;
                otherEntity.speed = 0;
            }
            E.scriptEng.checkResult = 2;
        }
        else {
            E.sensors[0].collided = 0;
            E.sensors[1].collided = 0;
            E.sensors[0].xpos     = rx + otherLeft;

            E.sensors[0].ypos = ry + otherTop + 0x20000;
            E.sensors[1].ypos = ry + otherBottom - 0x20000;
            for (let i = 0; i < 2; ++i) {
                if (thisRight > E.sensors[0].xpos && thisEntity.xpos < E.sensors[0].xpos && thisTop < E.sensors[1].ypos && thisBottom > E.sensors[0].ypos) {
                    E.sensors[i].collided = 1;
                }
            }

            if (E.sensors[0].collided || E.sensors[1].collided) {
                otherEntity.xpos = thisRight - otherLeft;
                if (otherEntity.xvel < 0) {
                    if (otherEntity.direction == FLIP_X)
                        otherEntity.pushing = 2;

                    if (otherEntity.xvel < -0x10000)
                        otherEntity.xpos += 0x8000;

                    otherEntity.xvel  = 0;
                    otherEntity.speed = 0;
                }
                E.scriptEng.checkResult = 3;
            }
            else {
                E.sensors[0].collided = 0;
                E.sensors[1].collided = 0;
                E.sensors[2].collided = 0;
                E.sensors[0].xpos     = rx + otherLeft + 0x20000;
                E.sensors[1].xpos     = rx;
                E.sensors[2].xpos     = rx + otherRight - 0x20000;

                E.sensors[0].ypos = ry + otherBottom;
                if (otherEntity.yvel >= 0) {
                    for (let i = 0; i < 3; ++i) {
                        if (thisLeft < E.sensors[i].xpos && thisRight > E.sensors[i].xpos && thisTop <= E.sensors[0].ypos
                            && thisEntity.ypos > E.sensors[0].ypos) {
                            E.sensors[i].collided          = 1;
                            otherEntity.floorSensors[i] = 1;
                        }
                    }
                }

                if (E.sensors[0].collided || E.sensors[1].collided || E.sensors[2].collided) {
                    if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
                        otherEntity.xvel  = 0;
                        otherEntity.speed = 0;
                    }
                    otherEntity.ypos        = thisTop - otherBottom;
                    otherEntity.gravity     = 0;
                    otherEntity.yvel        = 0;
                    otherEntity.angle       = 0;
                    otherEntity.rotation    = 0;
                    otherEntity.controlLock = 0;
                    E.scriptEng.checkResult    = 1;
                }
                else {
                    E.sensors[0].collided = 0;
                    E.sensors[1].collided = 0;
                    E.sensors[0].xpos     = rx + otherLeft + 0x20000;
                    E.sensors[1].xpos     = rx + otherRight - 0x20000;

                    E.sensors[0].ypos = ry + otherTop;

                    for (let i = 0; i < 2; ++i) {
                        if (thisLeft < E.sensors[1].xpos && thisRight > E.sensors[0].xpos && thisBottom > E.sensors[0].ypos
                            && thisEntity.ypos < E.sensors[0].ypos) {
                            E.sensors[i].collided = 1;
                        }
                    }

                    if (E.sensors[1].collided || E.sensors[0].collided) {
                        if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
                            otherEntity.xvel  = 0;
                            otherEntity.speed = 0;
                        }

                        otherEntity.ypos = thisBottom - otherTop;

                        if (otherEntity.yvel < 0)
                            otherEntity.yvel = 0;
                        E.scriptEng.checkResult = 4;
                    }
                }
            }
        }
    }

    if (E.showHitboxes) {
        if (thisHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[thisHitboxID].collision |= 1 << (E.scriptEng.checkResult - 1);
        if (otherHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[otherHitboxID].collision |= 1 << (4 - E.scriptEng.checkResult);
    }
}
export function PlatformCollision(E: Engine, thisEntity: Entity, thisLeft: number, thisTop: number, thisRight: number, thisBottom: number, otherEntity: Entity, otherLeft: number, otherTop: number, otherRight: number, otherBottom: number): void
{
    E.scriptEng.checkResult = 0;

    let thisHitbox = GetHitbox(E, thisEntity);
    let otherHitbox = GetHitbox(E, otherEntity);

    if (thisLeft == C_BOX)
        thisLeft = thisHitbox.left[0];

    if (thisTop == C_BOX)
        thisTop = thisHitbox.top[0];

    if (thisRight == C_BOX)
        thisRight = thisHitbox.right[0];

    if (thisBottom == C_BOX)
        thisBottom = thisHitbox.bottom[0];

    if (otherLeft == C_BOX)
        otherLeft = otherHitbox.left[0];

    if (otherTop == C_BOX)
        otherTop = otherHitbox.top[0];

    if (otherRight == C_BOX)
        otherRight = otherHitbox.right[0];

    if (otherBottom == C_BOX)
        otherBottom = otherHitbox.bottom[0];

    let thisHitboxID = 0;
    let otherHitboxID = 0;
    if (E.showHitboxes) {
        thisHitboxID  = AddDebugHitbox(E, H_TYPE_PLAT, thisEntity, thisLeft, thisTop, thisRight, thisBottom);
        otherHitboxID = AddDebugHitbox(E, H_TYPE_PLAT, otherEntity, otherLeft, otherTop, otherRight, otherBottom);
    }

    thisLeft += thisEntity.xpos >> 16;
    thisTop += thisEntity.ypos >> 16;
    thisRight += thisEntity.xpos >> 16;
    thisBottom += thisEntity.ypos >> 16;

    thisLeft <<= 16;
    thisTop <<= 16;
    thisRight <<= 16;
    thisBottom <<= 16;

    E.sensors[0].collided = 0;
    E.sensors[1].collided = 0;
    E.sensors[2].collided = 0;

    let rx = otherEntity.xpos >> 16 << 16;
    let ry = otherEntity.ypos >> 16 << 16;

    E.sensors[0].xpos = rx + (otherLeft << 16);
    E.sensors[1].xpos = rx;
    E.sensors[2].xpos = rx + (otherRight << 16);
    E.sensors[3].xpos = (rx + E.sensors[0].xpos) >> 1;
    E.sensors[4].xpos = (E.sensors[2].xpos + rx) >> 1;

    E.sensors[0].ypos = (otherBottom << 16) + ry;

    for (let i = 0; i < 5; ++i) {
        if (thisLeft < E.sensors[i].xpos && thisRight > E.sensors[i].xpos && thisTop - 1 <= E.sensors[0].ypos && thisBottom > E.sensors[0].ypos
            && otherEntity.yvel >= 0) {
            E.sensors[i].collided          = 1;
            otherEntity.floorSensors[i] = 1;
        }
    }

    if (E.sensors[0].collided || E.sensors[1].collided || E.sensors[2].collided) {
        if (!otherEntity.gravity && (otherEntity.collisionMode == CMODE_RWALL || otherEntity.collisionMode == CMODE_LWALL)) {
            otherEntity.xvel  = 0;
            otherEntity.speed = 0;
        }
        otherEntity.ypos        = thisTop - (otherBottom << 16);
        otherEntity.gravity     = 0;
        otherEntity.yvel        = 0;
        otherEntity.angle       = 0;
        otherEntity.rotation    = 0;
        otherEntity.controlLock = 0;
        E.scriptEng.checkResult    = 1;
    }

    if (E.showHitboxes) {
        if (thisHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[thisHitboxID].collision |= 1 << 0;
        if (otherHitboxID >= 0 && E.scriptEng.checkResult)
            E.debugHitboxList[otherHitboxID].collision |= 1 << 3;
    }
}
