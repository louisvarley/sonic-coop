// The drawing functions the simulation calls into. Only an engine that renders (the browser) provides these;
// a headless engine (the server) has `draw = null` and every draw call is skipped.

import type { Engine, ObjectScript, SpriteFrame } from "../engine.js";
import type { Entity } from "../entity.js";
import type { TextMenu } from "../text.js";

export interface DrawApi {
  DrawSprite(E: Engine, x: number, y: number, w: number, h: number, sprX: number, sprY: number, sheet: number): void;
  DrawSpriteFX(E: Engine, entity: Entity, frame: SpriteFrame, fx: number, x: number, y: number, sheet: number): void;
  DrawObjectAnimation(E: Engine, script: ObjectScript, entity: Entity, x: number, y: number): void;
  DrawTintRectangle(E: Engine, x: number, y: number, w: number, h: number): void;
  DrawRectangle(E: Engine, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void;
  DrawTextMenu(E: Engine, menu: TextMenu, x: number, y: number, sheet: number): void;
  ClearScreen(E: Engine, index: number): void;
  Draw3DScene(E: Engine, sheet: number): void;
  /** Draws the stage layers and object draw lists for the current camera (DrawStageGFX). */
  DrawStageGFX(E: Engine): void;
}
