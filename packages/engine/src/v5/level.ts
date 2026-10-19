import { Vfs } from "../core/pak.js";
import type { V5CollisionMask } from "./collision.js";
import type { V5Object } from "./gameplay.js";
import type { V5RenderData } from "./render.js";
import { validateV5Collapses } from "./collapse.js";

export interface V5SpriteFrame {
  x: number; y: number; width: number; height: number; pivotX: number; pivotY: number; duration: number;
}
export interface V5Sprite {
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: Uint8Array;
  animations: { name: string; speed: number; loopIndex: number; frames: V5SpriteFrame[] }[];
}
export interface V5Level extends V5RenderData {
  title: string;
  collision: V5CollisionMask[][];
  collisionLayers: number[];
  spawns: { x: number; y: number }[];
  deathY: number;
  objects: V5Object[];
  unsupported: { name: string; count: number }[];
  sprites: V5Sprite[];
  objectSprites: V5Sprite[];
  missingAssets: string[];
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid v5 level metadata object");
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("invalid v5 level metadata array");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 255) throw new Error("invalid v5 level metadata text");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error("invalid v5 level metadata integer");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("invalid v5 level metadata boolean");
  return value;
}
const coordinate = (value: unknown) => integer(value, -0x70000000, 0x70000000);

/** Experimental offline-export format. Assets stay local; there is no native v5 executable in this pack. */
export function readV5Level(bytes: Uint8Array): V5Level {
  if (bytes.length < 12 || bytes.length > 32 * 1024 * 1024) throw new Error("invalid v5 level pack length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x4b504c52 || view.getUint32(4, true) !== 1) throw new Error("invalid v5 level pack header");
  const count = view.getUint32(8, true), header = 12 + count * 24;
  if (count > 1024 || header > bytes.length) throw new Error("invalid v5 level pack table");
  const hashes = new Set<string>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 24, offset = view.getUint32(at + 16, true), length = view.getUint32(at + 20, true);
    const hash = [...bytes.subarray(at, at + 16)].join(",");
    if (hashes.has(hash) || offset < header || offset > bytes.length || length > bytes.length - offset) {
      throw new Error("invalid v5 level pack entry");
    }
    hashes.add(hash);
  }
  const vfs = new Vfs(); vfs.addPak(bytes);
  function file(name: string, length?: number): Uint8Array {
    const data = vfs.get(name);
    if (!data || (length !== undefined && data.length !== length)) throw new Error(`missing or invalid v5 level resource: ${name}`);
    return Uint8Array.from(data);
  }
  const meta = record(JSON.parse(new TextDecoder().decode(file("meta.json"))));
  if (meta.version !== 6) throw new Error("unsupported v5 level metadata version; re-export the experimental pack");
  const layers = array(meta.layers, 255).map((value, index) => {
    const layer = record(value), width = integer(layer.width, 0, 65535), height = integer(layer.height, 0, 65535);
    if (width * height > 4 * 1024 * 1024) throw new Error("v5 level layer is too large");
    const data = file(`layer${index}.bin`, width * height * 2), dv = new DataView(data.buffer);
    return { width, height, visible: bool(layer.visible), drawGroup: integer(layer.drawGroup, 0, 255),
      tiles: Uint16Array.from({ length: width * height }, (_, i) => dv.getUint16(i * 2, true)) };
  });
  const collision = [0, 1].map((plane) => {
    const data = file(`collision${plane}.bin`, 1024 * 38);
    return Array.from({ length: 1024 }, (_, i) => {
      const p = i * 38;
      if (data[p + 32] > 1) throw new Error("invalid v5 collision mask direction");
      return { heights: data.slice(p, p + 16), solid: data.slice(p + 16, p + 32), direction: data[p + 32],
        floorAngle: data[p + 33], leftWallAngle: data[p + 34], rightWallAngle: data[p + 35], roofAngle: data[p + 36], flags: data[p + 37] };
    });
  });
  const spawns = array(meta.spawns, 2).map((value) => {
    const spawn = record(value); return { x: coordinate(spawn.x), y: coordinate(spawn.y) };
  });
  if (!spawns.length) throw new Error("v5 level has no player spawn");
  const collisionLayers = array(meta.collisionLayers, layers.length).map((value) => integer(value, 0, layers.length - 1));
  if (!collisionLayers.length) throw new Error("v5 level has no collision layers");
  const objects = array(meta.objects, 65535).map((value): V5Object => {
    const o = record(value), base = { id: integer(o.id, 0, 65535), x: coordinate(o.x), y: coordinate(o.y),
      plane: o.plane === null ? null : integer(o.plane, 0, 1) };
    switch (o.kind) {
      case "ring": case "checkpoint": return { ...base, kind: o.kind };
      case "fling-ramp": return { ...base, kind: "fling-ramp", direction: integer(o.direction, 0, 2) };
      case "water": {
        if (base.plane !== null) throw new Error("unsupported v5 water volumes");
        return { ...base, kind: "water" };
      }
      case "spring": return { ...base, kind: "spring", vx: integer(o.vx, -16 * 65536, 16 * 65536),
        vy: integer(o.vy, -16 * 65536, 16 * 65536), ...(o.onGround === undefined ? {} : { onGround: bool(o.onGround) }) };
      case "spikes": return { ...base, kind: "spikes", direction: integer(o.direction, 0, 3), count: integer(o.count, 2, 64),
        moving: bool(o.moving), stagger: integer(o.stagger, 0, 1), timer: integer(o.timer, 0, 63) };
      case "platform": return { ...base, kind: "platform", amplitudeX: integer(o.amplitudeX, -256 * 65536, 256 * 65536),
        amplitudeY: integer(o.amplitudeY, -256 * 65536, 256 * 65536), speed: integer(o.speed, 0, 8), phase: integer(o.phase, 0, 1023),
        halfWidth: integer(o.halfWidth, 1, 1024), top: integer(o.top, -1024, 1024), sprite: integer(o.sprite, 0, 255) };
      case "monitor": return { ...base, kind: "monitor", item: integer(o.item, 0, 9), sprite: integer(o.sprite, 0, 255) };
      case "rock": {
        const top = integer(o.top, -1024, 1024), bottom = integer(o.bottom, -1024, 1024);
        if (top >= bottom) throw new Error("invalid v5 rock hitbox");
        return { ...base, kind: "rock", halfWidth: integer(o.halfWidth, 1, 1024), top, bottom,
          smashTop: bool(o.smashTop), smashSides: bool(o.smashSides), restricted: bool(o.restricted),
          sprite: integer(o.sprite, 0, 255), frame: integer(o.frame, 0, 2) };
      }
      case "cyclone": case "saruder": case "tulippon": {
        const facing = integer(o.facing, -1, 1);
        if (facing !== -1 && facing !== 1) throw new Error("invalid v5 enemy direction");
        return { ...base, kind: o.kind, facing, sprite: integer(o.sprite, 0, 255) };
      }
      case "block": return { ...base, kind: "block", halfWidth: integer(o.halfWidth, 1, 2048), halfHeight: integer(o.halfHeight, 1, 2048),
        ignoreTop: bool(o.ignoreTop), ignoreBottom: bool(o.ignoreBottom), ignoreLeft: bool(o.ignoreLeft), ignoreRight: bool(o.ignoreRight) };
      case "collapse": return { ...base, kind: "collapse", width: integer(o.width, 16, 512), height: integer(o.height, 16, 512),
        layer: integer(o.layer, 0, layers.length - 1), direction: integer(o.direction, 0, 1) === 0 ? 0 : 1,
        delay: integer(o.delay, 0, 3600), respawn: bool(o.respawn) };
      case "swing-rope": return { ...base, kind: "swing-rope", links: integer(o.links, 1, 32), phase: integer(o.phase, 0, 511),
        sprite: integer(o.sprite, 0, 255) };
      case "plane-switch": return { ...base, kind: "plane-switch", flags: integer(o.flags, 0, 15), size: integer(o.size, 1, 1024),
        angle: integer(o.angle, 0, 255), onPath: bool(o.onPath) };
      case "hazard": return { ...base, kind: "hazard", halfWidth: integer(o.halfWidth, 1, 1024), halfHeight: integer(o.halfHeight, 1, 1024) };
      default: throw new Error("unsupported v5 gameplay object kind");
    }
  });
  if (new Set(objects.map((o) => o.id)).size !== objects.length) throw new Error("duplicate v5 gameplay object id");
  if (objects.filter((object) => object.kind === "water").length > 1) throw new Error("unsupported v5 water volumes");
  const collapsing = objects.filter((object) => object.kind === "collapse");
  validateV5Collapses(collapsing, layers);
  if (collapsing.some((object) => !collisionLayers.includes(object.layer))) throw new Error("v5 collapse layer has no collision");
  const color = record(meta.background);
  const readSprites = (values: unknown, prefix: string, max: number): V5Sprite[] => array(values, max).map((value, spriteIndex): V5Sprite => {
    const sprite = record(value), width = integer(sprite.width, 1, 4096), height = integer(sprite.height, 1, 4096);
    return {
      name: text(sprite.name), width, height, pixels: file(`${prefix}${spriteIndex}.bin`, width * height), palette: file(`${prefix}${spriteIndex}.rgb`, 768),
      animations: array(sprite.animations, 256).map((value) => {
        const animation = record(value), frames = array(animation.frames, 65535).map((value) => {
          const frame = record(value);
          const x = integer(frame.x, 0, width), y = integer(frame.y, 0, height);
          return { x, y, width: integer(frame.width, 0, width - x), height: integer(frame.height, 0, height - y),
            pivotX: integer(frame.pivotX, -32768, 32767), pivotY: integer(frame.pivotY, -32768, 32767),
            duration: integer(frame.duration, 1, 65535) };
        });
        if (!frames.length) throw new Error("v5 sprite animation has no frames");
        return { name: text(animation.name), speed: integer(animation.speed, 0, 32767),
          loopIndex: integer(animation.loopIndex, 0, frames.length - 1), frames };
      }),
    };
  });
  const sprites = readSprites(meta.sprites, "sprite", 2), objectSprites = readSprites(meta.objectSprites, "objectSprite", 256);
  if (objects.some((object) => object.kind === "platform" && !objectSprites[object.sprite]?.animations[0]?.frames.length)) {
    throw new Error("missing v5 platform sprite");
  }
  if (objects.some((object) => object.kind === "monitor" && ["Normal", "Broken", "Powerups"].some((name) =>
    !objectSprites[object.sprite]?.animations.find((a) => a.name === name)?.frames[name === "Powerups" ? object.item : 0]))) {
    throw new Error("missing v5 item-box sprite");
  }
  if (objects.some((object) => object.kind === "rock"
    && !objectSprites[object.sprite]?.animations.find((a) => a.name === "Rocks")?.frames[object.frame])) {
    throw new Error("missing v5 rock sprite");
  }
  for (const object of objects) {
    const required = object.kind === "cyclone" ? ["Main", "Turning"]
      : object.kind === "saruder" ? ["Body", "Tail", "Arm", "Hand", "Coconut"]
      : object.kind === "tulippon" ? ["Idle", "Firing", "Spike"]
      : object.kind === "swing-rope" ? ["Rope", "Handle", "Pivot"] : null;
    if (required && (!("sprite" in object) || required.some((name) =>
      !objectSprites[object.sprite]?.animations.find((a) => a.name === name)?.frames.length))) {
      throw new Error("missing v5 enemy sprite");
    }
  }
  return { title: text(meta.title), layers, collision, collisionLayers, spawns, deathY: coordinate(meta.deathY), objects,
    unsupported: array(meta.unsupported, 65535).map((value) => {
      const entry = record(value); return { name: text(entry.name), count: integer(entry.count, 1, 65535) };
    }),
    pixels: file("tiles.bin", 1024 * 256), palette: file("palette.rgb", 768), sprites, objectSprites,
    missingAssets: array(meta.missingAssets, 65535).map(text),
    background: { r: integer(color.r, 0, 255), g: integer(color.g, 0, 255), b: integer(color.b, 0, 255) } };
}
