export interface V5CollisionMask {
  heights: Uint8Array;
  solid: Uint8Array;
  direction: number;
  floorAngle: number;
  leftWallAngle: number;
  rightWallAngle: number;
  roofAngle: number;
  flags: number;
}

export interface V5CollisionLayer {
  width: number;
  height: number;
  tiles: Uint16Array;
}

export type V5Surface = "floor" | "ceiling" | "leftWall" | "rightWall";

export interface V5CollisionHit {
  position: number;
  angle: number;
  layer: number;
  tile: number;
  flags: number;
}

/** World-pixel collision queries. Layer selection is explicit: editor visibility is not collision enablement. */
export class V5CollisionWorld {
  constructor(readonly layers: readonly V5CollisionLayer[], readonly paths: readonly (readonly V5CollisionMask[])[]) {
    if (paths.length !== 2 || paths.some((path) => path.length !== 1024
      || path.some((mask) => mask.heights.length !== 16 || mask.solid.length !== 16 || mask.direction > 1))) {
      throw new Error("invalid RSDKv5 collision paths");
    }
    if (layers.some((layer) => !Number.isInteger(layer.width) || !Number.isInteger(layer.height)
      || layer.width < 0 || layer.height < 0 || layer.tiles.length !== layer.width * layer.height)) {
      throw new Error("invalid RSDKv5 collision layer");
    }
  }

  private occupied(mask: V5CollisionMask, tile: number, x: number, y: number): boolean {
    if (tile & 0x400) x = 15 - x;
    if (tile & 0x800) y = 15 - y;
    return mask.solid[x] !== 0 && (mask.direction ? y <= mask.heights[x] : y >= mask.heights[x]);
  }

  private surface(mask: V5CollisionMask, tile: number, side: V5Surface, perpendicular: number): number | null {
    const descending = side === "ceiling" || side === "rightWall";
    const vertical = side === "floor" || side === "ceiling";
    for (let i = 0; i < 16; i++) {
      const axis = descending ? 15 - i : i;
      if (this.occupied(mask, tile, vertical ? perpendicular : axis, vertical ? axis : perpendicular)) {
        return axis + (descending ? 1 : 0);
      }
    }
    return null;
  }

  private angle(mask: V5CollisionMask, tile: number, side: V5Surface): number {
    let source = side;
    if (tile & 0x400) {
      if (source === "leftWall") source = "rightWall";
      else if (source === "rightWall") source = "leftWall";
    }
    if (tile & 0x800) {
      if (source === "floor") source = "ceiling";
      else if (source === "ceiling") source = "floor";
    }
    let angle = source === "floor" ? mask.floorAngle : source === "ceiling" ? mask.roofAngle
      : source === "leftWall" ? mask.leftWallAngle : mask.rightWallAngle;
    if (tile & 0x400) angle = -angle;
    if (tile & 0x800) angle = 128 - angle;
    return angle & 255;
  }

  /** Sweep a point to a surface, including both endpoints. Maximum sweep length is 4096 pixels. */
  trace(side: V5Surface, perpendicular: number, from: number, to: number, plane: number, layerIndices: readonly number[]): V5CollisionHit | null {
    if (!["floor", "ceiling", "leftWall", "rightWall"].includes(side)
      || ![perpendicular, from, to].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= 0x7fffffff)
      || Math.abs(to - from) > 4096 || (plane !== 0 && plane !== 1)) {
      throw new Error("invalid RSDKv5 collision trace");
    }
    if (layerIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= this.layers.length)) {
      throw new Error("invalid RSDKv5 collision layer selection");
    }
    const descending = side === "ceiling" || side === "rightWall";
    if (descending ? to > from : to < from) throw new Error("RSDKv5 collision trace direction mismatch");
    const vertical = side === "floor" || side === "ceiling";
    const solidity = 1 << (12 + plane * 2 + (side === "floor" ? 0 : 1));
    let best: V5CollisionHit | null = null;
    for (const layerIndex of layerIndices) {
      const layer = this.layers[layerIndex];
      const perpendicularSize = (vertical ? layer.width : layer.height) * 16;
      if (perpendicular < 0 || perpendicular >= perpendicularSize) continue;
      const minTile = Math.max(0, Math.floor((Math.min(from, to) - (descending ? 1 : 0)) / 16));
      const maxTile = Math.min((vertical ? layer.height : layer.width) - 1, Math.floor(Math.max(from, to) / 16));
      for (let axis = minTile; axis <= maxTile; axis++) {
        const tx = vertical ? Math.floor(perpendicular / 16) : axis;
        const ty = vertical ? axis : Math.floor(perpendicular / 16);
        const tile = layer.tiles[ty * layer.width + tx];
        if (tile === 0xffff || !(tile & solidity)) continue;
        const mask = this.paths[plane][tile & 0x3ff];
        const local = this.surface(mask, tile, side, perpendicular & 15);
        if (local === null) continue;
        const position = axis * 16 + local;
        if (position < Math.min(from, to) || position > Math.max(from, to)) continue;
        if (!best || (descending ? position > best.position : position < best.position)) {
          best = { position, angle: this.angle(mask, tile, side), layer: layerIndex, tile, flags: mask.flags };
        }
      }
    }
    return best;
  }
}
