// Trig lookup tables (CalculateTrigAngles) and the arctan lookup. Generated once at module load; the values are
// truncated to integers, so they come out identical on every JavaScript engine for all practical inputs.

export const sinM7LookupTable = new Int32Array(0x200);
export const cosM7LookupTable = new Int32Array(0x200);
export const sin512LookupTable = new Int32Array(0x200);
export const cos512LookupTable = new Int32Array(0x200);
export const sin256LookupTable = new Int32Array(0x100);
export const cos256LookupTable = new Int32Array(0x100);
export const arcTan256LookupTable = new Uint8Array(0x100 * 0x100);

const f = Math.fround;
for (let i = 0; i < 0x200; ++i) {
  sinM7LookupTable[i] = Math.trunc(Math.sin((i / 256.0) * Math.PI) * 4096.0);
  cosM7LookupTable[i] = Math.trunc(Math.cos((i / 256.0) * Math.PI) * 4096.0);
}
cosM7LookupTable[0x00] = 0x1000;
cosM7LookupTable[0x80] = 0;
cosM7LookupTable[0x100] = -0x1000;
cosM7LookupTable[0x180] = 0;
sinM7LookupTable[0x00] = 0;
sinM7LookupTable[0x80] = 0x1000;
sinM7LookupTable[0x100] = 0;
sinM7LookupTable[0x180] = -0x1000;
for (let i = 0; i < 0x200; ++i) {
  sin512LookupTable[i] = Math.trunc(f(f(Math.sin((i / 256.0) * Math.PI)) * 512.0));
  cos512LookupTable[i] = Math.trunc(f(f(Math.cos((i / 256.0) * Math.PI)) * 512.0));
}
cos512LookupTable[0x00] = 0x200;
cos512LookupTable[0x80] = 0;
cos512LookupTable[0x100] = -0x200;
cos512LookupTable[0x180] = 0;
sin512LookupTable[0x00] = 0;
sin512LookupTable[0x80] = 0x200;
sin512LookupTable[0x100] = 0;
sin512LookupTable[0x180] = -0x200;
for (let i = 0; i < 0x100; i++) {
  sin256LookupTable[i] = sin512LookupTable[i * 2] >> 1;
  cos256LookupTable[i] = cos512LookupTable[i * 2] >> 1;
}
for (let Y = 0; Y < 0x100; ++Y) {
  for (let X = 0; X < 0x100; ++X) {
    const angle = f(Math.atan2(Y, X));
    arcTan256LookupTable[Y + X * 0x100] = Math.trunc(f(angle * f(40.743664))) & 0xff;
  }
}

export function Sin512(angle: number): number {
  if (angle < 0) angle = 0x200 - angle;
  return sin512LookupTable[angle & 0x1ff];
}
export function Cos512(angle: number): number {
  if (angle < 0) angle = 0x200 - angle;
  return cos512LookupTable[angle & 0x1ff];
}
export function Sin256(angle: number): number {
  if (angle < 0) angle = 0x100 - angle;
  return sin256LookupTable[angle & 0xff];
}
export function Cos256(angle: number): number {
  if (angle < 0) angle = 0x100 - angle;
  return cos256LookupTable[angle & 0xff];
}

export function ArcTanLookup(X: number, Y: number): number {
  let x = Math.abs(X);
  let y = Math.abs(Y);
  if (x <= y) {
    while (y > 0xff) {
      x >>= 4;
      y >>= 4;
    }
  } else {
    while (x > 0xff) {
      x >>= 4;
      y >>= 4;
    }
  }
  let r: number;
  if (X <= 0) {
    if (Y <= 0) r = arcTan256LookupTable[(x << 8) + y] + -0x80;
    else r = -0x80 - arcTan256LookupTable[(x << 8) + y];
  } else if (Y <= 0) r = -arcTan256LookupTable[(x << 8) + y];
  else r = arcTan256LookupTable[(x << 8) + y];
  return r & 0xff;
}

/** Deterministic replacement for rand(): a 31-bit LCG kept in the engine state (rngState). */
export function nextRand(state: number): [number, number] {
  const s = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
  return [s, s >> 16];
}
