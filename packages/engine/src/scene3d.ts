// Scene3D.cpp: the fixed-point 3D maths used by the Sonic 2 special stage (matrices, vertex transforms, face sort).
// Drawing the faces is in render/drawing3d.ts.

import type { Engine, Matrix } from "./engine.js";
import { sin512LookupTable, cos512LookupTable } from "./math.js";
import { FACEBUFFER_SIZE } from "./c.js";

export const drawList3DFace = new Int32Array(FACEBUFFER_SIZE);
export const drawList3DDepth = new Int32Array(FACEBUFFER_SIZE);

const mul = (a: number, b: number) => Math.imul(a, b) >> 8;

function set(m: Matrix, v: number[]): void {
  for (let i = 0; i < 16; i++) m.values[i >> 2][i & 3] = v[i];
}

export function SetIdentityMatrix(m: Matrix): void {
  set(m, [0x100, 0, 0, 0, 0, 0x100, 0, 0, 0, 0, 0x100, 0, 0, 0, 0, 0x100]);
}

export function MatrixMultiply(a: Matrix, b: Matrix): void {
  const out = new Int32Array(16);
  for (let i = 0; i < 16; ++i) {
    const ra = i >> 2, cb = i & 3;
    const A = a.values[ra];
    out[i] = mul(A[3], b.values[3][cb]) + mul(A[2], b.values[2][cb]) + mul(A[1], b.values[1][cb]) + mul(A[0], b.values[0][cb]);
  }
  for (let i = 0; i < 16; ++i) a.values[i >> 2][i & 3] = out[i];
}

export function MatrixTranslateXYZ(m: Matrix, x: number, y: number, z: number): void {
  set(m, [0x100, 0, 0, 0, 0, 0x100, 0, 0, 0, 0, 0x100, 0, x, y, z, 0x100]);
}

export function MatrixScaleXYZ(m: Matrix, sx: number, sy: number, sz: number): void {
  set(m, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 0x100]);
}

export function MatrixRotateX(m: Matrix, r: number): void {
  const s = sin512LookupTable[r & 0x1ff] >> 1, c = cos512LookupTable[r & 0x1ff] >> 1;
  set(m, [0x100, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 0x100]);
}

export function MatrixRotateY(m: Matrix, r: number): void {
  const s = sin512LookupTable[r & 0x1ff] >> 1, c = cos512LookupTable[r & 0x1ff] >> 1;
  set(m, [c, 0, s, 0, 0, 0x100, 0, 0, -s, 0, c, 0, 0, 0, 0, 0x100]);
}

export function MatrixRotateZ(m: Matrix, r: number): void {
  // (the original uses the Y-rotation layout here too)
  const s = sin512LookupTable[r & 0x1ff] >> 1, c = cos512LookupTable[r & 0x1ff] >> 1;
  set(m, [c, 0, s, 0, 0, 0x100, 0, 0, -s, 0, c, 0, 0, 0, 0, 0x100]);
}

export function MatrixRotateXYZ(m: Matrix, rx: number, ry: number, rz: number): void {
  rx = (rx << 16) >> 16; ry = (ry << 16) >> 16; rz = (rz << 16) >> 16;
  const sinX = sin512LookupTable[rx & 0x1ff] >> 1, cosX = cos512LookupTable[rx & 0x1ff] >> 1;
  const sinY = sin512LookupTable[ry & 0x1ff] >> 1, cosY = cos512LookupTable[ry & 0x1ff] >> 1;
  const sinZ = sin512LookupTable[rz & 0x1ff] >> 1, cosZ = cos512LookupTable[rz & 0x1ff] >> 1;
  set(m, [
    mul(cosZ, cosY) + mul(sinZ, mul(sinY, sinX)), mul(sinZ, cosY) - mul(cosZ, mul(sinY, sinX)), mul(sinY, cosX), 0,
    mul(sinZ, -cosX), mul(cosZ, cosX), sinX, 0,
    mul(sinZ, mul(cosY, sinX)) - mul(cosZ, sinY), mul(sinZ, -sinY) - mul(cosZ, mul(cosY, sinX)), mul(cosY, cosX), 0,
    0, 0, 0, 0x100,
  ]);
}

export function MatrixInverse(matrix: Matrix): void {
  const m = new Float64Array(16);
  for (let y = 0; y < 4; ++y) for (let x = 0; x < 4; ++x) m[(y << 2) + x] = matrix.values[y][x] / 256.0;
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (det === 0) return;
  det = 1.0 / det;
  for (let i = 0; i < 16; ++i) matrix.values[i >> 2][i & 3] = Math.trunc(inv[i] * det * 256);
}

export function TransformVertexBuffer(E: Engine): void {
  if (!E.draw) return;
  const f = E.matFinal;
  for (let r = 0; r < 4; r++) f.values[r].set(E.matWorld.values[r]);
  MatrixMultiply(f, E.matView);
  const vb = E.vertexBuf, vt = E.vertexBufT, m = f.values;
  for (let v = 0; v < E.vertexCount; ++v) {
    const o = v * 5;
    const vx = vb[o], vy = vb[o + 1], vz = vb[o + 2];
    vt[o] = mul(vx, m[0][0]) + mul(vy, m[1][0]) + mul(vz, m[2][0]) + m[3][0];
    vt[o + 1] = mul(vx, m[0][1]) + mul(vy, m[1][1]) + mul(vz, m[2][1]) + m[3][1];
    vt[o + 2] = mul(vx, m[0][2]) + mul(vy, m[1][2]) + mul(vz, m[2][2]) + m[3][2];
    vt[o + 3] = vb[o + 3];
    vt[o + 4] = vb[o + 4];
  }
}

export function TransformVertices(E: Engine, matrix: Matrix, startIndex: number, endIndex: number): void {
  const vb = E.vertexBuf, m = matrix.values;
  for (let v = startIndex; v < endIndex; ++v) {
    const o = v * 5;
    const vx = vb[o], vy = vb[o + 1], vz = vb[o + 2];
    vb[o] = mul(vx, m[0][0]) + mul(vy, m[1][0]) + mul(vz, m[2][0]) + m[3][0];
    vb[o + 1] = mul(vx, m[0][1]) + mul(vy, m[1][1]) + mul(vz, m[2][1]) + m[3][1];
    vb[o + 2] = mul(vx, m[0][2]) + mul(vy, m[1][2]) + mul(vz, m[2][2]) + m[3][2];
  }
}

export function Sort3DDrawList(E: Engine): void {
  if (!E.draw) return;
  const fb = E.faceBuf, vt = E.vertexBufT;
  const n = Math.min(E.faceCount, FACEBUFFER_SIZE);
  for (let i = 0; i < n; ++i) {
    const o = i * 6;
    drawList3DDepth[i] = (vt[fb[o + 3] * 5 + 2] + vt[fb[o + 2] * 5 + 2] + vt[fb[o + 1] * 5 + 2] + vt[fb[o] * 5 + 2]) >> 2;
    drawList3DFace[i] = i;
  }
  for (let i = 0; i < n; ++i) {
    for (let j = n - 1; j > i; --j) {
      if (drawList3DDepth[j] > drawList3DDepth[j - 1]) {
        const f = drawList3DFace[j], d = drawList3DDepth[j];
        drawList3DFace[j] = drawList3DFace[j - 1];
        drawList3DDepth[j] = drawList3DDepth[j - 1];
        drawList3DFace[j - 1] = f;
        drawList3DDepth[j - 1] = d;
      }
    }
  }
}
