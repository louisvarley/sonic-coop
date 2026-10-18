// The engine instance: all of RSDKv4's global state, held per instance so a server can run many rooms.
//
// Everything that affects simulation lives in typed arrays registered with `state` so that a complete game state
// can be captured, compared and restored (rollback, snapshots, reconnection). Scalars are stored in `vars` and
// exposed as accessor properties with their original C names; per-camera scalars live in `cams` and resolve
// against the current camera (`curCam`), which is how one level can have an independent camera per player.

import * as C from "./c.js";
import { Entity, ENT_STRIDE } from "./entity.js";
import type { Vfs } from "./core/pak.js";
import type { ScriptHost } from "./host.js";
import { TextMenu } from "./text.js";
import type { DrawApi } from "./render/api.js";
import { ScriptCompiler } from "./script/compiler.js";
import type { GameConfig } from "./config.js";

export const MAX_PLAYERS = 4;

// ---- scalar state ---------------------------------------------------------------------------------------------
// [name, kind]: i = int, b = bool (stored 0/1), u8 = byte
const SCALARS: [string, "i" | "b" | "u8"][] = [
  ["stageMode", "i"], ["newXBoundary1", "i"], ["newYBoundary1", "i"], ["newXBoundary2", "i"], ["newYBoundary2", "i"],
  ["waterLevel", "i"], ["waterDrawPos", "i"], ["lastXSize", "i"], ["lastYSize", "i"],
  ["pauseEnabled", "b"], ["timeEnabled", "b"], ["debugMode", "b"], ["frameCounter", "i"],
  ["stageMilliseconds", "i"], ["stageSeconds", "i"], ["stageMinutes", "i"],
  ["activeStageList", "i"], ["stageListPosition", "i"], ["actID", "i"], ["titleCardWord2", "u8"], ["tLayerMidPoint", "u8"],
  ["playerListPos", "i"], ["objectEntityPos", "i"], ["curObjectType", "i"],
  ["OBJECT_BORDER_X1", "i"], ["OBJECT_BORDER_X2", "i"], ["OBJECT_BORDER_X3", "i"], ["OBJECT_BORDER_X4", "i"],
  ["fadeMode", "i"], ["fadeA", "u8"], ["fadeR", "u8"], ["fadeG", "u8"], ["fadeB", "u8"], ["paletteMode", "i"],
  ["gameMode", "i"], ["checkResult", "i"], ["scriptFrameCount", "i"],
  ["rngState", "i"], ["trackID", "i"], ["musicStatus", "i"], ["musicVolume", "i"], ["musicPosition", "i"],
  ["vertexCount", "i"], ["faceCount", "i"], ["projectionX", "i"], ["projectionY", "i"], ["fogColor", "i"], ["fogStrength", "i"],
  ["activePaletteID", "i"], ["tick", "i"], ["stageLoadCount", "i"], ["masterFrame", "i"], ["camCount", "i"], ["teleportCooldown", "i"],
];

// Per-camera scalars (one block per camera; `curCam` selects the block the accessors use).
const CAM_SCALARS: [string, "i" | "b"][] = [
  ["cameraTarget", "i"], ["cameraStyle", "i"], ["cameraEnabled", "i"], ["cameraAdjustY", "i"],
  ["xScrollOffset", "i"], ["yScrollOffset", "i"], ["cameraXPos", "i"], ["cameraYPos", "i"], ["cameraShift", "i"],
  ["cameraLockedY", "b"], ["cameraShakeX", "i"], ["cameraShakeY", "i"], ["cameraLag", "i"], ["cameraLagStyle", "i"],
  ["curXBoundary1", "i"], ["curYBoundary1", "i"], ["curXBoundary2", "i"], ["curYBoundary2", "i"],
];
export const CAM_STRIDE = 32;

