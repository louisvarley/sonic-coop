// Inspect local assets only; this does not make the archive playable in the RSDKv4 engine.
// npm run inspect:sonic3 -- [archive path] [asset path]
// The default reads GameConfig.bin; pass a discovered Scene*.bin path for stage resources and layer/entity metadata.
import fs from "node:fs";
import { RsdkV5Archive } from "./rsdkv5.js";
import { readRsdkV5GameConfig } from "./rsdkv5-config.js";
import { loadRsdkV5Stage } from "./rsdkv5-stage.js";
import { readRsdkV5Animation } from "./rsdkv5-animation.js";

try {
  const [, , source = "Sonic3ku.rsdk", asset = "Data/Game/GameConfig.bin", ...extra] = process.argv;
  if (extra.length) throw new Error("usage: npm run inspect:sonic3 -- [archive path] [asset path]");
  const bytes = fs.readFileSync(source);
  const archive = new RsdkV5Archive(bytes);
  const data = archive.read(asset);
  const config = asset.replace(/\\/g, "/").toLowerCase() === "data/game/gameconfig.bin"
    ? readRsdkV5GameConfig(data)
    : null;
  const stage = Buffer.from(data.subarray(0, 4)).toString("hex") === "53434e00"
    ? loadRsdkV5Stage(archive, readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin")), asset) : null;
  const scene = stage?.scene;
  const animation = Buffer.from(data.subarray(0, 4)).toString("hex") === "53505200" ? readRsdkV5Animation(data) : null;
  console.log(JSON.stringify({
    source,
    format: "RSDKv5",
    playable: false,
    bytes: bytes.length,
    files: archive.files.length,
    encryptedFiles: archive.files.filter((file) => file.encrypted).length,
    asset: { path: asset, bytes: data.length, headerHex: Buffer.from(data.subarray(0, 16)).toString("hex") },
    ...(config ? {
      gameConfig: {
        title: config.title,
        subtitle: config.subtitle,
        version: config.version,
        startCategory: config.startCategory,
        startScene: config.startScene,
        objectCount: config.objects.length,
        soundFXCount: config.soundFX.length,
        availableSoundFX: config.soundFX.filter((sound) => archive.has(`Data/SoundFX/${sound.path}`)).length,
        missingSoundFX: config.soundFX.filter((sound) => !archive.has(`Data/SoundFX/${sound.path}`)).map((sound) => sound.path),
        categories: config.categories.map((category) => ({
          name: category.name,
          scenes: category.scenes.map((scene) => {
            const scenePath = `Data/Stages/${scene.folder}/Scene${scene.id}.bin`;
            return { ...scene, path: scenePath, present: archive.has(scenePath) };
          }),
        })),
        globalVariableCount: config.globalVariables.length,
      },
    } : {}),
    ...(stage && scene ? {
      scene: {
        stampName: scene.editor.stampName,
        layers: scene.layers.map((layer) => ({
          name: layer.name, type: layer.type, width: layer.width, height: layer.height,
          tileCount: layer.tiles.length, scrollInfoCount: layer.scrolling.length,
        })),
        objects: scene.objects.map((object, index) => ({
          hash: object.hash, name: stage.objectNames[index], variableCount: object.variables.length, entityCount: object.entities.length,
        })),
        entityCount: scene.objects.reduce((count, object) => count + object.entities.length, 0),
      },
    } : {}),
    ...(stage ? {
      stage: {
        loadGlobalObjects: stage.config.loadGlobalObjects,
        objectCount: stage.config.objects.length,
        tiles: stage.tileset.pixels.length / 256,
        collisionPaths: stage.collision?.length ?? 0,
        collisionTilesPerPath: stage.collision?.[0].length ?? 0,
        unresolvedObjects: stage.objectNames.filter((name) => name === null).length,
        soundFXCount: stage.config.soundFX.length,
        missingSoundFX: stage.config.soundFX.filter((sound) => !archive.has(`Data/SoundFX/${sound.path}`)).map((sound) => sound.path),
      },
    } : {}),
    ...(animation ? {
      animation: {
        sheets: animation.sheets.map((path) => ({ path, present: archive.has(`Data/Sprites/${path}`) })),
        hitboxTypes: animation.hitboxTypes,
        animations: animation.animations.map(({ name, speed, loopIndex, rotationStyle, frames }) => ({
          name, speed, loopIndex, rotationStyle, frameCount: frames.length,
          unresolvedSheetFrames: frames.flatMap((frame, index) => frame.sheet >= animation.sheets.length ? [index] : []),
        })),
      },
    } : {}),
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
