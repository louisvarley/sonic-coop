import { describe, it, expect } from "vitest";
import { hasData, newSim, startStage } from "./helpers.js";
import { BTN } from "../packages/engine/src/input.js";
import { DEFAULT_SETTINGS, type GameSettings } from "../packages/engine/src/settings.js";
import { INFINITE_LIVES } from "../packages/engine/src/game.js";
import type { GameSim } from "../packages/engine/src/game.js";
import { CAM_STRIDE, CAM_INDEX } from "../packages/engine/src/engine.js";

describe.skipIf(!hasData("sonic2"))("sonic2 co-op", () => {
  const setup = (chars: number[], settings: GameSettings = DEFAULT_SETTINGS) => {
    const sim = newSim("sonic2", chars.length);
    sim.configurePlayers(chars, settings);
    startStage(sim, "EMERALD HILL ZONE 1", 1, chars[0] ?? 0);
    return sim;
  };

  it("creates a human player 2 with the chosen character and its own camera", () => {
    const sim = setup([0, 0]);
    sim.tick([0, 0]);
    const E = sim.E;
    const p2 = E.objectEntityList[1];
    expect(E.typeNames[p2.type]).toBe("Player2Object");
    expect(p2.values[16]).toBe(0); // isSidekick
    expect(E.cams[CAM_STRIDE + CAM_INDEX.cameraTarget]).toBe(1);
  });

  it("sets up Knuckles as either co-op player", () => {
    for (const characters of [[2, 0], [0, 2]]) {
      const sim = setup(characters);
      const events = sim.tick([0, 0]);
      expect(sim.E.objectEntityList[characters.indexOf(2)].propertyValue).toBe(2);
      expect(events.some((event) => event.type === "scriptError")).toBe(false);
    }
  });

  it("each player moves with their own pad and has an independent camera", () => {
    const sim = setup([0, 1]);
    const E = sim.E;
    for (let f = 0; f < 500; f++) sim.tick([f > 150 ? BTN.RIGHT : 0, f > 150 && f < 400 ? BTN.LEFT : 0]);
    const p1 = E.objectEntityList[0], p2 = E.objectEntityList[1];
    expect(p1.xpos >> 16).toBeGreaterThan(1000);
    expect(p2.xpos >> 16).toBeLessThan(100);
    const cam1 = E.cams[CAM_INDEX.xScrollOffset], cam2 = E.cams[CAM_STRIDE + CAM_INDEX.xScrollOffset];
    expect(cam1).toBeGreaterThan(800);
    expect(cam2).toBe(0);
  });

  it("the emergency teleport brings the player furthest behind to the one ahead", () => {
    const sim = setup([0, 1]);
    const E = sim.E;
    expect(sim.emergencyTeleport()).toEqual({ reason: "Can't regroup right now" }); // title card
    for (let f = 0; f < 200; f++) sim.tick([0, 0]);
    expect(sim.emergencyTeleport()).toEqual({ reason: "Everyone is already together" });
    for (let f = 0; f < 400; f++) sim.tick([BTN.RIGHT, 0]);
    expect(sim.emergencyTeleport()).toEqual({ from: [1], to: 0 });
    const dx = Math.abs((E.objectEntityList[0].xpos - E.objectEntityList[1].xpos) >> 16);
    expect(dx).toBeLessThan(200);
    expect(sim.emergencyTeleport()).toMatchObject({ reason: expect.stringMatching(/^Regroup ready in/) });
    for (let f = 0; f < 60; f++) sim.tick([0, 0]);
    expect(Math.abs((E.objectEntityList[0].xpos - E.objectEntityList[1].xpos) >> 16)).toBeLessThan(200);
  });

  const kill = (sim: GameSim, slot: number) => {
    const p = sim.E.objectEntityList[slot];
    p.state = sim.E.scriptFunctionList.findIndex((f) => f.name === "Player_State_Death");
    p.yvel = -0x70000;
  };

  for (const respawn of ["checkpoint", "partner"] as const) {
    it(`a player who dies respawns ${respawn === "checkpoint" ? "at the last checkpoint" : "next to their partner"}, with lives kept topped up`, () => {
      const sim = setup([0, 1], { ...DEFAULT_SETTINGS, respawn });
      const E = sim.E;
      for (let f = 0; f < 200; f++) sim.tick([0, 0]);
      const spawnX = sim.global("coop.spawnX") >> 16;
      // player 1 runs ahead (past no star post), player 2 stays and dies
      for (let f = 0; f < 120; f++) sim.tick([BTN.RIGHT, 0]);
      kill(sim, 1);
      for (let f = 0; f < 300; f++) sim.tick([0, 0]);
      const p1 = E.objectEntityList[0], p2 = E.objectEntityList[1];
      expect(E.scriptFunctionList[p2.state].name).not.toBe("Player_State_Death");
      expect(E.typeNames[p2.type]).toBe("Player2Object");
      if (respawn === "checkpoint") expect(Math.abs((p2.xpos >> 16) - spawnX)).toBeLessThan(32);
      else expect(Math.abs((p2.xpos - p1.xpos) >> 16)).toBeLessThan(32);
      expect(sim.global("player.lives2")).toBe(INFINITE_LIVES);
      expect(E.stageMode).toBe(1);
    });
  }

  it("player 1 dying does not freeze the level for player 2", () => {
    const sim = setup([0, 1]);
    for (let f = 0; f < 200; f++) sim.tick([0, 0]);
    kill(sim, 0);
    const x2 = sim.E.objectEntityList[1].xpos;
    for (let f = 0; f < 150; f++) sim.tick([0, BTN.RIGHT]);
    expect(sim.E.stageMode).toBe(1);
    expect(sim.E.objectEntityList[1].xpos).toBeGreaterThan(x2 + (200 << 16));
  });

  it("a boss arena brings in a player who is outside it and holds them there until the boss is beaten", () => {
    const sim = newSim("sonic2", 2);
    sim.configurePlayers([0, 1]);
    sim.startStage(1, sim.findStage("EMERALD HILL ZONE 1") + 1); // act 2 is listed as "2"
    const E = sim.E;
    for (let f = 0; f < 200; f++) sim.tick([0, 0]);
    const boss = E.objectEntityList.find((e, i) => i >= 2 && e.type && E.bossType[e.type] === 1)!;
    expect(E.typeNames[boss.type]).toBe("Eggman");
    const put = (slot: number, x: number, y: number) => {
      const p = E.objectEntityList[slot];
      p.xpos = x << 16;
      p.ypos = y << 16;
      p.xvel = p.yvel = p.speed = 0;
      E.setCamera(slot);
      E.cameraXPos = x;
      E.cameraYPos = y;
      E.setCamera(0);
    };
    put(0, (boss.xpos >> 16) - 250, (boss.ypos >> 16) - 32);
    put(1, (boss.xpos >> 16) - 250, (boss.ypos >> 16) - 32);
    for (let f = 0; f < 600 && !E.arenaLock; f++) sim.tick([BTN.RIGHT, BTN.RIGHT]);
    expect(E.arenaLock).toBe(1);
    for (let f = 0; f < 120; f++) sim.tick([0, 0]);
    const inArena = (slot: number) => {
      const x = E.objectEntityList[slot].xpos >> 16;
      return x >= E.newXBoundary1 - 64 && x <= E.newXBoundary2 + 64;
    };
    // player 2 is far behind the arena: brought to player 1
    put(1, E.newXBoundary1 - 3000, E.objectEntityList[0].ypos >> 16);
    expect(sim.tick([0, 0])).toContainEqual({ type: "arena", from: [1], to: 0 });
    expect(inArena(1)).toBe(true);
    // player 2 is far ahead of it (on another screen): the boss holds them by the arena's edge, not its camera's
    put(1, E.newXBoundary2 + 800, E.objectEntityList[0].ypos >> 16);
    sim.tick([0, BTN.RIGHT]);
    expect(inArena(1)).toBe(true);
    for (let f = 0; f < 300; f++) {
      sim.tick([0, BTN.RIGHT | (f % 40 < 3 ? BTN.C : 0)]);
      const x = E.objectEntityList[1].xpos >> 16;
      expect(x).toBeGreaterThanOrEqual(E.newXBoundary1 - 64);
      expect(x).toBeLessThanOrEqual(E.newXBoundary2 + 64);
    }
  });
});
