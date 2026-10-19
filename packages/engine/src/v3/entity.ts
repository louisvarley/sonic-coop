// RSDKv3's Entity and Player structs as views over typed arrays (see ../entity.ts for why). Field widths follow the
// original structs: byte fields wrap at 256 and controlMode is a signed byte.

type Kind = "i" | "u8" | "s8";

function defineFields<T>(cls: { prototype: T }, fields: [string, Kind][]): void {
  fields.forEach(([name, kind], i) => {
    const set =
      kind === "u8"
        ? function (this: { m: Int32Array; o: number }, v: number) { this.m[this.o + i] = v & 0xff; }
        : kind === "s8"
          ? function (this: { m: Int32Array; o: number }, v: number) { this.m[this.o + i] = (v << 24) >> 24; }
          : function (this: { m: Int32Array; o: number }, v: number) { this.m[this.o + i] = v; };
    Object.defineProperty(cls.prototype, name, {
      get(this: { m: Int32Array; o: number }) { return this.m[this.o + i]; },
      set,
      configurable: false,
    });
  });
}

// ---- Entity --------------------------------------------------------------------------------------------------

const ENTITY_FIELDS: [string, Kind][] = [
  ["xpos", "i"], ["ypos", "i"],
  ["v0", "i"], ["v1", "i"], ["v2", "i"], ["v3", "i"], ["v4", "i"], ["v5", "i"], ["v6", "i"], ["v7", "i"],
  ["scale", "i"], ["rotation", "i"], ["animationTimer", "i"], ["animationSpeed", "i"],
  ["type", "u8"], ["propertyValue", "u8"], ["state", "u8"], ["priority", "u8"], ["drawOrder", "u8"], ["direction", "u8"],
  ["inkEffect", "u8"], ["alpha", "u8"], ["animation", "u8"], ["prevAnimation", "u8"], ["frame", "u8"],
];
export const ENT3_STRIDE = ENTITY_FIELDS.length;
const ENT_VALUES = 2;

export interface Entity3 {
  xpos: number; ypos: number;
  scale: number; rotation: number; animationTimer: number; animationSpeed: number;
  type: number; propertyValue: number; state: number; priority: number; drawOrder: number; direction: number;
  inkEffect: number; alpha: number; animation: number; prevAnimation: number; frame: number;
}

export class Entity3 {
  readonly o: number;
  /** values[0..7]; plain ints. */
  readonly values: Int32Array;
  constructor(readonly m: Int32Array, readonly slot: number) {
    this.o = slot * ENT3_STRIDE;
    this.values = m.subarray(this.o + ENT_VALUES, this.o + ENT_VALUES + 8);
  }
  /** memset(entity, 0) */
  clear(): void {
    this.m.fill(0, this.o, this.o + ENT3_STRIDE);
  }
}
defineFields(Entity3, ENTITY_FIELDS);

// ---- Player --------------------------------------------------------------------------------------------------

const PLAYER_FIELDS: [string, Kind][] = [
  ["entityNo", "i"], ["xpos", "i"], ["ypos", "i"], ["xvel", "i"], ["yvel", "i"], ["speed", "i"],
  ["screenXPos", "i"], ["screenYPos", "i"], ["angle", "i"], ["timer", "i"], ["lookPos", "i"],
  ["v0", "i"], ["v1", "i"], ["v2", "i"], ["v3", "i"], ["v4", "i"], ["v5", "i"], ["v6", "i"], ["v7", "i"],
  ["collisionMode", "u8"], ["skidding", "u8"], ["pushing", "u8"], ["collisionPlane", "u8"], ["controlMode", "s8"], ["controlLock", "u8"],
  ["topSpeed", "i"], ["acceleration", "i"], ["deceleration", "i"], ["airAcceleration", "i"], ["airDeceleration", "i"],
  ["gravityStrength", "i"], ["jumpStrength", "i"], ["jumpCap", "i"], ["rollingAcceleration", "i"], ["rollingDeceleration", "i"],
  ["visible", "u8"], ["tileCollisions", "u8"], ["objectInteractions", "u8"], ["left", "u8"], ["right", "u8"], ["up", "u8"],
  ["down", "u8"], ["jumpPress", "u8"], ["jumpHold", "u8"], ["followPlayer1", "u8"], ["trackScroll", "u8"], ["gravity", "u8"],
  ["water", "u8"], ["f0", "u8"], ["f1", "u8"], ["f2", "u8"],
  // pointers in the original: indices into animationFileList and objectEntityList
  ["animationFile", "i"], ["boundEntity", "i"],
];
export const PLAYER3_STRIDE = PLAYER_FIELDS.length;
const PLR_VALUES = 11;
const PLR_FLAILING = PLAYER_FIELDS.findIndex(([n]) => n === "f0");

export interface Player3 {
  entityNo: number; xpos: number; ypos: number; xvel: number; yvel: number; speed: number;
  screenXPos: number; screenYPos: number; angle: number; timer: number; lookPos: number;
  collisionMode: number; skidding: number; pushing: number; collisionPlane: number; controlMode: number; controlLock: number;
  topSpeed: number; acceleration: number; deceleration: number; airAcceleration: number; airDeceleration: number;
  gravityStrength: number; jumpStrength: number; jumpCap: number; rollingAcceleration: number; rollingDeceleration: number;
  visible: number; tileCollisions: number; objectInteractions: number; left: number; right: number; up: number;
  down: number; jumpPress: number; jumpHold: number; followPlayer1: number; trackScroll: number; gravity: number;
  water: number; animationFile: number; boundEntity: number;
}

export class Player3 {
  readonly o: number;
  readonly values: Int32Array;
  constructor(readonly m: Int32Array, readonly slot: number) {
    this.o = slot * PLAYER3_STRIDE;
    this.values = m.subarray(this.o + PLR_VALUES, this.o + PLR_VALUES + 8);
  }
  getFlailing(i: number): number {
    return this.m[this.o + PLR_FLAILING + i];
  }
  setFlailing(i: number, v: number): void {
    this.m[this.o + PLR_FLAILING + i] = v & 0xff;
  }
}
defineFields(Player3, PLAYER_FIELDS);
