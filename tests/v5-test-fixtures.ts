import { V5CollisionWorld, type V5CollisionMask } from "../packages/engine/src/v5/collision.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";

export const FP = 65536;
export function movementFixture() {
  const mask: V5CollisionMask = {
    heights: new Uint8Array(16), solid: new Uint8Array(16).fill(1), direction: 0,
    floorAngle: 0, roofAngle: 128, leftWallAngle: 192, rightWallAngle: 64, flags: 0,
  };
  const tiles = new Uint16Array(64 * 16).fill(0xffff);
  for (let x = 0; x < 64; x++) tiles[10 * 64 + x] = 0xf000;
  const world = new V5CollisionWorld([{ width: 64, height: 16, tiles }],
    [Array.from({ length: 1024 }, () => mask), Array.from({ length: 1024 }, () => mask)]);
  const sim = new V5Movement(world, [0], [{ x: 64 * FP, y: 100 * FP }, { x: 128 * FP, y: 100 * FP }]);
  return { world, sim, tiles };
}
