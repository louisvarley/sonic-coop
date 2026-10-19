// Offline experimental Angel Island export; source data and output must never be committed.
// npm run export:sonic3 -- [archive] [output pack]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { RsdkV5Archive } from "./rsdkv5.js";
import { readRsdkV5GameConfig } from "./rsdkv5-config.js";
import { loadRsdkV5Stage } from "./rsdkv5-stage.js";
import { readRsdkV5Animation } from "./rsdkv5-animation.js";
import { readRsdkV5Gif } from "./rsdkv5-tileset.js";
import { writePak, type PakEntry } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";
import { readV5Level, type V5Sprite } from "../packages/engine/src/v5/level.js";
import type { V5Object } from "../packages/engine/src/v5/gameplay.js";

export function exportV5AngelIsland(archive: RsdkV5Archive): Uint8Array {
  const game = readRsdkV5GameConfig(archive.read("Data/Game/GameConfig.bin"));
  const stage = loadRsdkV5Stage(archive, game, "Data/Stages/3K_AIZ1/Scene1.bin");
  if (!stage.collision) throw new Error("Angel Island has no collision data");
  const player = stage.scene.objects.find((_, i) => stage.objectNames[i] === "Player")?.entities[0];
  if (!player) throw new Error("Angel Island has no player marker");
  const collisionLayers = stage.scene.layers.flatMap((layer, index) => ["FG Low", "FG High", "Platform"].includes(layer.name) ? [index] : []);
  if (collisionLayers.length !== 3) throw new Error("Angel Island foreground collision layers are missing");
  const entries: PakEntry[] = [];
  const add = (name: string, data: Uint8Array) => entries.push({ key: rsdkPathKey(name), data });
  const palette = Uint8Array.from(stage.tileset.palette);
  for (const bank of [game.palettes[0], stage.config.palettes[0]]) bank.forEach((row, i) => { if (row) palette.set(row, i * 48); });
  add("tiles.bin", stage.tileset.pixels); add("palette.rgb", palette);
  stage.collision.forEach((plane, index) => {
    const data = new Uint8Array(plane.length * 38);
    plane.forEach((mask, i) => {
      const offset = i * 38;
      data.set(mask.heights, offset); data.set(mask.solid, offset + 16);
      data.set([mask.direction, mask.floorAngle, mask.leftWallAngle, mask.rightWallAngle, mask.roofAngle, mask.flags], offset + 32);
    });
    add(`collision${index}.bin`, data);
  });
  const objects: V5Object[] = [], unsupported = new Map<string, number>();
  const platformAnimation = readRsdkV5Animation(archive.read("Data/Sprites/3K_AIZ/Platform.bin"));
  const platformFrame = platformAnimation.animations[0]?.frames[0], platformHitbox = platformFrame?.hitboxes[0];
  if (!platformFrame || !platformHitbox || platformHitbox.left !== -platformHitbox.right) throw new Error("missing platform sprite or hitbox");
  const platformSheet = readRsdkV5Gif(archive.read(`Data/Sprites/${platformAnimation.sheets[platformFrame.sheet]}`));
  add("objectSprite0.bin", platformSheet.pixels); add("objectSprite0.rgb", platformSheet.palette);
  const objectSprites: Omit<V5Sprite, "pixels" | "palette">[] = [{
    name: "Angel Island platform", width: platformSheet.width, height: platformSheet.height,
    animations: [{ name: "Idle", speed: 0, loopIndex: 0, frames: [{ ...platformFrame, duration: 1 }] }],
  }];
  const monitorAnimation = readRsdkV5Animation(archive.read("Data/Sprites/3K_Global/ItemBox.bin"));
  if (monitorAnimation.sheets.length !== 1) throw new Error("unsupported item-box sprite sheets");
  const monitorSheet = readRsdkV5Gif(archive.read(`Data/Sprites/${monitorAnimation.sheets[0]}`));
  add("objectSprite1.bin", monitorSheet.pixels); add("objectSprite1.rgb", monitorSheet.palette);
  objectSprites.push({ name: "Item box", width: monitorSheet.width, height: monitorSheet.height,
    animations: ["Normal", "Broken", "Powerups"].map((name) => {
      const animation = monitorAnimation.animations.find((a) => a.name === name);
      if (!animation?.frames.length || animation.frames.some((f) => f.sheet !== 0)) throw new Error(`missing item-box ${name} frames`);
      return { name, speed: 0, loopIndex: 0, frames: animation.frames.map((frame) => ({ ...frame, duration: Math.max(1, frame.duration) })) };
    }) });
  const enemySprites = new Map<string, number>();
  for (const name of ["Cyclone", "Saruder", "Tulippon"]) {
    const animation = readRsdkV5Animation(archive.read(`Data/Sprites/3K_AIZ/${name}.bin`));
    if (animation.sheets.length !== 1 || animation.animations.some((a) => !a.frames.length || a.frames.some((f) => f.sheet !== 0))) {
      throw new Error(`unsupported ${name} sprite sheets`);
    }
    const sheet = readRsdkV5Gif(archive.read(`Data/Sprites/${animation.sheets[0]}`)), index = objectSprites.length;
    add(`objectSprite${index}.bin`, sheet.pixels); add(`objectSprite${index}.rgb`, sheet.palette);
    enemySprites.set(name, index);
    objectSprites.push({ name, width: sheet.width, height: sheet.height,
      animations: animation.animations.map((a) => ({ name: a.name, speed: a.speed, loopIndex: a.loopIndex,
        frames: a.frames.map((f) => ({ ...f, duration: Math.max(1, f.duration) })) })) });
  }
  const ropeAnimation = readRsdkV5Animation(archive.read("Data/Sprites/3K_AIZ/SwingRope.bin"));
  if (ropeAnimation.sheets.length !== 1) throw new Error("unsupported swing-rope sprite sheets");
  const ropeSheet = readRsdkV5Gif(archive.read(`Data/Sprites/${ropeAnimation.sheets[0]}`)), ropeSprite = objectSprites.length;
  add(`objectSprite${ropeSprite}.bin`, ropeSheet.pixels); add(`objectSprite${ropeSprite}.rgb`, ropeSheet.palette);
  objectSprites.push({ name: "Swing rope", width: ropeSheet.width, height: ropeSheet.height,
    animations: ["Rope", "Handle", "Pivot"].map((name) => {
      const animation = ropeAnimation.animations.find((a) => a.name === name);
      if (!animation?.frames.length || animation.frames.some((f) => f.sheet !== 0)) throw new Error(`missing swing-rope ${name} sprite`);
      return { name, speed: 0, loopIndex: 0, frames: animation.frames.map((frame) => ({ ...frame, duration: Math.max(1, frame.duration) })) };
    }) });
  const rockFrames = platformAnimation.animations[0]?.frames.slice(3, 6), rockSprite = objectSprites.length;
  if (rockFrames?.length !== 3 || rockFrames.some((frame) => frame.sheet !== platformFrame.sheet
    || !frame.hitboxes[1] || frame.hitboxes[1].left !== -frame.hitboxes[1].right)) throw new Error("missing rock pile sprites or hitboxes");
  add(`objectSprite${rockSprite}.bin`, platformSheet.pixels); add(`objectSprite${rockSprite}.rgb`, platformSheet.palette);
  objectSprites.push({ name: "Angel Island rock piles", width: platformSheet.width, height: platformSheet.height,
    animations: [{ name: "Rocks", speed: 0, loopIndex: 0, frames: rockFrames.map((frame) => ({ ...frame, duration: 1 })) }] });
  const hash = (name: string) => createHash("md5").update(name).digest("hex");
  stage.scene.objects.forEach((object, index) => {
    const name = stage.objectNames[index] ?? object.hash;
    const fields = new Map(object.variables.map((v, i) => [v.hash, i]));
    for (const entity of object.entities) {
      const get = (name: string) => {
        const at = fields.get(hash(name));
        if (at === undefined) throw new Error(`missing ${name} variable in ${stage.objectNames[index]}`);
        return entity.values[at];
      };
      const base = { id: entity.slot, x: entity.x, y: entity.y, plane: null };
      if (name === "Ring" && get("type") === 0 && get("planeFilter") === 0 && get("speed") === 0) {
        objects.push({ ...base, kind: "ring" });
      } else if (name === "StarPost") {
        objects.push({ ...base, kind: "checkpoint" });
      } else if (name === "Water" && get("type") === 0) {
        objects.push({ ...base, kind: "water" });
      } else if (name === "FlingRamp") {
        const direction = get("direction");
        if (typeof direction !== "number") throw new Error("invalid fling ramp direction");
        objects.push({ ...base, kind: "fling-ramp", direction });
      } else if (name === "Spring") {
        const type = get("type"), flip = get("flipFlag"), filter = get("planeFilter"), onGround = get("onGround");
        if (typeof type !== "number" || typeof flip !== "number" || typeof filter !== "number" || typeof onGround !== "boolean"
          || ![type, flip, filter].every(Number.isInteger) || type < 0 || type > 5 || flip < 0 || flip > 3 || filter < 0 || filter > 4) {
          throw new Error("invalid spring parameters");
        }
        const speed = type < 4 ? (type & 1 ? 16 : 10) * 65536 : type & 1 ? 0xb4000 : 0x74000;
        objects.push({ ...base, kind: "spring", plane: filter ? (filter - 1) & 1 : null, onGround,
          vx: type < 2 ? 0 : speed * (type < 4 ? (flip ? -1 : 1) : (flip & 1 ? -1 : 1)),
          vy: type >= 2 && type < 4 ? 0 : speed * (type < 2 ? (flip ? 1 : -1) : (flip & 2 ? 1 : -1)) });
      } else if (name === "Spikes") {
        const direction = get("type"), count = get("count"), moving = get("moving"), stagger = get("stagger"),
          timer = get("timer"), filter = get("planeFilter");
        if (typeof direction !== "number" || typeof count !== "number" || typeof moving !== "boolean"
          || typeof stagger !== "number" || typeof timer !== "number" || typeof filter !== "number"
          || ![direction, count, stagger, timer, filter].every(Number.isInteger)
          || direction < 0 || direction > 3 || count < 0 || count > 64 || stagger < 0 || stagger > 1
          || timer < 0 || timer > 63 || filter < 0 || filter > 4) throw new Error("invalid spike parameters");
        objects.push({ ...base, kind: "spikes", plane: filter ? (filter - 1) & 1 : null,
          direction, count: Math.max(2, count), moving, stagger, timer });
      } else if (name === "PlaneSwitch") {
        const flags = get("flags"), size = get("size"), angle = get("angle"), onPath = get("onPath");
        if (typeof flags !== "number" || typeof size !== "number" || typeof angle !== "number"
          || ![flags, size, angle].every(Number.isInteger) || flags < 0 || flags > 15 || size < 1 || size > 1024
          || angle < 0 || angle > 255 || (onPath !== 0 && onPath !== 1 && typeof onPath !== "boolean")) {
          throw new Error("invalid plane switch");
        }
        objects.push({ ...base, kind: "plane-switch", flags, size, angle, onPath: !!onPath });
      } else if (name === "Platform" && get("type") === 2 && get("collision") === 0 && get("frameID") === 0
        && get("hasTension") === false && get("childCount") === 0) {
        const amplitude = get("amplitude"), speed = get("speed"), phase = get("angle");
        if (typeof amplitude !== "object" || amplitude === null || !("x" in amplitude) || !("y" in amplitude)
          || typeof amplitude.x !== "number" || typeof amplitude.y !== "number"
          || typeof speed !== "number" || typeof phase !== "number"
          || ![amplitude.x, amplitude.y, speed, phase].every(Number.isInteger)
          || Math.abs(amplitude.x) > 256 * 65536 || Math.abs(amplitude.y) > 256 * 65536
          || speed < 0 || speed > 8 || phase < 0 || phase > 1023) throw new Error("invalid linear platform");
        objects.push({ ...base, kind: "platform", amplitudeX: amplitude.x, amplitudeY: amplitude.y, speed, phase,
          halfWidth: platformHitbox.right, top: platformHitbox.top, sprite: 0 });
      } else if (name === "ItemBox" && get("isFalling") === false && get("hidden") === false && get("direction") === 0) {
        const item = get("type"), filter = get("planeFilter");
        if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 9
          || typeof filter !== "number" || !Number.isInteger(filter) || filter < 0 || filter > 4) throw new Error("invalid item box");
        objects.push({ ...base, kind: "monitor", plane: filter ? (filter - 1) & 1 : null, item, sprite: 1 });
      } else if (name === "InvisibleBlock" && get("hurtType") === 0 && get("timeAttackOnly") === false) {
        const width = get("width"), height = get("height"), filter = get("planeFilter"),
          ignoreTop = get("ignoreTop"), ignoreBottom = get("ignoreBottom"), ignoreLeft = get("ignoreLeft"), ignoreRight = get("ignoreRight");
        if (typeof width !== "number" || typeof height !== "number" || typeof filter !== "number"
          || ![width, height, filter].every(Number.isInteger) || width < 0 || width > 255 || height < 0 || height > 255
          || filter < 0 || filter > 4 || typeof ignoreTop !== "boolean" || typeof ignoreBottom !== "boolean"
          || typeof ignoreLeft !== "boolean" || typeof ignoreRight !== "boolean") throw new Error("invalid invisible block");
        objects.push({ ...base, kind: "block", plane: filter ? (filter - 1) & 1 : null,
          halfWidth: (width + 1) * 8, halfHeight: (height + 1) * 8, ignoreTop, ignoreBottom, ignoreLeft, ignoreRight });
      } else if (name === "AIZRockPile" && entity.values[fields.get("630a89b56ef776f4df20a4b98b2ff73e") ?? -1] === 0) {
        const size = get("size"), smashTop = get("smashTop"), smashSides = get("smashSides"),
          onlyKnux = get("onlyKnux"), onlyMighty = get("onlyMighty");
        if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > 2
          || typeof smashTop !== "boolean" || typeof smashSides !== "boolean"
          || typeof onlyKnux !== "boolean" || typeof onlyMighty !== "boolean") throw new Error("invalid rock pile parameters");
        const hitbox = rockFrames[size].hitboxes[1];
        objects.push({ ...base, kind: "rock", halfWidth: hitbox.right, top: hitbox.top, bottom: hitbox.bottom,
          smashTop, smashSides, restricted: onlyKnux || onlyMighty, sprite: rockSprite, frame: size });
      } else if (name === "Cyclone" || name === "Saruder" || name === "Tulippon") {
        const direction = name === "Tulippon" ? 0 : get("direction"), sprite = enemySprites.get(name);
        if ((direction !== 0 && direction !== 1) || sprite === undefined) throw new Error(`invalid ${name} enemy`);
        objects.push({ ...base, kind: name === "Cyclone" ? "cyclone" : name === "Saruder" ? "saruder" : "tulippon",
          facing: direction ? 1 : -1, sprite });
      } else if (name === "CollapsingPlatform" && get("eventOnly") === false && get("mightyOnly") === false) {
        const size = get("size"), direction = get("type"), delay = get("delay"), respawn = get("respawn");
        // This build stores an explicit scene-layer index instead of Mania's low/high layer enum.
        const layerAt = fields.get("b17d223fc444076be96b33d8c14ddaf6"), layer = layerAt === undefined ? undefined : entity.values[layerAt];
        if (typeof size !== "object" || size === null || !("x" in size) || !("y" in size)
          || typeof size.x !== "number" || typeof size.y !== "number" || (direction !== 0 && direction !== 1)
          || typeof delay !== "number" || typeof respawn !== "boolean" || typeof layer !== "number"
          || stage.scene.layers[layer]?.name !== "Platform") throw new Error("unsupported collapsing platform parameters");
        objects.push({ ...base, x: Math.floor(base.x / 0x80000) * 0x80000, y: Math.floor(base.y / 0x80000) * 0x80000,
          kind: "collapse", width: size.x / 65536, height: size.y / 65536, layer, direction, delay, respawn });
      } else if (name === "SwingRope") {
        const links = get("ropeSize"), phase = get("angleOffset");
        if (typeof links !== "number" || typeof phase !== "number") throw new Error("invalid swing rope parameters");
        objects.push({ ...base, kind: "swing-rope", links, phase, sprite: ropeSprite });
      } else if (name !== "Player" && name !== "Blank Object") unsupported.set(name, (unsupported.get(name) ?? 0) + 1);
    }
  });
  const layers = stage.scene.layers.map((layer, index) => {
    if (layer.name !== "Platform") return layer;
    // The hidden source layer is object-owned. Expose only geometry with implemented runtime behavior.
    const tiles = new Uint16Array(layer.tiles.length).fill(0xffff);
    for (const object of objects) if (object.kind === "collapse" && object.layer === index) {
      const left = Math.floor(object.x / 65536 / 16) - Math.floor(object.width / 32);
      const top = Math.floor(object.y / 65536 / 16) - Math.floor(object.height / 32);
      for (let y = 0; y < object.height / 16; y++) for (let x = 0; x < object.width / 16; x++) {
        const at = (top + y) * layer.width + left + x; tiles[at] = layer.tiles[at];
      }
    }
    return { ...layer, visible: true, tiles };
  });
  layers.forEach((layer, index) => {
    const data = new Uint8Array(layer.tiles.length * 2), view = new DataView(data.buffer);
    layer.tiles.forEach((tile, i) => view.setUint16(i * 2, tile, true));
    add(`layer${index}.bin`, data);
  });
  const sprites = ["Sonic", "Tails"].map((name, index): Omit<V5Sprite, "pixels" | "palette"> => {
    const animation = readRsdkV5Animation(archive.read(`Data/Sprites/3K_Players/${name}.bin`));
    if (animation.sheets.length !== 1) throw new Error(`expected one sheet for experimental ${name} renderer`);
    const sheet = readRsdkV5Gif(archive.read(`Data/Sprites/${animation.sheets[0]}`));
    add(`sprite${index}.bin`, sheet.pixels);
    // This standalone experiment has no character palette-swapping logic; preserve the sheet's own colors.
    add(`sprite${index}.rgb`, sheet.palette);
    const selectedAnimations = ["Idle", "Walk", "Jump", "Crouch", "Spindash", "HangGimmick", ...(name === "Tails" ? ["Fly", "Fly Tired"] : [])];
    return { name, width: sheet.width, height: sheet.height, animations: selectedAnimations.map((name) => {
      const entry = animation.animations.find((entry) => entry.name === name);
      if (!entry || !entry.frames.length || entry.frames.some((frame) => frame.sheet !== 0 || frame.duration < 1)) {
        throw new Error(`missing or unsupported ${name} animation`);
      }
      return { name, speed: entry.speed, loopIndex: entry.loopIndex, frames: entry.frames.map((frame) => ({
        x: frame.x, y: frame.y, width: frame.width, height: frame.height, pivotX: frame.pivotX, pivotY: frame.pivotY, duration: frame.duration,
      })) };
    }) };
  });
  const metadata = {
    version: 6, title: "Angel Island Act 1 - experimental", background: stage.scene.editor.background1,
    layers: layers.map(({ width, height, visible, drawGroup }) => ({ width, height, visible, drawGroup })),
    collisionLayers, spawns: [{ x: player.x, y: player.y }, { x: player.x + 32 * 65536, y: player.y }],
    deathY: Math.max(...collisionLayers.map((i) => stage.scene.layers[i].height)) * 16 * 65536 + 128 * 65536,
    objects, unsupported: [...unsupported].map(([name, count]) => ({ name, count })), sprites, objectSprites,
    missingAssets: [...new Set([
      ...[...game.soundFX, ...stage.config.soundFX].map((sound) => `Data/SoundFX/${sound.path}`),
      ...stage.scene.objects.flatMap((object, index) => stage.objectNames[index] === "Music"
        ? object.entities.flatMap((entity) => entity.values.flatMap((value) =>
          typeof value === "string" && /\.(ogg|wav)$/i.test(value) ? [`Data/Music/${value}`] : [])) : []),
    ])].filter((name) => !archive.has(name)),
  };
  add("meta.json", new TextEncoder().encode(JSON.stringify(metadata)));
  const bytes = writePak(entries);
  readV5Level(bytes);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source = "Sonic3ku.rsdk", out = path.join("data", "sonic3", "experimental.pak"), ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("usage: npm run export:sonic3 -- [archive] [output pack]");
    const bytes = exportV5AngelIsland(new RsdkV5Archive(fs.readFileSync(source)));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, bytes);
    const level = readV5Level(bytes);
    console.log(JSON.stringify({ out, bytes: bytes.length, playable: false, experimental: true, objects: level.objects.length,
      unsupported: level.unsupported, missingAssets: level.missingAssets,
      browser: "Open /sonic3.html on the client development server" }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
