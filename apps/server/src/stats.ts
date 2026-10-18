// Process-wide counters exposed on /health and /stats.
export const stats = {
  startedAt: Date.now(),
  rooms: 0,
  ticks: 0,
  /** smoothed simulation time per tick (ms) */
  tickMs: 0,
  bytesOut: 0,
};