export interface ScalarVars {
  stageMode: number; newXBoundary1: number; newYBoundary1: number; newXBoundary2: number; newYBoundary2: number;
  waterLevel: number; waterDrawPos: number; lastXSize: number; lastYSize: number;
  pauseEnabled: number; timeEnabled: number; debugMode: number; frameCounter: number;
  stageMilliseconds: number; stageSeconds: number; stageMinutes: number;
  activeStageList: number; stageListPosition: number; actID: number; titleCardWord2: number; tLayerMidPoint: number;
  playerListPos: number; objectEntityPos: number; curObjectType: number;
  OBJECT_BORDER_X1: number; OBJECT_BORDER_X2: number; OBJECT_BORDER_X3: number; OBJECT_BORDER_X4: number;
  fadeMode: number; fadeA: number; fadeR: number; fadeG: number; fadeB: number; paletteMode: number;
  gameMode: number; checkResult: number; scriptFrameCount: number;
  rngState: number; trackID: number; musicStatus: number; musicVolume: number; musicPosition: number;
  vertexCount: number; faceCount: number; projectionX: number; projectionY: number; fogColor: number; fogStrength: number;
  activePaletteID: number; tick: number; stageLoadCount: number; masterFrame: number; camCount: number; teleportCooldown: number;
  // per camera
  cameraTarget: number; cameraStyle: number; cameraEnabled: number; cameraAdjustY: number;
  xScrollOffset: number; yScrollOffset: number; cameraXPos: number; cameraYPos: number; cameraShift: number;
  cameraLockedY: number; cameraShakeX: number; cameraShakeY: number; cameraLag: number; cameraLagStyle: number;
  curXBoundary1: number; curYBoundary1: number; curXBoundary2: number; curYBoundary2: number;
}

export const SCALAR_INDEX: Record<string, number> = {};
SCALARS.forEach(([n], i) => (SCALAR_INDEX[n] = i));
export const CAM_INDEX: Record<string, number> = {};
CAM_SCALARS.forEach(([n], i) => (CAM_INDEX[n] = i));

// ---- structured state ------------------------------------------------------------------------------------------

export class TileLayer {
  readonly tiles = new Uint16Array(C.TILELAYER_CHUNK_COUNT);
  readonly lineScroll = new Uint8Array(C.TILELAYER_LINESCROLL_COUNT);
  /** parallaxFactor, scrollSpeed, scrollPos, angle, xpos, ypos, zpos, deformationOffset, deformationOffsetW, type, xsize, ysize */
  readonly p = new Int32Array(12);
  get parallaxFactor() { return this.p[0]; } set parallaxFactor(v: number) { this.p[0] = v; }
  get scrollSpeed() { return this.p[1]; } set scrollSpeed(v: number) { this.p[1] = v; }
  get scrollPos() { return this.p[2]; } set scrollPos(v: number) { this.p[2] = v; }
  get angle() { return this.p[3]; } set angle(v: number) { this.p[3] = v; }
  get xpos() { return this.p[4]; } set xpos(v: number) { this.p[4] = v; }
  get ypos() { return this.p[5]; } set ypos(v: number) { this.p[5] = v; }
  get zpos() { return this.p[6]; } set zpos(v: number) { this.p[6] = v; }
  get deformationOffset() { return this.p[7]; } set deformationOffset(v: number) { this.p[7] = v; }
  get deformationOffsetW() { return this.p[8]; } set deformationOffsetW(v: number) { this.p[8] = v; }
  get type() { return this.p[9]; } set type(v: number) { this.p[9] = v & 0xff; }
  get xsize() { return this.p[10]; } set xsize(v: number) { this.p[10] = v & 0xff; }
  get ysize() { return this.p[11]; } set ysize(v: number) { this.p[11] = v & 0xff; }
}

export class LineScroll {
  readonly parallaxFactor = new Int32Array(C.PARALLAX_COUNT);
  readonly scrollSpeed = new Int32Array(C.PARALLAX_COUNT);
  readonly scrollPos = new Int32Array(C.PARALLAX_COUNT);
  readonly linePos = new Int32Array(C.PARALLAX_COUNT);
  readonly deform = new Int32Array(C.PARALLAX_COUNT);
  readonly n = new Int32Array(1);
  get entryCount() { return this.n[0]; } set entryCount(v: number) { this.n[0] = v & 0xff; }
}

