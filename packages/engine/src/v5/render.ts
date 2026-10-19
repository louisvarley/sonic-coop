export interface V5Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  layers?: number[];
  transparent?: boolean;
  fallingTiles?: readonly { layer: number; index: number; fallTime: number }[];
}

export interface V5RenderData {
  layers: { width: number; height: number; visible: boolean; drawGroup: number; tiles: Uint16Array }[];
  pixels: Uint8Array;
  palette: Uint8Array;
  background: { r: number; g: number; b: number };
}

/** Static world-space tile rasterization; runtime parallax and animated tiles are not implemented yet. */
export function renderV5Tiles(stage: V5RenderData, view: V5Viewport): Uint8Array {
  if (![view.x, view.y, view.width, view.height].every(Number.isSafeInteger)
    || Math.abs(view.x) > 0x7fffffff || Math.abs(view.y) > 0x7fffffff
    || (view.transparent !== undefined && typeof view.transparent !== "boolean")
    || view.width < 1 || view.height < 1 || view.width > 2048 || view.height > 2048) {
    throw new Error("invalid RSDKv5 preview viewport (maximum 2048x2048)");
  }
  const indices = view.layers ?? stage.layers.flatMap((layer, index) => layer.visible ? [index] : []);
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= stage.layers.length)) {
    throw new Error("invalid RSDKv5 preview layer index");
  }
  const falling = new Map<number, Map<number, number>>();
  for (const tile of view.fallingTiles ?? []) {
    if (!Number.isInteger(tile.layer) || !stage.layers[tile.layer] || !Number.isInteger(tile.index) || tile.index < 0
      || tile.index >= stage.layers[tile.layer].tiles.length || !Number.isSafeInteger(tile.fallTime) || tile.fallTime < 0) {
      throw new Error("invalid v5 falling tile");
    }
    if (!falling.has(tile.layer)) falling.set(tile.layer, new Map());
    falling.get(tile.layer)!.set(tile.index, tile.fallTime);
  }
  const output = new Uint8Array(view.width * view.height * 4);
  if (!view.transparent) {
    for (let i = 0; i < output.length; i += 4) {
      output[i] = stage.background.r; output[i + 1] = stage.background.g; output[i + 2] = stage.background.b; output[i + 3] = 255;
    }
  }
  const layers = [...new Set(indices)].sort((a, b) => stage.layers[a].drawGroup - stage.layers[b].drawGroup);
  for (const layerIndex of layers) {
    const layer = stage.layers[layerIndex], removed = falling.get(layerIndex);
    const draw = (tile: number, screenX: number, screenY: number) => {
      if (tile === 0xffff) return;
      const base = (tile & 0x3ff) * 256;
      for (let y = Math.max(0, -screenY); y < Math.min(16, view.height - screenY); y++) {
        for (let x = Math.max(0, -screenX); x < Math.min(16, view.width - screenX); x++) {
          const sourceX = tile & 0x400 ? 15 - x : x, sourceY = tile & 0x800 ? 15 - y : y;
          const index = stage.pixels[base + sourceY * 16 + sourceX];
          if (!index) continue;
          const dest = ((screenY + y) * view.width + screenX + x) * 4;
          output[dest] = stage.palette[index * 3];
          output[dest + 1] = stage.palette[index * 3 + 1];
          output[dest + 2] = stage.palette[index * 3 + 2];
          output[dest + 3] = 255;
        }
      }
    };
    const startX = Math.max(0, Math.floor(view.x / 16)), endX = Math.min(layer.width, Math.ceil((view.x + view.width) / 16));
    const startY = Math.max(0, Math.floor(view.y / 16)), endY = Math.min(layer.height, Math.ceil((view.y + view.height) / 16));
    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        const index = ty * layer.width + tx;
        if (!removed?.has(index)) draw(layer.tiles[index], tx * 16 - view.x, ty * 16 - view.y);
      }
    }
    for (const [index, age] of removed ?? []) {
      if (age < 90) draw(layer.tiles[index], (index % layer.width) * 16 - view.x,
        Math.floor(index / layer.width) * 16 - view.y + Math.floor(age * age / 8));
    }
  }
  return output;
}
