import { RsdkV5Reader } from "./rsdkv5-reader.js";

export interface RsdkV5AnimationFrame {
  /** Raw index; some shipped animations reference sheets outside the declared table. */
  sheet: number;
  duration: number;
  unicodeChar: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
  hitboxes: { left: number; top: number; right: number; bottom: number }[];
}

export interface RsdkV5Animation {
  sheets: string[];
  hitboxTypes: string[];
  animations: {
    name: string;
    speed: number;
    loopIndex: number;
    rotationStyle: number;
    frames: RsdkV5AnimationFrame[];
  }[];
}

export function readRsdkV5Animation(data: Uint8Array): RsdkV5Animation {
  const reader = new RsdkV5Reader(data, "RSDKv5 sprite animation");
  if (String.fromCharCode(...reader.bytes(4)) !== "SPR\0") throw new Error("not an RSDKv5 sprite animation");
  const totalFrames = reader.u32();
  const sheets = Array.from({ length: reader.u8() }, () => reader.str());
  const hitboxTypes = Array.from({ length: reader.u8() }, () => reader.str());
  let remainingFrames = totalFrames;
  const animations = Array.from({ length: reader.u16() }, () => {
    const name = reader.str(), count = reader.u16(), speed = reader.s16(), loopIndex = reader.u8(), rotationStyle = reader.u8();
    if (count > remainingFrames || (count ? loopIndex >= count : loopIndex !== 0)) {
      throw new Error("invalid RSDKv5 animation frame count or loop index");
    }
    remainingFrames -= count;
    const frames = Array.from({ length: count }, () => {
      const sheet = reader.u8(), duration = reader.u16(), unicodeChar = reader.u16();
      const x = reader.u16(), y = reader.u16(), width = reader.u16(), height = reader.u16();
      const pivotX = reader.s16(), pivotY = reader.s16();
      const hitboxes = hitboxTypes.map(() => ({
        left: reader.s16(), top: reader.s16(), right: reader.s16(), bottom: reader.s16(),
      }));
      return { sheet, duration, unicodeChar, x, y, width, height, pivotX, pivotY, hitboxes };
    });
    return { name, speed, loopIndex, rotationStyle, frames };
  });
  if (remainingFrames) throw new Error("RSDKv5 animation total frame count mismatch");
  if (reader.remaining) throw new Error(`unexpected trailing bytes in RSDKv5 sprite animation: ${reader.remaining}`);
  return { sheets, hitboxTypes, animations };
}