export class Tiles128x128 {
  readonly gfxDataPos = new Int32Array(C.CHUNKTILE_COUNT);
  readonly tileIndex = new Uint16Array(C.CHUNKTILE_COUNT);
  readonly direction = new Uint8Array(C.CHUNKTILE_COUNT);
  readonly visualPlane = new Uint8Array(C.CHUNKTILE_COUNT);
  readonly collisionFlags = [new Uint8Array(C.CHUNKTILE_COUNT), new Uint8Array(C.CHUNKTILE_COUNT)];
}

export class CollisionMasks {
  readonly floorMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly lWallMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly rWallMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly roofMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly angles = new Uint32Array(C.TILE_COUNT);
  readonly flags = new Uint8Array(C.TILE_COUNT);
}

export class RefList {
  readonly entityRefs = new Int32Array(C.ENTITY_COUNT);
  readonly n = new Int32Array(1);
  get listSize() { return this.n[0]; } set listSize(v: number) { this.n[0] = v; }
}

export interface CollisionSensor {
  xpos: number;
  ypos: number;
  angle: number;
  collided: number;
}

export class ScriptEngineRegs {
  readonly operands = new Int32Array(0x10);
  readonly temp = new Int32Array(8);
  readonly arrayPosition = new Int32Array(9);
  constructor(private readonly e: Engine) {}
  get checkResult() { return this.e.checkResult; }
  set checkResult(v: number | boolean) { this.e.checkResult = +v; }
}

export interface DebugHitbox { type: number; entity: number; collision: number; left: number; top: number; right: number; bottom: number; xpos: number; ypos: number }

export interface ScriptPtr { scriptCodePtr: number; jumpTablePtr: number }

export interface AnimationFile {
  fileName: string;
  animCount: number;
  aniListOffset: number;
  hitboxListOffset: number;
}

export interface ObjectScript {
  frameCount: number;
  spriteSheetID: number;
  eventUpdate: ScriptPtr;
  eventDraw: ScriptPtr;
  eventStartup: ScriptPtr;
  frameListOffset: number;
  animFile: AnimationFile;
}

export interface SpriteFrame { sprX: number; sprY: number; width: number; height: number; pivotX: number; pivotY: number; sheetID: number; hitboxID: number }
export interface SpriteAnimation { name: string; frameCount: number; speed: number; loopPoint: number; rotationStyle: number; frameListOffset: number }
export interface Hitbox { left: Int8Array; top: Int8Array; right: Int8Array; bottom: Int8Array }
export interface SceneInfo { name: string; folder: string; id: string; highlighted: number }
export interface GFXSurface { fileName: string; height: number; width: number; widthShift: number; depth: number; dataPosition: number }
export interface ScriptFunction { access: number; name: string; ptr: ScriptPtr }

export class Matrix {
  readonly values = [new Int32Array(4), new Int32Array(4), new Int32Array(4), new Int32Array(4)];
}

const newSpriteFrame = (): SpriteFrame => ({ sprX: 0, sprY: 0, width: 0, height: 0, pivotX: 0, pivotY: 0, sheetID: 0, hitboxID: 0 });

export interface Engine extends ScalarVars {}

export class Engine {
  readonly vars = new Int32Array(SCALARS.length);
  readonly cams = new Int32Array(MAX_PLAYERS * CAM_STRIDE);
  /** Which camera the camera accessors and drawing currently use. */
  curCam = 0;
  camBase = 0;

  // ---- objects
  readonly entityBuffer = new Int32Array(C.ENTITY_COUNT * 2 * ENT_STRIDE);
  readonly objectEntityList: Entity[] = [];
  readonly processObjectFlag = new Int32Array(C.ENTITY_COUNT);
  readonly objectTypeGroupList: RefList[] = [];
  readonly drawListEntries: RefList[] = [];
  typeNames: string[] = new Array(C.OBJECT_COUNT).fill("");

