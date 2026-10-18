import type { RsdkV5GameConfig } from "./rsdkv5-config.js";
import type { RsdkV5Stage } from "./rsdkv5-stage.js";
import { renderV5Tiles, type V5Viewport } from "../packages/engine/src/v5/render.js";

export type RsdkV5Viewport = V5Viewport;

/** Static world-space tile preview, not runtime parallax, animated tiles, objects or game logic. */
export function renderRsdkV5Stage(stage: RsdkV5Stage, game: RsdkV5GameConfig, view: RsdkV5Viewport): Uint8Array {
  const palette = Uint8Array.from(stage.tileset.palette);
  for (const bank of [game.palettes[0], stage.config.palettes[0]]) {
    bank.forEach((row, index) => { if (row) palette.set(row, index * 48); });
  }
  return renderV5Tiles({ layers: stage.scene.layers, pixels: stage.tileset.pixels, palette,
    background: stage.scene.editor.background1 }, view);
}
