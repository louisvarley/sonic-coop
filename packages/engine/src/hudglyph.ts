// The ∞ shown instead of the lives count when lives are infinite. The games' HUD sheets have no such glyph, so
// it is painted into extra rows added below each HUD sheet when it loads, in the digits' own colours, and the HUD
// script patches add sprite frames for it: the small one (16x8, like the small digits) at (0, sheet height) and the
// big one (16x11, like the big digits) at (16, sheet height).

const SMALL = [
  ".####...####...",
  "##..##.##..##..",
  "##...###...##..",
  "##...###...##..",
  "##..##.##..##..",
  ".####...####...",
];

const BIG = [
  ".####.....####.",
  "######...######",
  "##..###.###..##",
  "##...#####...##",
  "##....###....##",
  "##...#####...##",
  "##..###.###..##",
  "######...######",
  ".####.....####.",
];

/** Rows added to a HUD sheet for the glyphs. */
export const HUD_GLYPH_ROWS = 12;

/** Palette indices of the HUD digits: fill and the drop shadow to their right and below. */
const FILL = 0x06, SHADOW = 0x01;

export function isHudSheet(path: string): boolean {
  return /(?:^|\/)Global\/Display(?:_[a-z])?\.gif$/i.test(path.replace(/\\/g, "/"));
}

function paint(data: Uint8Array, offset: number, width: number, x0: number, y0: number, rows: string[]): void {
  const fill = (x: number, y: number) => y >= 0 && x >= 0 && rows[y]?.[x] === "#";
  for (let y = 0; y <= rows.length; y++) {
    for (let x = 0; x <= rows[0].length; x++) {
      const v = fill(x, y) ? FILL : fill(x - 1, y) || fill(x, y - 1) || fill(x - 1, y - 1) ? SHADOW : 0;
      data[offset + (y0 + y) * width + x0 + x] = v;
    }
  }
}

/** Paint both glyphs into the rows below a sheet of `width` x `height` pixels stored at `offset`. */
export function paintHudGlyphs(data: Uint8Array, offset: number, width: number, height: number): void {
  data.fill(0, offset + height * width, offset + (height + HUD_GLYPH_ROWS) * width);
  paint(data, offset, width, 0, height, SMALL);
  paint(data, offset, width, 16, height, BIG);
}
