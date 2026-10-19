import { describe, expect, it, vi } from "vitest";
import { GameSim3 } from "../packages/engine/src/v3/game.js";
import { ProcessObjects } from "../packages/engine/src/v3/object.js";
import { BTN, nullHost } from "../packages/engine/src/index.js";
import { hasData, loadVfs } from "./helpers.js";

function stage(act = 1, characters = [0, 1]) {
  const sim = new GameSim3(loadVfs("soniccd"), nullHost, { headless: true, players: characters.length });
  sim.configurePlayers(characters);
  sim.startStage(1, sim.findStage(`PALMTREE PANIC ZONE ${act} A`));
  for (let f = 0; f < 240; f++) sim.tick([0, 0]);
  expect(sim.E.compiler.errors).toEqual([]);
  return sim;
}

function centerCamera(sim: GameSim3, slot: number) {
  const E = sim.E, player = E.playerList[slot];
  E.setCamera(slot);
  E.xScrollOffset = E.xScrollA = (player.xpos >> 16) - E.SCREEN_CENTERX;
  E.xScrollB = E.xScrollA + E.SCREEN_XSIZE;
  E.yScrollOffset = E.yScrollA = (player.ypos >> 16) - 104;
  E.yScrollB = E.yScrollA + 240;
  E.xBoundary1 = E.newXBoundary1 = 0;
  E.xBoundary2 = E.newXBoundary2 = E.stageLayouts[0].xsize * 128;
  E.setCamera(0);
}

