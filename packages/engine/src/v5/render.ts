export interface V5Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  layers?: number[];
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
    || view.width < 1 || view.height < 1 || view.width > 2048 || view.height > 2048) {
    throw new Error("invalid RSDKv5 preview viewport (maximum 2048x2048)");
  }
  const indices = view.layers ?? stage.layers.flatMap((layer, index) => layer.visible ? [index] : []);
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= stage.layers.length)) {
    throw new Error("invalid RSDKv5 preview layer index");
  }
  const output = new Uint8Array(view.width * view.height * 4);
  for (let i = 0; i < output.length; i += 4) {
    output[i] = stage.background.r; output[i + 1] = stage.background.g; output[i + 2] = stage.background.b; output[i + 3] = 255;
  }
  const layers = [...new Set(indices)].map((index) => stage.layers[index]).sort((a, b) => a.drawGroup - b.drawGroup);
  for (const layer of layers) {
    const startX = Math.max(0, Math.floor(view.x / 16)), endX = Math.min(layer.width, Math.ceil((view.x + view.width) / 16));
    const startY = Math.max(0, Math.floor(view.y / 16)), endY = Math.min(layer.height, Math.ceil((view.y + view.height) / 16));
    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        const tile = layer.tiles[ty * layer.width + tx];
        if (tile === 0xffff) continue;
        const base = (tile & 0x3ff) * 256;
        const screenX = tx * 16 - view.x, screenY = ty * 16 - view.y;
        for (let y = Math.max(0, -screenY); y < Math.min(16, view.height - screenY); y++) {
          for (let x = Math.max(0, -screenX); x < Math.min(16, view.width - screenX); x++) {
            const sourceX = tile & 0x400 ? 15 - x : x, sourceY = tile & 0x800 ? 15 - y : y;
            const index = stage.pixels[base + sourceY * 16 + sourceX];
            if (!index) continue;
            const dest = ((screenY + y) * view.width + screenX + x) * 4;
            output[dest] = stage.palette[index * 3];
            output[dest + 1] = stage.palette[index * 3 + 1];
            output[dest + 2] = stage.palette[index * 3 + 2];
          }
        }
      }
    }
  }
  return output;
}
