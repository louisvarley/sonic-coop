import { describe, expect, it } from "vitest";
import { V5SnapshotBuffer } from "../packages/engine/src/v5/interpolation.js";
import { V5Gameplay } from "../packages/engine/src/v5/gameplay.js";
import { movementFixture, FP } from "./v5-test-fixtures.js";

function snapshot(frame: number, x = frame * FP) {
  const { sim } = movementFixture(), state = new V5Gameplay(sim, [], 512 * FP).capture();
  state.movement.frame = frame; state.movement.players[0].x = x;
  return state;
}
describe("v5 render-only online interpolation", () => {
  it("buffers six ticks and renders intermediate player positions without changing authority", () => {
    const buffer = new V5SnapshotBuffer();
    for (const frame of [0, 3, 6, 9]) buffer.push(snapshot(frame), frame * 1000 / 60);
    expect(buffer.sample(150).movement.players[0].x).toBe(3 * FP);
    expect(buffer.sample(175).movement.players[0].x).toBe(Math.round(4.5 * FP));
    expect(buffer.sample(300).movement.players[0].x).toBe(9 * FP);
  });
  it("never extrapolates during packet stalls and keeps bounded history", () => {
    const buffer = new V5SnapshotBuffer();
    for (let frame = 0; frame < 1000; frame += 3) buffer.push(snapshot(frame), frame);
    expect(buffer.sample(50000).movement.frame).toBe(999);
    expect(buffer.sample(50000).movement.players[0].x).toBe(999 * FP);
  });
  it("snaps restarts and same-frame state changes rather than blending separate runs", () => {
    const buffer = new V5SnapshotBuffer();
    buffer.push(snapshot(90), 100); buffer.push(snapshot(0, 100 * FP), 200);
    expect(buffer.sample(200).movement.players[0].x).toBe(100 * FP);
    buffer.push(snapshot(0, 200 * FP), 300);
    expect(buffer.sample(300).movement.players[0].x).toBe(200 * FP);
  });

  it("does not rewind rendered movement when late snapshots arrive after a packet stall", () => {
    const buffer = new V5SnapshotBuffer();
    buffer.push(snapshot(90), 0); buffer.push(snapshot(93), 50);
    expect(buffer.sample(200).movement.frame).toBe(93);
    buffer.push(snapshot(96), 200);
    expect(buffer.sample(200).movement.frame).toBe(93);
    expect(buffer.sample(225).movement.frame).toBe(93);
    expect(buffer.sample(275).movement.frame).toBe(94);
    buffer.push(snapshot(99), 300);
    expect(buffer.sample(300).movement.frame).toBe(94);
  });
  it("does not sweep players through teleports, deaths, collision-plane or draw-priority changes", () => {
    for (const mode of ["teleport", "death", "plane", "priority"]) {
      const buffer = new V5SnapshotBuffer(), a = snapshot(0, 10 * FP), b = snapshot(3, 20 * FP);
      if (mode === "teleport") b.movement.players[0].x = 200 * FP;
      if (mode === "death") b.players[0].deaths = 1;
      if (mode === "plane") b.movement.players[0].plane = 1;
      if (mode === "priority") b.movement.players[0].highPriority = true;
      buffer.push(a, 0); buffer.push(b, 50);
      expect(buffer.sample(125).movement.players[0].x).toBe(10 * FP);
      expect(buffer.sample(150)).toEqual(b);
    }
  });
  it("rotates angles across zero by the shortest path and interpolates shared moving entities by stable id", () => {
    const buffer = new V5SnapshotBuffer(), a = snapshot(0), b = snapshot(3);
    a.movement.players[0].grounded = b.movement.players[0].grounded = true;
    a.movement.players[0].angle = 250; b.movement.players[0].angle = 6;
    a.enemyWorld.enemies = [{ id: 10, x: 0, y: 0, facing: 1, timer: 0, defeated: false }];
    b.enemyWorld.enemies = [{ ...a.enemyWorld.enemies[0], x: 6 * FP }];
    a.droppedRings = [{ id: 1, x: 0, y: 0, vx: FP, vy: 0, plane: 0, age: 0 }];
    b.droppedRings = [{ ...a.droppedRings[0], x: 6 * FP }];
    a.enemyWorld.projectiles = [{ id: 2, source: 10, x: 0, y: 0, vx: FP, vy: 0, age: 0 }];
    b.enemyWorld.projectiles = [{ ...a.enemyWorld.projectiles[0], x: 6 * FP }];
    buffer.push(a, 0); buffer.push(b, 50);
    const rendered = buffer.sample(125);
    expect(rendered.movement.players[0].angle).toBe(0);
    expect(rendered.enemyWorld.enemies[0].x).toBe(3 * FP);
    expect(rendered.droppedRings[0].x).toBe(3 * FP);
    expect(rendered.enemyWorld.projectiles[0].x).toBe(3 * FP);
    rendered.movement.players[0].x = 1000 * FP;
    expect(buffer.sample(125).movement.players[0].x).not.toBe(1000 * FP);
    expect(a.movement.players[0].x).toBe(0);
  });
  it("rejects absent samples and invalid times explicitly", () => {
    const buffer = new V5SnapshotBuffer();
    expect(() => buffer.sample(0)).toThrow("no v5");
    expect(() => buffer.push(snapshot(0), NaN)).toThrow("time");
    buffer.push(snapshot(0), 100);
    expect(buffer.sample(99).movement.frame).toBe(0);
    expect(() => buffer.sample(-1)).toThrow("time");
  });
});