  // ---- scripts
  readonly scriptEng = new ScriptEngineRegs(this);
  readonly globalVariables = new Int32Array(C.GLOBALVAR_COUNT);
  globalVariableNames: string[] = [];
  readonly scriptCode = new Int32Array(C.SCRIPTCODE_COUNT);
  readonly jumpTable = new Int32Array(C.JUMPTABLE_COUNT);
  readonly jumpTableStack = new Int32Array(C.JUMPSTACK_COUNT);
  readonly functionStack = new Int32Array(C.FUNCSTACK_COUNT);
  readonly foreachStack = new Int32Array(C.FORSTACK_COUNT);
  objectScriptList: ObjectScript[] = [];
  scriptFunctionList: ScriptFunction[] = [];
  scriptText = "";
  readonly saveRAM = new Int32Array(C.SAVEDATA_SIZE);

  // ---- stage
  stageListCount = [0, 0, 0, 0];
  stageList: SceneInfo[][] = [[], [], [], []];
  currentStageFolder = "";
  /** "list:position" of the act whose static data (layout, objects at load) was last loaded. */
  loadedActKey = "";
  titleCardText = "";
  readonly activeTileLayers = new Uint8Array(4);
  readonly stageLayouts: TileLayer[] = [];
  readonly bgDeformationData0 = new Int32Array(C.DEFORM_COUNT);
  readonly bgDeformationData1 = new Int32Array(C.DEFORM_COUNT);
  readonly bgDeformationData2 = new Int32Array(C.DEFORM_COUNT);
  readonly bgDeformationData3 = new Int32Array(C.DEFORM_COUNT);
  readonly hParallax = new LineScroll();
  readonly vParallax = new LineScroll();
  readonly tiles128x128 = new Tiles128x128();
  readonly collisionMasks = [new CollisionMasks(), new CollisionMasks()];
  readonly tilesetGFXData = new Uint8Array(C.TILESET_SIZE);
  readonly tile3DFloorBuffer = new Uint16Array(0x100 * 0x100);
  SCREEN_XSIZE = C.DEFAULT_SCREEN_XSIZE;
  SCREEN_CENTERX = C.DEFAULT_SCREEN_XSIZE / 2;
  SCREEN_SCROLL_LEFT = C.DEFAULT_SCREEN_XSIZE / 2 - 8;
  SCREEN_SCROLL_RIGHT = C.DEFAULT_SCREEN_XSIZE / 2 + 8;

  // ---- collision
  collisionLeft = 0;
  collisionTop = 0;
  collisionRight = 0;
  collisionBottom = 0;
  collisionTolerance = 0;
  readonly sensors: CollisionSensor[] = [];
  /** Developer overlay: hitboxes tested this frame. */
  showHitboxes = false;
  debugHitboxCount = 0;
  debugHitboxList: DebugHitbox[] = [];

  // ---- animation
  animationFileList: AnimationFile[] = [];
  animationFileCount = 0;
  readonly scriptFrames: SpriteFrame[] = [];
  readonly animFrames: SpriteFrame[] = [];
  animFrameCount = 0;
  readonly animationList: SpriteAnimation[] = [];
  animationCount = 0;
  readonly hitboxList: Hitbox[] = [];
  hitboxCount = 0;

  // ---- palettes
  readonly paletteBuffer = new Uint16Array(C.PALETTE_COUNT * C.PALETTE_COLOR_COUNT);
  readonly palette32Buffer = new Uint8Array(C.PALETTE_COUNT * C.PALETTE_COLOR_COUNT * 3);
  readonly fullPalette: Uint16Array[] = [];
  readonly gfxLineBuffer = new Uint8Array(C.SCREEN_YSIZE);

  // ---- graphics (pixel data is only decoded where something renders)
  gfxSurface: GFXSurface[] = [];
  graphicData: Uint8Array;
  gfxDataPosition = 0;

  // ---- 3D
  readonly matWorld = new Matrix();
  readonly matView = new Matrix();
  readonly matFinal = new Matrix();
  readonly matTemp = new Matrix();
  readonly vertexBuf = new Int32Array(C.VERTEXBUFFER_SIZE * 5);
  readonly vertexBufT = new Int32Array(C.VERTEXBUFFER_SIZE * 5);
  readonly faceBuf = new Int32Array(C.FACEBUFFER_SIZE * 6);

