// Pad state. Each player's pad is a bitmask; the engine derives "pressed this frame" from the previous frame's
// state (kept in the simulation state so re-simulation stays deterministic).

export const BTN = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  A: 1 << 4,
  B: 1 << 5,
  C: 1 << 6,
  X: 1 << 7,
  Y: 1 << 8,
  Z: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
  START: 1 << 12,
  SELECT: 1 << 13,
  /** Ring Link: bring the player furthest behind to the player furthest ahead. */
  TELEPORT: 1 << 14,
} as const;

/** Bit order used by the script variables keyDown.up .. keyDown.select (same order as BTN). */
export const KEY_ORDER = ["up", "down", "left", "right", "buttonA", "buttonB", "buttonC", "buttonX", "buttonY", "buttonZ", "buttonL", "buttonR", "start", "select"];
