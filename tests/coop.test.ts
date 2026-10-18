import { describe, it, expect } from "vitest";
import { hasData, newSim, startStage } from "./helpers.js";
import { BTN } from "../packages/engine/src/input.js";
import { CAM_STRIDE, CAM_INDEX } from "../packages/engine/src/engine.js";

describe.skipIf(!hasData("sonic2"))("sonic2 co-op", () => {
  const setup = (chars: number[]) => {
    const sim = newSim("sonic2", chars.length);
    sim.configurePlayers(chars);
    startStage(sim, "EMERALD HILL ZONE 1");
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
    let teleported = false;
    for (let f = 0; f <= 600; f++) {
      const ev = sim.tick([f > 150 ? BTN.RIGHT : 0, f === 600 ? BTN.TELEPORT : 0]);
      if (ev.some((e) => e.type === "teleport")) teleported = true;
    }
    expect(teleported).toBe(true);
    const dx = Math.abs((E.objectEntityList[0].xpos - E.objectEntityList[1].xpos) >> 16);
    expect(dx).toBeLessThan(200);
  });
});
