// The drawing functions the v3 simulation calls into (Drawing.cpp). Only an engine that renders provides them; a
// headless engine has `draw = null` and every draw call is skipped.

import type { Engine3, ObjectScript3 } from "./engine.js";
import type { Entity3 } from "./entity.js";
import type { TextMenu } from "../text.js";

export interface DrawApi3 {
  DrawSprite(E: Engine3, x: number, y: number, w: number, h: number, sprX: number, sprY: number, sheet: number): void;
  DrawSpriteFlipped(E: Engine3, x: number, y: number, w: number, h: number, sprX: number, sprY: number, direction: number, sheet: number): void;
  DrawSpriteScaled(E: Engine3, direction: number, x: number, y: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number, w: number, h: number, sprX: number, sprY: number, sheet: number): void;
  DrawSpriteRotated(E: Engine3, direction: number, x: number, y: number, pivotX: number, pivotY: number, sprX: number, sprY: number, w: number, h: number, rotation: number, sheet: number): void;
  DrawSpriteRotozoom(E: Engine3, direction: number, x: number, y: number, pivotX: number, pivotY: number, sprX: number, sprY: number, w: number, h: number, rotation: number, scale: number, sheet: number): void;
  DrawBlendedSprite(E: Engine3, x: number, y: number, w: number, h: number, sprX: number, sprY: number, sheet: number): void;
  DrawAlphaBlendedSprite(E: Engine3, x: number, y: number, w: number, h: number, sprX: number, sprY: number, alpha: number, sheet: number): void;
  DrawAdditiveBlendedSprite(E: Engine3, x: number, y: number, w: number, h: number, sprX: number, sprY: number, alpha: number, sheet: number): void;
  DrawSubtractiveBlendedSprite(E: Engine3, x: number, y: number, w: number, h: number, sprX: number, sprY: number, alpha: number, sheet: number): void;
  DrawScaledTintMask(E: Engine3, direction: number, x: number, y: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number, w: number, h: number, sprX: number, sprY: number, sheet: number): void;
  DrawObjectAnimation(E: Engine3, script: ObjectScript3, entity: Entity3, x: number, y: number): void;
  DrawTintRectangle(E: Engine3, x: number, y: number, w: number, h: number): void;
  DrawRectangle(E: Engine3, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void;
  DrawTextMenu(E: Engine3, menu: TextMenu, x: number, y: number, sheet: number): void;
  DrawBitmapText(E: Engine3, menu: TextMenu, x: number, y: number, scale: number, spacing: number, rowStart: number, rowCount: number, sheet: number): void;
  ClearScreen(E: Engine3, index: number): void;
  /** Rasterises the transformed face list (Draw3DScene). */
  Draw3DScene(E: Engine3, sheet: number): void;
  /** Draws the stage layers and object draw lists for the current camera (DrawStageGFX). */
  DrawStageGFX(E: Engine3): void;
  /** Draws the object draw lists only (the paused stage). */
  DrawObjectLists(E: Engine3): void;
}
