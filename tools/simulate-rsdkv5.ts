// Headless locomotion experiment, not a playable Sonic 3 implementation.
// npm run simulate:sonic3 -- [archive] [frames: 1..36000]
import fs from "node:fs";
import { createHash } from "node:crypto";
import { RsdkV5Archive } from "./rsdkv5.js";
import { readRsdkV5GameConfig } from "./rsdkv5-config.js";
import { loadRsdkV5Stage } from "./rsdkv5-stage.js";
import { V5CollisionWorld } from "../packages/engine/src/v5/collision.js";
import { V5Movement } from "../packages/engine/src/v5/movement.js";
import { BTN } from "../packages/engine/src/input.js";

try {
  const [source = "Sonic3ku.rsdk", framesArg = "300", ...extra] = process.argv.slice(2);
  const frames = Number(framesArg);
  if (extra.length || !Number.isInteger(frames) || frames < 1 || frames > 36000) {
    throw new Error("usage: npm run simulate:sonic3 -- [archive] [frames: 1..36000]");
  }
  const archive = new RsdkV5Archive(fs.readFileSync(source));
  const config = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
  const stage = loadRsdkV5Stage(archive, config, "Data/Stages/3K_AIZ1/Scene1.bin");
  if (!stage.collision) throw new Error("Angel Island collision data is missing");
  const layers = stage.scene.layers.flatMap((layer, index) => layer.name === "FG Low" || layer.name === "FG High" ? [index] : []);
  if (layers.length !== 2) throw new Error("Angel Island foreground collision layers are missing");
  const player = stage.scene.objects.find((_, index) => stage.objectNames[index] === "Player")?.entities[0];
  if (!player) throw new Error("Angel Island player marker is missing");
  const sim = new V5Movement(new V5CollisionWorld(stage.scene.layers, stage.collision), layers,
    [{ x: player.x, y: player.y }, { x: player.x + 32 * 65536, y: player.y }]);
  const landed = [false, false];
  for (let frame = 0; frame < frames; frame++) {
    sim.tick([frame > 60 ? BTN.RIGHT : 0, frame > 120 ? BTN.RIGHT : 0]);
    sim.capture().players.forEach((player, slot) => { landed[slot] ||= player.grounded; });
  }
  const state = sim.capture();
  console.log(JSON.stringify({
    playable: false, experiment: "upright locomotion only", frames, landed,
    players: state.players.map((player) => ({ ...player, worldX: player.x / 65536, worldY: player.y / 65536 })),
    stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
