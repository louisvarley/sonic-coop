// Static asset preview only, not gameplay. Output is derived from the user's own archive; never commit it.
// npm run preview:sonic3 -- [archive] [scene path] [output PNG] [world x] [world y]
// Defaults to a 960x540 viewport around Angel Island Act 1's player marker.
import fs from "node:fs";
import path from "node:path";
import { RsdkV5Archive } from "./rsdkv5.js";
import { readRsdkV5GameConfig } from "./rsdkv5-config.js";
import { loadRsdkV5Stage } from "./rsdkv5-stage.js";
import { renderRsdkV5Stage } from "./rsdkv5-render.js";
import { writePng } from "./png.js";

try {
  const [source = "Sonic3ku.rsdk", scenePath = "Data/Stages/3K_AIZ1/Scene1.bin",
    output = path.join("data", "sonic3", "preview.png"), xArg, yArg, ...extra] = process.argv.slice(2);
  if (extra.length || (xArg === undefined) !== (yArg === undefined) || xArg?.trim() === "" || yArg?.trim() === "") {
    throw new Error("usage: npm run preview:sonic3 -- [archive] [scene path] [output PNG] [world x] [world y]");
  }
  const archive = new RsdkV5Archive(fs.readFileSync(source));
  const game = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
  const stage = loadRsdkV5Stage(archive, game, scenePath);
  const player = stage.scene.objects.find((_, index) => stage.objectNames[index] === "Player")?.entities[0];
  if (!player && xArg === undefined) throw new Error("scene has no player marker; provide explicit world x and y");
  const width = 960, height = 540;
  const x = xArg === undefined ? Math.max(0, Math.floor(player!.x / 65536) - width / 2) : Number(xArg);
  const y = yArg === undefined ? Math.max(0, Math.floor(player!.y / 65536) - height / 2) : Number(yArg);
  const rgba = renderRsdkV5Stage(stage, game, { x, y, width, height });
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  writePng(output, width, height, rgba);
  console.log(JSON.stringify({ output, scene: scenePath, playable: false, preview: "static tiles only",
    viewport: { x, y, width, height }, collisionPaths: stage.collision?.length ?? 0,
    unresolvedObjects: stage.scene.objects.filter((_, index) => stage.objectNames[index] === null).map((object) => object.hash),
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