  // ---- game info
  gameWindowText = "";
  gameType: "sonic1" | "sonic2" = "sonic2";
  playerNames: string[] = [];
  sfxNames: string[] = new Array(C.SFX_COUNT).fill("");
  sfxPaths: string[] = new Array(C.SFX_COUNT).fill("");
  gameConfig!: GameConfig;
  readonly compiler: ScriptCompiler;
  globalSFXCount = 0;
  stageSFXCount = 0;
  nativeFunctionNames: string[] = [];

  // ---- input (one pad per player; see input.ts)
  readonly inputDown = new Int32Array(MAX_PLAYERS);
  readonly inputPress = new Int32Array(MAX_PLAYERS);
  readonly inputPrev = new Int32Array(MAX_PLAYERS);
  /** Number of human players driving slots 0..playerSlots-1. */
  playerSlots = 1;

  readonly gameMenu = [new TextMenu(), new TextMenu()];
  /** The renderer, when this engine draws (client). The server leaves it null and skips all drawing. */
  draw: DrawApi | null = null;

  /** All typed arrays whose contents make up the simulation state, in a fixed order. */
  readonly state: { name: string; arr: Int32Array | Uint16Array | Uint8Array | Int8Array | Uint32Array }[] = [];

  constructor(
    readonly vfs: Vfs,
    readonly host: ScriptHost,
    readonly opts: { headless: boolean },
  ) {
    for (let i = 0; i < C.ENTITY_COUNT * 2; i++) this.objectEntityList.push(new Entity(this.entityBuffer, i));
    for (let i = 0; i < C.TYPEGROUP_COUNT; i++) this.objectTypeGroupList.push(new RefList());
    for (let i = 0; i < C.DRAWLAYER_COUNT; i++) this.drawListEntries.push(new RefList());
    for (let i = 0; i < C.LAYER_COUNT; i++) this.stageLayouts.push(new TileLayer());
    for (let i = 0; i < 7; i++) this.sensors.push({ xpos: 0, ypos: 0, angle: 0, collided: 0 });
    for (let i = 0; i < C.SPRITEFRAME_COUNT; i++) {
      this.scriptFrames.push(newSpriteFrame());
      this.animFrames.push(newSpriteFrame());
    }
    for (let i = 0; i < C.ANIMATION_COUNT; i++)
      this.animationList.push({ name: "", frameCount: 0, speed: 0, loopPoint: 0, rotationStyle: 0, frameListOffset: 0 });
    for (let i = 0; i < C.HITBOX_COUNT; i++)
      this.hitboxList.push({ left: new Int8Array(8), top: new Int8Array(8), right: new Int8Array(8), bottom: new Int8Array(8) });
    for (let i = 0; i < C.ANIFILE_COUNT; i++) this.animationFileList.push({ fileName: "", animCount: 0, aniListOffset: 0, hitboxListOffset: 0 });
    for (let i = 0; i < C.OBJECT_COUNT; i++) {
      this.objectScriptList.push({
        frameCount: 0, spriteSheetID: 0, frameListOffset: 0, animFile: this.animationFileList[0],
        eventUpdate: { scriptCodePtr: 0, jumpTablePtr: 0 }, eventDraw: { scriptCodePtr: 0, jumpTablePtr: 0 },
        eventStartup: { scriptCodePtr: 0, jumpTablePtr: 0 },
      });
    }
    for (let i = 0; i < C.FUNCTION_COUNT; i++) this.scriptFunctionList.push({ access: 0, name: "", ptr: { scriptCodePtr: 0, jumpTablePtr: 0 } });
    for (let i = 0; i < C.PALETTE_COUNT; i++) this.fullPalette.push(this.paletteBuffer.subarray(i * 256, i * 256 + 256));
    for (let i = 0; i < C.SURFACE_COUNT; i++) this.gfxSurface.push({ fileName: "", height: 0, width: 0, widthShift: 0, depth: 0, dataPosition: 0 });
    this.graphicData = new Uint8Array(opts.headless ? 1 : C.GFXDATA_SIZE);
    this.compiler = new ScriptCompiler(this);

    // Registration order defines the snapshot layout.
    const reg = (name: string, arr: Int32Array | Uint16Array | Uint8Array | Int8Array | Uint32Array) => this.state.push({ name, arr });
    reg("vars", this.vars);
    reg("inputDown", this.inputDown);
    reg("inputPress", this.inputPress);
    reg("inputPrev", this.inputPrev);
    reg("cams", this.cams);
    reg("entities", this.entityBuffer);
    reg("processObjectFlag", this.processObjectFlag);
    this.objectTypeGroupList.forEach((l, i) => { reg(`group${i}.n`, l.n); reg(`group${i}`, l.entityRefs); });
    this.drawListEntries.forEach((l, i) => { reg(`draw${i}.n`, l.n); reg(`draw${i}`, l.entityRefs); });
    reg("operands", this.scriptEng.operands);
    reg("temp", this.scriptEng.temp);
    reg("arrayPosition", this.scriptEng.arrayPosition);
    reg("globals", this.globalVariables);
    reg("scriptCode", this.scriptCode);
    reg("saveRAM", this.saveRAM);
    reg("activeTileLayers", this.activeTileLayers);
    this.stageLayouts.forEach((l, i) => { reg(`layer${i}.p`, l.p); reg(`layer${i}.tiles`, l.tiles); reg(`layer${i}.lineScroll`, l.lineScroll); });
    reg("deform0", this.bgDeformationData0);
    reg("deform1", this.bgDeformationData1);
    reg("deform2", this.bgDeformationData2);
    reg("deform3", this.bgDeformationData3);
    for (const [n, ls] of [["h", this.hParallax], ["v", this.vParallax]] as const) {
      reg(`${n}Parallax.factor`, ls.parallaxFactor);
      reg(`${n}Parallax.speed`, ls.scrollSpeed);
      reg(`${n}Parallax.pos`, ls.scrollPos);
      reg(`${n}Parallax.linePos`, ls.linePos);
      reg(`${n}Parallax.deform`, ls.deform);
      reg(`${n}Parallax.n`, ls.n);
    }
    const t = this.tiles128x128;
    reg("chunks.gfxDataPos", t.gfxDataPos);
    reg("chunks.tileIndex", t.tileIndex);
    reg("chunks.direction", t.direction);
    reg("chunks.visualPlane", t.visualPlane);
    reg("chunks.solidA", t.collisionFlags[0]);
    reg("chunks.solidB", t.collisionFlags[1]);
    this.collisionMasks.forEach((m, i) => { reg(`cmask${i}.angles`, m.angles); reg(`cmask${i}.flags`, m.flags); });
    reg("palette", this.paletteBuffer);
    reg("palette32", this.palette32Buffer);
    reg("lineBuffer", this.gfxLineBuffer);
    reg("vertices", this.vertexBuf);
    reg("faces", this.faceBuf);
    for (const m of [this.matWorld, this.matView, this.matTemp]) m.values.forEach((r, i) => reg(`mat${i}`, r));
  }

  /** Select the camera the per-camera accessors resolve to. */
  setCamera(index: number): void {
    this.curCam = index;
    this.camBase = index * CAM_STRIDE;
  }

  get activePalette(): Uint16Array {
    return this.fullPalette[this.activePaletteID];
  }
}

SCALARS.forEach(([name, kind], i) => {
  const set =
    kind === "b"
      ? function (this: Engine, v: number | boolean) { this.vars[i] = v ? 1 : 0; }
      : kind === "u8"
        ? function (this: Engine, v: number) { this.vars[i] = v & 0xff; }
        : function (this: Engine, v: number) { this.vars[i] = v; };
  Object.defineProperty(Engine.prototype, name, { get(this: Engine) { return this.vars[i]; }, set, configurable: false });
});
CAM_SCALARS.forEach(([name, kind], i) => {
  const set =
    kind === "b"
      ? function (this: Engine, v: number | boolean) { this.cams[this.camBase + i] = v ? 1 : 0; }
      : function (this: Engine, v: number) { this.cams[this.camBase + i] = v; };
  Object.defineProperty(Engine.prototype, name, { get(this: Engine) { return this.cams[this.camBase + i]; }, set, configurable: false });
});