describe.skipIf(!hasData("soniccd"))("Sonic CD stage interactions", () => {
  it("keeps each player's ramp boundaries in their own camera", () => {
    const sim = stage();
    const E = sim.E;
    const ramp = E.objectEntityList.find((e) => E.typeNames[e.type] === "3DRamp" && e.propertyValue === 3);
    expect(ramp).toBeDefined();
    for (const entity of E.objectEntityList) entity.priority = 7;
    ramp!.priority = 1;
    E.playerList[0].xpos = ramp!.xpos - (100 << 16);
    E.playerList[1].xpos = ramp!.xpos + (100 << 16);
    ProcessObjects(E);
    E.setCamera(0);
    expect(E.yBoundary2).toBe(1280);
    expect(E.newYBoundary2).toBe(1280);
    E.setCamera(1);
    expect(E.yBoundary2).toBe(1024);
    expect(E.newYBoundary2).toBe(1024);
    const saved = sim.captureState();
    sim.tick([0, 0]);
    const next = sim.captureState();
    sim.applyState(saved);
    sim.tick([0, 0]);
    expect(sim.captureState()).toEqual(next);
    E.setCamera(0);
    expect(E.newYBoundary2).toBe(1280);
    E.setCamera(1);
    expect(E.newYBoundary2).toBe(1024);
  });

  it("does not let a ramp lock the other player's controls", () => {
    const sim = stage();
    const E = sim.E;
    const ramp = E.objectEntityList.find((e) => E.typeNames[e.type] === "3DRamp" && e.propertyValue === 8);
    expect(ramp).toBeDefined();
    for (const entity of E.objectEntityList) entity.priority = 7;
    ramp!.priority = 1;
    E.playerList[0].yvel = -0x10000;
    E.playerList[1].yvel = 0;
    E.playerList[1].objectInteractions = 0;
    ProcessObjects(E);
    expect(E.playerList[0].controlMode).toBe(-1);
    expect(E.playerList[1].controlMode).toBe(0);
  });

  for (const characters of [[0, 1], [1, 0]]) {
    it(`retains independent drop origins on the 3D ramp with characters ${characters}`, () => {
      const sim = stage(1, characters), E = sim.E;
      const ramp = E.objectEntityList.find((e) => E.typeNames[e.type] === "3DRamp" && e.propertyValue === 5);
      expect(ramp).toBeDefined();
      for (const entity of E.objectEntityList) entity.priority = 7;
      ramp!.priority = 1;
      const origins = [ramp!.xpos - (8 << 16), ramp!.xpos + (8 << 16)];
      for (const slot of [0, 1]) {
        E.playerList[slot].xpos = origins[slot];
        E.playerList[slot].ypos = ramp!.ypos;
        E.boundEntity(E.playerList[slot]).state = E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_Air");
      }
      ProcessObjects(E);
      for (const slot of [0, 1]) {
        E.playerList[slot].ypos += 128 << 16;
        E.playerList[slot].xpos += 80 << 16;
      }
      ProcessObjects(E);
      expect(E.playerList[0].xpos).toBe(origins[0]);
      expect(E.playerList[1].xpos).toBe(origins[1]);
    });

    for (const slot of [0, 1]) {
      it(`lets player ${slot + 1} escape the actual Act 2 rotating tube with characters ${characters}`, () => {
        const sim = stage(2, characters), E = sim.E;
        const entrance = E.objectEntityList.find((e) => E.typeNames[e.type] === "TubeSwitch" && e.propertyValue === 1);
        expect(entrance).toBeDefined();
        const player = E.playerList[slot];
        player.xpos = entrance!.xpos;
        player.ypos = entrance!.ypos;
        player.xvel = player.yvel = player.gravity = 0;
        player.speed = 0x100000;
        E.boundEntity(player).state = E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_Ground");
        centerCamera(sim, slot);
        const stationary = E.playerList[1 - slot].xpos;
        const tubeState = E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_TubeRoll");
        let enteredTube = false;
        for (let f = 0; f < 180; f++) {
          sim.tick(slot === 0 ? [BTN.RIGHT, 0] : [0, BTN.RIGHT]);
          enteredTube ||= E.boundEntity(player).state === tubeState;
        }
        expect(enteredTube).toBe(true);
        expect(player.xpos >> 16).toBeGreaterThan((entrance!.xpos >> 16) + 600);
        expect(E.boundEntity(player).state).not.toBe(tubeState);
        expect(player.visible).toBe(1);
        expect(player.tileCollisions).toBe(1);
        expect(player.objectInteractions).toBe(1);
        expect(E.playerList[1 - slot].xpos).toBe(stationary);
      });

      it(`keeps both cameras on their players while player ${slot + 1} runs the opening ramp with characters ${characters}`, () => {
        const sim = stage(1, characters), E = sim.E;
        const stationary = E.playerList[1 - slot].xpos;
        let enteredRamp = false;
        const rampState = E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_Ramp3D");
        for (let f = 0; f < 700; f++) {
          sim.tick(slot === 0 ? [BTN.RIGHT, 0] : [0, BTN.RIGHT]);
          enteredRamp ||= E.boundEntity(E.playerList[slot]).state === rampState;
          E.setCamera(1 - slot);
          const sy = (E.playerList[1 - slot].ypos >> 16) - E.yScrollOffset;
          expect(sy).toBeGreaterThan(0);
          expect(sy).toBeLessThan(240);
        }
        expect(enteredRamp).toBe(true);
        expect(E.playerList[slot].xpos >> 16).toBeGreaterThan(2080);
        expect(E.playerList[1 - slot].xpos).toBe(stationary);
        E.setCamera(slot);
        expect((E.playerList[slot].ypos >> 16) - E.yScrollOffset).toBeGreaterThan(0);
        expect((E.playerList[slot].ypos >> 16) - E.yScrollOffset).toBeLessThan(240);
      });
    }

    it(`lets player 2 finish with characters ${characters}`, () => {
      const sim = stage(1, characters);
      const E = sim.E;
      const sign = E.objectEntityList.find((e) => E.typeNames[e.type] === "SignPost");
      expect(sign).toBeDefined();
      E.playerList[1].xpos = sign!.xpos + (8 << 16);
      E.playerList[1].ypos = sign!.ypos;
      E.playerList[1].yvel = 0;
      centerCamera(sim, 1);
      for (let f = 0; f < 400 && E.objectEntityList[30].type === 0; f++) sim.tick([0, BTN.RIGHT]);
      expect(sign!.state).toBeGreaterThan(0);
      expect(E.typeNames[E.objectEntityList[30].type]).toBe("ActFinish");
      const act1 = E.stageListPosition;
      for (let f = 0; f < 1800 && E.stageListPosition === act1; f++) sim.tick([0, f % 60 === 0 ? BTN.C : 0]);
      expect(E.stageListPosition).not.toBe(act1);
      sim.tick([0, 0]);
      expect(E.stageList[E.activeStageList][E.stageListPosition].name).toContain("PALMTREE PANIC ZONE 2");
    });

    for (const slots of [[0], [1], [0, 1]]) {
      it(`does not repeatedly reverse tube players ${slots} with characters ${characters}`, () => {
        const sim = stage(2, characters), E = sim.E;
        const tunnel = E.objectEntityList.find((e) => E.typeNames[e.type] === "TubeSwitch" && e.propertyValue === 2);
        expect(tunnel).toBeDefined();
        for (const entity of E.objectEntityList) entity.priority = 7;
        tunnel!.priority = 1;
        const stationary = E.playerList[1 - slots[0]].xpos;
        for (const slot of slots) {
          const player = E.playerList[slot];
          player.xpos = tunnel!.xpos;
          player.ypos = tunnel!.ypos;
          player.gravity = player.collisionMode = player.angle = 0;
          player.speed = 0xA0000;
          player.tileCollisions = player.objectInteractions = player.visible = 1;
        }
        ProcessObjects(E);
        for (let f = 0; f < 5; f++) ProcessObjects(E);
        for (const slot of slots) {
          const player = E.playerList[slot];
          expect(player.collisionMode).toBe(2);
          expect(player.speed).toBe(-0xA0000);
          expect(E.boundEntity(player).state).toBe(E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_TubeRoll"));
          player.xpos += 128 << 16;
        }
        ProcessObjects(E);
        for (const slot of slots) E.playerList[slot].xpos = tunnel!.xpos;
        ProcessObjects(E);
        for (const slot of slots) {
          expect(E.playerList[slot].collisionMode).toBe(0);
          expect(E.playerList[slot].speed).toBe(0xA0000);
        }
        if (slots.length === 1) expect(E.playerList[1 - slots[0]].xpos).toBe(stationary);
        tunnel!.propertyValue = 7;
        for (const slot of slots) E.playerList[slot].gravity = 0;
        ProcessObjects(E);
        for (const slot of slots) E.playerList[slot].gravity = 1;
        ProcessObjects(E);
        for (const slot of slots) expect(E.playerList[slot].yvel).toBe(-0xA8000);
        expect(tunnel!.propertyValue).toBe(7);
      });
    }

    it(`lets player 2 jump off an Act 2 spinning top with characters ${characters}`, () => {
      const sim = stage(2, characters);
      const E = sim.E;
      const top = E.objectEntityList.find((e) => E.typeNames[e.type] === "SpinningTop");
      expect(top).toBeDefined();
      const player = E.playerList[1], body = E.boundEntity(player);
      player.xpos = top!.xpos + (8 << 16);
      player.ypos = top!.ypos - (30 << 16);
      player.yvel = 0x20000;
      player.xvel = player.speed = 0;
      player.gravity = 1;
      body.state = E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_Air");
      centerCamera(sim, 1);
      top!.priority = 1;
      const spinning = E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_SpinningTop");
      for (let f = 0; f < 30 && body.state !== spinning; f++) sim.tick([0, 0]);
      expect(body.state).toBe(spinning);
      sim.tick([0, BTN.C]);
      expect(body.state).not.toBe(spinning);
      expect(player.yvel).toBeLessThan(0);
      const launchY = player.ypos;
      for (let f = 0; f < 10; f++) sim.tick([0, BTN.C]);
      expect(player.ypos).toBeLessThan(launchY - (10 << 16));
    });
  }

  for (const characters of [[0, 1], [1, 0]]) for (const slot of [0, 1]) {
    it(`emits global jump and ring sounds for player ${slot + 1} with characters ${characters}`, () => {
      const sim = stage(1, characters);
      const loadSfx = vi.fn();
      const playSfx = vi.fn();
      const setSfxAttributes = vi.fn();
      const client = new GameSim3(loadVfs("soniccd"), { ...nullHost, loadSfx, playSfx, setSfxAttributes }, { headless: true, players: 2 });
      client.configurePlayers(characters);
      client.viewCamera = slot;
      client.applyState(sim.captureState());
      expect(loadSfx).toHaveBeenCalledWith(0, expect.stringMatching(/jump/i));
      client.tick(slot === 0 ? [BTN.C, 0] : [0, BTN.C]);
      expect(playSfx).toHaveBeenCalledWith(0, 0);
      const ring = client.E.objectEntityList.find((e) => client.E.typeNames[e.type] === "Ring");
      expect(ring).toBeDefined();
      client.E.playerList[slot].xpos = ring!.xpos;
      client.E.playerList[slot].ypos = ring!.ypos;
      client.E.playerList[slot].xvel = client.E.playerList[slot].yvel = 0;
      client.E.playerList[slot].collisionPlane = ring!.propertyValue;
      centerCamera(client, slot);
      ring!.priority = 1;
      playSfx.mockClear();
      client.tick([0, 0]);
      expect(setSfxAttributes).toHaveBeenCalledWith(expect.any(Number), -1, expect.any(Number));
    });
  }
});
