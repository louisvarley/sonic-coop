import { describe, it, expect } from "vitest";
import { hasData, newSim, startStage } from "./helpers.js";
import { captureState, restoreState, stateHash, encodeDelta, applyDelta } from "../packages/engine/src/state.js";
import { BTN } from "../packages/engine/src/input.js";

const script = (f: number) => (f < 150 ? 0 : f % 90 < 10 ? BTN.RIGHT | BTN.C : BTN.RIGHT);

for (const [game, stage] of [["sonic1", "GREEN HILL ZONE 1"], ["sonic2", "EMERALD HILL ZONE 1"]] as const) {
  describe.skipIf(!hasData(game))(`${game} determinism`, () => {
    it("two runs with the same inputs produce identical states", () => {
      const a = newSim(game), b = newSim(game);
      startStage(a, stage);
      startStage(b, stage);
      for (let f = 0; f < 400; f++) {
        a.tick([script(f)]);
        b.tick([script(f)]);
      }
      expect(stateHash(captureState(a.E))).toBe(stateHash(captureState(b.E)));
    });

    it("restoring a captured state into another engine continues identically (rollback)", () => {
      const a = newSim(game), b = newSim(game);
      startStage(a, stage);
      startStage(b, stage);
      // b loads the same stage, then diverges
      for (let f = 0; f < 200; f++) {
        a.tick([script(f)]);
        b.tick([BTN.LEFT]);
      }
      const snap = captureState(a.E);
      restoreState(b.E, snap);
      for (let f = 200; f < 500; f++) {
        a.tick([script(f)]);
        b.tick([script(f)]);
      }
      expect(stateHash(captureState(b.E))).toBe(stateHash(captureState(a.E)));
    });

    it("deltas reconstruct the state exactly", () => {
      const a = newSim(game);
      startStage(a, stage);
      for (let f = 0; f < 200; f++) a.tick([script(f)]);
      const base = captureState(a.E);
      for (let f = 200; f < 230; f++) a.tick([script(f)]);
      const cur = captureState(a.E);
      const delta = encodeDelta(base, cur);
      const copy = base.slice();
      applyDelta(copy, delta);
      expect(stateHash(copy)).toBe(stateHash(cur));
      expect(delta.byteLength).toBeLessThan(cur.byteLength / 20);
    });
  });
}
