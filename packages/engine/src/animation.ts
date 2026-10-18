// Animation.cpp: .ani files (sprite sheets, animations, frames, hitboxes) and ProcessObjectAnimation.

import type { Engine, AnimationFile, ObjectScript } from "./engine.js";
import type { Entity } from "./entity.js";
import { FileReader } from "./core/reader.js";
import { ANIFILE_COUNT, ROTSTYLE_STATICFRAMES, SPRITEFRAME_COUNT, HITBOX_COUNT, ANIMATION_COUNT } from "./c.js";
import { AddGraphicsFile } from "./sprite.js";
import { StrComp } from "./strings.js";

export function LoadAnimationFile(E: Engine, filePath: string): void {
  const data = E.vfs.get(filePath);
  if (!data) {
    E.host.log(`missing animation ${filePath}`);
    return;
  }
  const f = new FileReader(data);
  const sheetIDs = new Uint8Array(0x18);
  const sheetCount = f.u8();
  for (let s = 0; s < sheetCount; ++s) {
    const len = f.u8();
    if (len) sheetIDs[s] = AddGraphicsFile(E, f.chars(len));
  }
  const animCount = f.u8();
  const animFile = E.animationFileList[E.animationFileCount];
  animFile.animCount = animCount;
  animFile.aniListOffset = E.animationCount;
  for (let a = 0; a < animCount; ++a) {
    const anim = E.animationList[E.animationCount++ % ANIMATION_COUNT];
    anim.frameListOffset = E.animFrameCount;
    anim.name = f.str();
    anim.frameCount = f.u8();
    anim.speed = f.u8();
    anim.loopPoint = f.u8();
    anim.rotationStyle = f.u8();
    for (let j = 0; j < anim.frameCount; ++j) {
      const frame = E.animFrames[E.animFrameCount++ % SPRITEFRAME_COUNT];
      frame.sheetID = sheetIDs[f.u8()];
      frame.hitboxID = f.u8();
      frame.sprX = f.u8();
      frame.sprY = f.u8();
      frame.width = f.u8();
      frame.height = f.u8();
      frame.pivotX = f.s8();
      frame.pivotY = f.s8();
    }
    if (anim.rotationStyle === ROTSTYLE_STATICFRAMES) anim.frameCount >>= 1;
  }
  animFile.hitboxListOffset = E.hitboxCount;
  const hitboxes = f.u8();
  for (let i = 0; i < hitboxes; ++i) {
    const hitbox = E.hitboxList[E.hitboxCount++ % HITBOX_COUNT];
    for (let d = 0; d < 8; ++d) {
      hitbox.left[d] = f.s8();
      hitbox.top[d] = f.s8();
      hitbox.right[d] = f.s8();
      hitbox.bottom[d] = f.s8();
    }
  }
}

export function ClearAnimationData(E: Engine): void {
  for (const fr of E.scriptFrames) { fr.sprX = fr.sprY = fr.width = fr.height = fr.pivotX = fr.pivotY = fr.sheetID = fr.hitboxID = 0; }
  for (const fr of E.animFrames) { fr.sprX = fr.sprY = fr.width = fr.height = fr.pivotX = fr.pivotY = fr.sheetID = fr.hitboxID = 0; }
  for (const h of E.hitboxList) { h.left.fill(0); h.top.fill(0); h.right.fill(0); h.bottom.fill(0); }
  for (const a of E.animationList) { a.name = ""; a.frameCount = a.speed = a.loopPoint = a.rotationStyle = a.frameListOffset = 0; }
  for (const a of E.animationFileList) { a.fileName = ""; a.animCount = a.aniListOffset = a.hitboxListOffset = 0; }
  E.scriptFrameCount = 0;
  E.animFrameCount = 0;
  E.animationCount = 0;
  E.animationFileCount = 0;
  E.hitboxCount = 0;
}

export function AddAnimationFile(E: Engine, filePath: string): AnimationFile {
  const path = "Data/Animations/" + filePath;
  for (let a = 0; a < ANIFILE_COUNT; ++a) {
    const af = E.animationFileList[a];
    if (af.fileName.length <= 0) {
      af.fileName = filePath;
      LoadAnimationFile(E, path);
      ++E.animationFileCount;
      return af;
    }
    if (StrComp(af.fileName, filePath)) return af;
  }
  return E.animationFileList[0];
}

export function ProcessObjectAnimation(E: Engine, objectScript: ObjectScript, entity: Entity): void {
  const sprAnim = E.animationList[objectScript.animFile.aniListOffset + entity.animation];
  if (entity.animationSpeed <= 0) {
    entity.animationTimer += sprAnim.speed;
  } else {
    if (entity.animationSpeed > 0xf0) entity.animationSpeed = 0xf0;
    entity.animationTimer += entity.animationSpeed;
  }
  if (entity.animation !== entity.prevAnimation) {
    entity.prevAnimation = entity.animation;
    entity.frame = 0;
    entity.animationTimer = 0;
    entity.animationSpeed = 0;
  }
  if (entity.animationTimer >= 0xf0) {
    entity.animationTimer -= 0xf0;
    ++entity.frame;
  }
  if (entity.frame >= sprAnim.frameCount) entity.frame = sprAnim.loopPoint;
}
