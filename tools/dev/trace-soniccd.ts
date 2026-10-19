// Developer tool: per-frame simulation trace of the Sonic CD (RSDKv3) engine, in the same format as the reference
// harness built from the RSDKv3 decompilation (see docs in tools/dev/rsdkv3-ref/). Diffing the two finds the first
// frame where the port and the original disagree.
//   tsx tools/dev/trace-soniccd.ts <data dir> <list> <stagePos> <frames> <inputs-file> [playerListPos]
import fs from "node:fs";
import path from "node:path";
import { Vfs } from "../../packages/engine/src/core/pak.js";
import { GameSim3 } from "../../packages/engine/src/v3/game.js";
import { ENTITY_COUNT, PLAYER_COUNT } from "../../packages/engine/src/v3/consts.js";
import type { Engine3 } from "../../packages/engine/src/v3/engine.js";

const [dataDir, listArg, posArg, framesArg, inputsFile, plrArg = "0"] = process.argv.slice(2);
const inputs = fs.readFileSync(inputsFile, "utf8").split(/\s+/).filter(Boolean).map(Number);

const mix = (h: number, v: number) => (Math.imul(h, 31) + (v | 0)) >>> 0;
const hex = (h: number) => h.toString(16).padStart(8, "0");

function hashEntities(E: Engine3): number {
  let h = 0;
  for (let i = 0; i < ENTITY_COUNT; ++i) {
    const e = E.objectEntityList[i];
    h = mix(h, e.xpos); h = mix(h, e.ypos);
    for (let v = 0; v < 8; ++v) h = mix(h, e.values[v]);
    h = mix(h, e.scale); h = mix(h, e.rotation); h = mix(h, e.animationTimer); h = mix(h, e.animationSpeed);
    h = mix(h, e.type); h = mix(h, e.propertyValue); h = mix(h, e.state); h = mix(h, e.priority);
    h = mix(h, e.drawOrder); h = mix(h, e.direction); h = mix(h, e.inkEffect); h = mix(h, e.alpha);
    h = mix(h, e.animation); h = mix(h, e.prevAnimation); h = mix(h, e.frame);
  }
  return h;
}

function hashPlayers(E: Engine3): number {
  let h = 0;
  for (let p = 0; p < PLAYER_COUNT; ++p) {
    const pl = E.playerList[p];
    const f = [pl.entityNo, pl.xpos, pl.ypos, pl.xvel, pl.yvel, pl.speed, pl.screenXPos, pl.screenYPos, pl.angle, pl.timer, pl.lookPos,
      ...pl.values, pl.collisionMode, pl.skidding, pl.pushing, pl.collisionPlane, pl.controlMode, pl.controlLock, pl.topSpeed,
      pl.acceleration, pl.deceleration, pl.airAcceleration, pl.airDeceleration, pl.gravityStrength, pl.jumpStrength, pl.jumpCap,
      pl.rollingAcceleration, pl.rollingDeceleration, pl.visible, pl.tileCollisions, pl.objectInteractions, pl.left, pl.right, pl.up,
      pl.down, pl.jumpPress, pl.jumpHold, pl.followPlayer1, pl.trackScroll, pl.gravity, pl.water, pl.getFlailing(0), pl.getFlailing(1), pl.getFlailing(2)];
    for (const v of f) h = mix(h, v);
  }
  return h;
}

function hashGlobals(E: Engine3): number {
  let h = 0;
  for (let i = 0; i < E.globalVariableNames.length; ++i) h = mix(h, E.globalVariables[i]);
  return h;
}

const vfs = new Vfs();
vfs.addPak(new Uint8Array(fs.readFileSync(path.join(dataDir, "soniccd", "core.pak"))));
const host = { log() {}, playSfx() {}, stopSfx() {}, setSfxAttributes() {}, setMusicTrack() {}, playMusic() {}, stopMusic() {}, pauseMusic() {}, resumeMusic() {}, swapMusicTrack() {}, setMusicVolume() {} };
const sim = new GameSim3(vfs, host, { headless: true, players: 1 });
const E = sim.E;
sim.startStage(+listArg, +posArg, +plrArg);
const out: string[] = [];
for (let f = 0; f < +framesArg; f++) {
  sim.tick([inputs[f] ?? 0]);
  const p = E.playerList[0];
  const b = E.objectEntityList[p.boundEntity];
  out.push(`f${f} mode=${E.gameMode}/${E.stageMode} list=${E.activeStageList}/${E.stageListPosition} p0=${p.xpos},${p.ypos} v=${p.xvel},${p.yvel} spd=${p.speed} ang=${p.angle} grav=${p.gravity} cm=${p.collisionMode} st=${b.state} anim=${b.animation} fr=${b.frame} cam=${E.xScrollOffset},${E.yScrollOffset} rng=${E.rngState} ent=${hex(hashEntities(E))} plr=${hex(hashPlayers(E))} glb=${hex(hashGlobals(E))}`);
}
console.log(out.join("\n"));
