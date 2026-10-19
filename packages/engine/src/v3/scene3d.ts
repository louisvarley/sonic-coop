// Scene3D.cpp (RSDKv3): matrices and vertex transforms. Rasterising the faces is the renderer's job.

import type { Engine3, Matrix3 } from "./engine.js";
import { sin512LookupTable, cos512LookupTable } from "../math.js";

const mul8 = (a: number, b: number) => Math.imul(a, b) >> 8;

function setRows(m: Matrix3, v: number[]): void {
  for (let i = 0; i < 16; i++) m.values[i >> 2][i & 3] = v[i];
}

export function SetIdentityMatrix(m: Matrix3): void {
  setRows(m, [0x100, 0, 0, 0, 0, 0x100, 0, 0, 0, 0, 0x100, 0, 0, 0, 0, 0x100]);
}

export function MatrixMultiply(a: Matrix3, b: Matrix3): void {
  const out = new Int32Array(16);
  for (let i = 0; i < 16; ++i) {
    const rowB = i & 3, rowA = (i & 0xc) >> 2;
    out[i] = mul8(a.values[rowA][3], b.values[3][rowB]) + mul8(a.values[rowA][2], b.values[2][rowB])
      + mul8(a.values[rowA][1], b.values[1][rowB]) + mul8(a.values[rowA][0], b.values[0][rowB]);
  }
  for (let i = 0; i < 16; ++i) a.values[i >> 2][i & 3] = out[i];
}

export function MatrixTranslateXYZ(m: Matrix3, x: number, y: number, z: number): void {
  setRows(m, [0x100, 0, 0, 0, 0, 0x100, 0, 0, 0, 0, 0x100, 0, x, y, z, 0x100]);
}

export function MatrixScaleXYZ(m: Matrix3, sx: number, sy: number, sz: number): void {
  setRows(m, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 0x100]);
}

function angle512(r: number): number {
  if (r < 0) r = 0x200 - r;
  return r & 0x1ff;
}

export function MatrixRotateX(m: Matrix3, rotation: number): void {
  const r = angle512(rotation);
  const s = sin512LookupTable[r] >> 1, c = cos512LookupTable[r] >> 1;
  setRows(m, [0x100, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 0x100]);
}

export function MatrixRotateY(m: Matrix3, rotation: number): void {
  const r = angle512(rotation);
  const s = sin512LookupTable[r] >> 1, c = cos512LookupTable[r] >> 1;
  setRows(m, [c, 0, s, 0, 0, 0x100, 0, 0, -s, 0, c, 0, 0, 0, 0, 0x100]);
}

/** Identical to MatrixRotateY in the original (a bug the scripts were written against). */
export function MatrixRotateZ(m: Matrix3, rotation: number): void {
  MatrixRotateY(m, rotation);
}

export function MatrixRotateXYZ(m: Matrix3, rx: number, ry: number, rz: number): void {
  rx = angle512(rx); ry = angle512(ry); rz = angle512(rz);
  const sX = sin512LookupTable[rx] >> 1, cX = cos512LookupTable[rx] >> 1;
  const sY = sin512LookupTable[ry] >> 1, cY = cos512LookupTable[ry] >> 1;
  const sZ = sin512LookupTable[rz] >> 1, cZ = cos512LookupTable[rz] >> 1;
  setRows(m, [
    mul8(sZ, mul8(sY, sX)) + mul8(cZ, cY), mul8(sZ, cY) - mul8(cZ, mul8(sY, sX)), mul8(sY, cX), 0,
    mul8(sZ, -cX), mul8(cZ, cX), sX, 0,
    mul8(sZ, mul8(cY, sX)) - mul8(cZ, sY), mul8(sZ, -sY) - mul8(cZ, mul8(cY, sX)), mul8(cY, cX), 0,
    0, 0, 0, 0x100,
  ]);
}

/** matFinal = matWorld * matView, then vertexBufferT = vertexBuffer transformed. */
export function TransformVertexBuffer(E: Engine3): void {
  for (let y = 0; y < 4; ++y) for (let x = 0; x < 4; ++x) E.matFinal.values[y][x] = E.matWorld.values[y][x];
  MatrixMultiply(E.matFinal, E.matView);
  const f = E.matFinal.values, vb = E.vertexBuffer, vt = E.vertexBufferT;
  for (let i = 0; i < E.vertexCount; ++i) {
    const vx = vb[i * 5], vy = vb[i * 5 + 1], vz = vb[i * 5 + 2];
    vt[i * 5] = mul8(vx, f[0][0]) + mul8(vy, f[1][0]) + mul8(vz, f[2][0]) + f[3][0];
    vt[i * 5 + 1] = mul8(vx, f[0][1]) + mul8(vy, f[1][1]) + mul8(vz, f[2][1]) + f[3][1];
    vt[i * 5 + 2] = mul8(vx, f[0][2]) + mul8(vy, f[1][2]) + mul8(vz, f[2][2]) + f[3][2];
  }
}

export function TransformVerticies(E: Engine3, m: Matrix3, startIndex: number, endIndex: number): void {
  if (startIndex > endIndex) return;
  const v = m.values, vb = E.vertexBuffer;
  do {
    const o = startIndex * 5;
    const vx = vb[o], vy = vb[o + 1], vz = vb[o + 2];
    vb[o] = mul8(vx, v[0][0]) + mul8(vy, v[1][0]) + mul8(vz, v[2][0]) + v[3][0];
    vb[o + 1] = mul8(vx, v[0][1]) + mul8(vy, v[1][1]) + mul8(vz, v[2][1]) + v[3][1];
    vb[o + 2] = mul8(vx, v[0][2]) + mul8(vy, v[1][2]) + mul8(vz, v[2][2]) + v[3][2];
  } while (++startIndex < endIndex);
}

/** Back-to-front face order for Draw3DScene: [faceID...] sorted by descending average depth (stable bubble sort). */
export function Sort3DDrawList(E: Engine3): Int32Array {
  const n = E.faceCount;
  const ids = new Int32Array(n), depth = new Int32Array(n);
  const fb = E.faceBuffer, vt = E.vertexBufferT;
  for (let i = 0; i < n; ++i) {
    depth[i] = (vt[fb[i * 6 + 3] * 5 + 2] + vt[fb[i * 6 + 2] * 5 + 2] + vt[fb[i * 6 + 1] * 5 + 2] + vt[fb[i * 6] * 5 + 2]) >> 2;
    ids[i] = i;
  }
  for (let i = 0; i < n; ++i) {
    for (let j = n - 1; j > i; --j) {
      if (depth[j] > depth[j - 1]) {
        const id = ids[j], d = depth[j];
        ids[j] = ids[j - 1]; depth[j] = depth[j - 1];
        ids[j - 1] = id; depth[j - 1] = d;
      }
    }
  }
  return ids;
}
