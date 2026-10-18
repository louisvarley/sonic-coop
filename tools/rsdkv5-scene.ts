// Binary scene data only, not v5 object behavior or rendering.
// https://github.com/RSDKModding/RetroED/blob/master/RetroEDv2/dependencies/libRSDK/formats/RSDKv5/scenev5.hpp
import { RsdkV5Reader } from "./rsdkv5-reader.js";

export interface RsdkV5Color { r: number; g: number; b: number; a: number }
export type RsdkV5Value = number | boolean | string | { x: number; y: number } | RsdkV5Color;

export interface RsdkV5Layer {
  visible: boolean;
  name: string;
  type: number;
  drawGroup: number;
  width: number;
  height: number;
  parallaxFactor: number;
  scrollSpeed: number;
  scrolling: { parallaxFactor: number; scrollSpeed: number; deform: number; unknown: number }[];
  lineScroll: Uint8Array;
  /** Packed v5 tile words, row-major; flags are preserved rather than interpreted as v4 tiles. */
  tiles: Uint16Array;
}

export interface RsdkV5SceneData {
  editor: { version: number; background1: RsdkV5Color; background2: RsdkV5Color; unknown: Uint8Array; stampName: string; stampType: number };
  layers: RsdkV5Layer[];
  objects: {
    hash: string;
    variables: { hash: string; type: number }[];
    entities: { slot: number; x: number; y: number; values: RsdkV5Value[] }[];
  }[];
}

function color(reader: RsdkV5Reader): RsdkV5Color {
  const b = reader.u8(), g = reader.u8(), r = reader.u8(), a = reader.u8();
  return { r, g, b, a };
}

function variable(reader: RsdkV5Reader, type: number): RsdkV5Value {
  switch (type) {
    case 0: return reader.u8();
    case 1: return reader.u16();
    case 2: return reader.u32();
    case 3: return reader.s8();
    case 4: return reader.s16();
    case 5:
    case 6: return reader.s32();
    case 7: return reader.u32() !== 0;
    case 8: return reader.utf16();
    case 9: return { x: reader.s32(), y: reader.s32() };
    case 10: return reader.f32();
    case 11: return color(reader);
    default: throw new Error(`unsupported RSDKv5 scene variable type: ${type}`);
  }
}

export function readRsdkV5Scene(data: Uint8Array): RsdkV5SceneData {
  const reader = new RsdkV5Reader(data, "RSDKv5 scene");
  if (String.fromCharCode(...reader.bytes(4)) !== "SCN\0") throw new Error("not an RSDKv5 scene");
  // Bound cumulative decompression before allocating from untrusted size headers.
  let budget = 64 * 1024 * 1024;
  function compressed(expected?: number): Uint8Array {
    const output = reader.compressed(expected, budget);
    budget -= output.length;
    return output;
  }
  const editor = {
    version: reader.u8(), background1: color(reader), background2: color(reader),
    unknown: reader.bytes(7), stampName: reader.str(), stampType: reader.u8(),
  };
  const layers = Array.from({ length: reader.u8() }, () => {
    const visible = reader.u8() !== 0, name = reader.str(), type = reader.u8(), drawGroup = reader.u8();
    if (type > 3) throw new Error(`unsupported RSDKv5 layer type: ${type}`);
    const width = reader.u16(), height = reader.u16(), parallaxFactor = reader.s16(), scrollSpeed = reader.s16();
    const scrolling = Array.from({ length: reader.u16() }, () => ({
      parallaxFactor: reader.s16(), scrollSpeed: reader.s16(), deform: reader.u8(), unknown: reader.u8(),
    }));
    const lineScroll = compressed();
    const layout = compressed(width * height * 2);
    const view = new DataView(layout.buffer, layout.byteOffset, layout.byteLength);
    const tiles = Uint16Array.from({ length: width * height }, (_, i) => view.getUint16(i * 2, true));
    return { visible, name, type, drawGroup, width, height, parallaxFactor, scrollSpeed, scrolling, lineScroll, tiles };
  });
  const hash = () => Buffer.from(reader.bytes(16)).toString("hex");
  const objects = Array.from({ length: reader.u8() }, () => {
    const objectHash = hash(), count = reader.u8();
    if (count < 1) throw new Error("RSDKv5 scene object is missing its implicit filter variable");
    const variables = Array.from({ length: count - 1 }, () => {
      const nameHash = hash(), type = reader.u8();
      if (type > 11) throw new Error(`unsupported RSDKv5 scene variable type: ${type}`);
      return { hash: nameHash, type };
    });
    const entities = Array.from({ length: reader.u16() }, () => ({
      slot: reader.u16(), x: reader.s32(), y: reader.s32(), values: variables.map((entry) => variable(reader, entry.type)),
    }));
    return { hash: objectHash, variables, entities };
  });
  if (reader.remaining) throw new Error(`unexpected trailing bytes in RSDKv5 scene: ${reader.remaining}`);
  return { editor, layers, objects };
}
