import type { V5GameplayState } from "./gameplay.js";

const FP = 65536, STEP = 1000 / 60;
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
function interpolate(a: V5GameplayState, b: V5GameplayState, t: number): V5GameplayState {
  if (t >= 1) return structuredClone(b);
  const state = structuredClone(a);
  state.movement.frame = Math.floor(a.movement.frame + (b.movement.frame - a.movement.frame) * t);
  state.movement.players.forEach((player, slot) => {
    const next = b.movement.players[slot];
    if (player.plane !== next.plane || player.highPriority !== next.highPriority
      || a.players[slot].deaths !== b.players[slot].deaths
      || Math.abs(player.x - next.x) > 96 * FP || Math.abs(player.y - next.y) > 96 * FP) return;
    player.x = lerp(player.x, next.x, t); player.y = lerp(player.y, next.y, t);
    if (player.grounded && next.grounded) {
      player.angle = (player.angle + Math.round((((next.angle - player.angle + 128) & 255) - 128) * t)) & 255;
    }
  });
  state.enemyWorld.enemies.forEach((enemy) => {
    const next = b.enemyWorld.enemies.find((e) => e.id === enemy.id);
    if (!next || enemy.defeated !== next.defeated) return;
    enemy.x = lerp(enemy.x, next.x, t); enemy.y = lerp(enemy.y, next.y, t);
  });
  for (const [current, following] of [[state.droppedRings, b.droppedRings], [state.enemyWorld.projectiles, b.enemyWorld.projectiles]]) {
    current.forEach((object) => {
      const next = following.find((entry) => entry.id === object.id);
      if (next) { object.x = lerp(object.x, next.x, t); object.y = lerp(object.y, next.y, t); }
    });
  }
  return state;
}

/** Render-only interpolation, six ticks behind the latest server time. Never extrapolates or mutates simulation state. */
export class V5SnapshotBuffer {
  private history: V5GameplayState[] = [];
  private received = 0;
  private renderedFrame = 0;

  clear(): void { this.history = []; this.received = 0; this.renderedFrame = 0; }

  push(state: V5GameplayState, now: number): void {
    if (!Number.isFinite(now) || now < 0) throw new Error("invalid v5 snapshot receive time");
    const latest = this.history.at(-1);
    if (latest && state.movement.frame <= latest.movement.frame) this.clear();
    this.history.push(structuredClone(state));
    if (this.history.length > 8) this.history.shift();
    this.received = now;
  }

  sample(now: number): V5GameplayState {
    if (!Number.isFinite(now) || now < 0) throw new Error("invalid v5 interpolation time");
    const latest = this.history.at(-1);
    if (!latest) throw new Error("no v5 online snapshots to render");
    const target = Math.min(latest.movement.frame, Math.max(this.history[0].movement.frame, this.renderedFrame,
      latest.movement.frame + Math.max(0, now - this.received) / STEP - 6));
    this.renderedFrame = target;
    for (let index = 1; index < this.history.length; index++) {
      const a = this.history[index - 1], b = this.history[index];
      if (target <= b.movement.frame) {
        return interpolate(a, b, Math.max(0, (target - a.movement.frame) / (b.movement.frame - a.movement.frame)));
      }
    }
    return structuredClone(latest);
  }
}
