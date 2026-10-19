// The RSDKv3 (Sonic CD) engine instance: all of the original's global state, per instance, registered as typed
// arrays in `state` so the simulation can be captured, delta-encoded and restored exactly like the v4 engine.
//
// Scalars use their original C names (as accessor properties over `vars`). The per-camera ones live in `cams` and
// resolve against the current camera, which is how each co-op player gets an independent camera in one stage.

import * as C from "./consts.js";
import { Entity3, Player3, ENT3_STRIDE, PLAYER3_STRIDE } from "./entity.js";
import type { Vfs } from "../core/pak.js";
import type { ScriptHost } from "../host.js";
import { TextMenu } from "../text.js";
import type { DrawApi3 } from "./render-api.js";
import { newFontList } from "./text.js";
import { ScriptCompiler3 } from "./script/compiler.js";
import type { GameConfig3 } from "./config.js";

export const MAX_PLAYERS3 = C.PLAYER_COUNT;

// ---- scalar state ---------------------------------------------------------------------------------------------
// [name, kind]: i = int, b = bool (stored 0/1), u8 = byte, u16 = unsigned short
type Kind = "i" | "b" | "u8" | "u16";
const SCALARS: [string, Kind][] = [
  ["stageMode", "i"], ["newXBoundary1", "i"], ["newYBoundary1", "i"], ["newXBoundary2", "i"], ["newYBoundary2", "i"],
  ["waterLevel", "i"], ["waterDrawPos", "i"], ["lastXSize", "i"], ["lastYSize", "i"],
  ["pauseEnabled", "b"], ["timeEnabled", "b"], ["debugMode", "b"], ["frameCounter", "i"],
  ["stageMilliseconds", "i"], ["stageSeconds", "i"], ["stageMinutes", "i"],
  ["activeStageList", "i"], ["stageListPosition", "i"], ["actID", "i"], ["titleCardWord2", "u8"], ["tLayerMidPoint", "u8"],
  ["objectLoop", "i"], ["curObjectType", "i"],
  ["playerListPos", "i"], ["activePlayer", "i"], ["activePlayerCount", "i"],
  ["upBuffer", "u16"], ["downBuffer", "u16"], ["leftBuffer", "u16"], ["rightBuffer", "u16"], ["jumpPressBuffer", "u16"], ["jumpHoldBuffer", "u16"],
  ["fadeMode", "i"], ["fadeA", "u8"], ["fadeR", "u8"], ["fadeG", "u8"], ["fadeB", "u8"], ["paletteMode", "i"], ["activePaletteID", "i"],
  ["gameMode", "i"], ["message", "i"], ["language", "i"], ["frameSkipTimer", "i"], ["frameSkipSetting", "i"], ["hapticsEnabled", "i"],
  ["checkResult", "i"], ["scriptFrameCount", "i"], ["rngState", "i"],
  ["trackID", "i"], ["musicStatus", "i"], ["masterVolume", "i"], ["sfxVolume", "i"], ["bgmVolume", "i"],
  ["vertexCount", "i"], ["faceCount", "i"], ["projectionX", "i"], ["projectionY", "i"],
  ["keyDown", "i"], ["keyPress", "i"], ["anyPress", "i"], ["inputPrevAny", "i"],
  ["collisionLeft", "i"], ["collisionTop", "i"], ["collisionRight", "i"], ["collisionBottom", "i"],
  ["frameCount", "i"], ["tick", "i"], ["stageLoadCount", "i"], ["camCount", "i"], ["teleportCooldown", "i"],
];

// Per-camera scalars (one block per camera; `curCam` selects the block the accessors use).
const CAM_SCALARS: [string, Kind][] = [
  ["cameraTarget", "i"], ["cameraStyle", "i"], ["cameraEnabled", "i"], ["cameraAdjustY", "i"],
  ["xScrollOffset", "i"], ["yScrollOffset", "i"], ["yScrollA", "i"], ["yScrollB", "i"], ["xScrollA", "i"], ["xScrollB", "i"],
  ["yScrollMove", "i"], ["cameraShakeX", "i"], ["cameraShakeY", "i"], ["cameraLag", "i"], ["cameraLagStyle", "i"],
  ["xBoundary1", "i"], ["yBoundary1", "i"], ["xBoundary2", "i"], ["yBoundary2", "i"],
];
export const CAM3_STRIDE = 24;
export const CAM3_INDEX: Record<string, number> = Object.fromEntries(CAM_SCALARS.map(([n], i) => [n, i]));

export interface ScalarVars3 {
  stageMode: number; newXBoundary1: number; newYBoundary1: number; newXBoundary2: number; newYBoundary2: number;
  waterLevel: number; waterDrawPos: number; lastXSize: number; lastYSize: number;
  pauseEnabled: number; timeEnabled: number; debugMode: number; frameCounter: number;
  stageMilliseconds: number; stageSeconds: number; stageMinutes: number;
  activeStageList: number; stageListPosition: number; actID: number; titleCardWord2: number; tLayerMidPoint: number;
  objectLoop: number; curObjectType: number;
  playerListPos: number; activePlayer: number; activePlayerCount: number;
  upBuffer: number; downBuffer: number; leftBuffer: number; rightBuffer: number; jumpPressBuffer: number; jumpHoldBuffer: number;
  fadeMode: number; fadeA: number; fadeR: number; fadeG: number; fadeB: number; paletteMode: number; activePaletteID: number;
  gameMode: number; message: number; language: number; frameSkipTimer: number; frameSkipSetting: number; hapticsEnabled: number;
  checkResult: number; scriptFrameCount: number; rngState: number;
  trackID: number; musicStatus: number; masterVolume: number; sfxVolume: number; bgmVolume: number;
  vertexCount: number; faceCount: number; projectionX: number; projectionY: number;
  keyDown: number; keyPress: number; anyPress: number; inputPrevAny: number;
  collisionLeft: number; collisionTop: number; collisionRight: number; collisionBottom: number;
  frameCount: number; tick: number; stageLoadCount: number; camCount: number; teleportCooldown: number;
  // per camera
  cameraTarget: number; cameraStyle: number; cameraEnabled: number; cameraAdjustY: number;
  xScrollOffset: number; yScrollOffset: number; yScrollA: number; yScrollB: number; xScrollA: number; xScrollB: number;
  yScrollMove: number; cameraShakeX: number; cameraShakeY: number; cameraLag: number; cameraLagStyle: number;
  xBoundary1: number; yBoundary1: number; xBoundary2: number; yBoundary2: number;
}

// ---- structured state ------------------------------------------------------------------------------------------

export class TileLayer3 {
  readonly tiles = new Uint16Array(C.TILELAYER_CHUNK_COUNT);
  readonly lineScroll = new Uint8Array(C.TILELAYER_SCROLL_COUNT);
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

export class LineScroll3 {
  readonly parallaxFactor = new Int32Array(C.PARALLAX_COUNT);
  readonly scrollSpeed = new Int32Array(C.PARALLAX_COUNT);
  readonly scrollPos = new Int32Array(C.PARALLAX_COUNT);
  readonly linePos = new Int32Array(C.PARALLAX_COUNT);
  readonly deform = new Int32Array(C.PARALLAX_COUNT);
  readonly n = new Int32Array(1);
  get entryCount() { return this.n[0]; } set entryCount(v: number) { this.n[0] = v & 0xff; }
}

export class Tiles128x128_3 {
  readonly gfxDataPos = new Int32Array(C.CHUNKTILE_COUNT);
  readonly tileIndex = new Uint16Array(C.CHUNKTILE_COUNT);
  readonly direction = new Uint8Array(C.CHUNKTILE_COUNT);
  readonly visualPlane = new Uint8Array(C.CHUNKTILE_COUNT);
  readonly collisionFlags = [new Uint8Array(C.CHUNKTILE_COUNT), new Uint8Array(C.CHUNKTILE_COUNT)];
}

export class CollisionMasks3 {
  readonly floorMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly lWallMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly rWallMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly roofMasks = new Int8Array(C.TILE_COUNT * C.TILE_SIZE);
  readonly angles = new Uint32Array(C.TILE_COUNT);
  readonly flags = new Uint8Array(C.TILE_COUNT);
}

export class DrawList3 {
  readonly entityRefs = new Int32Array(C.ENTITY_COUNT);
  readonly n = new Int32Array(1);
  get listSize() { return this.n[0]; } set listSize(v: number) { this.n[0] = v; }
}

export interface CollisionSensor3 { xpos: number; ypos: number; angle: number; collided: number }
export interface ScriptPtr3 { scriptCodePtr: number; jumpTablePtr: number }
export interface AnimationFile3 { index: number; fileName: string; animCount: number; aniListOffset: number; hitboxListOffset: number }
export interface ObjectScript3 {
  frameCount: number;
  spriteSheetID: number;
  subMain: ScriptPtr3;
  subPlayerInteraction: ScriptPtr3;
  subDraw: ScriptPtr3;
  subStartup: ScriptPtr3;
  frameListOffset: number;
  animFile: AnimationFile3;
  /** Always true: every script is compiled from source, in the updated (mobile) format. */
  mobile: boolean;
}
export interface SpriteFrame3 { sprX: number; sprY: number; width: number; height: number; pivotX: number; pivotY: number; sheetID: number; hitboxID: number }
export interface SpriteAnimation3 { name: string; frameCount: number; speed: number; loopPoint: number; rotationStyle: number; frameListOffset: number }
export interface Hitbox3 { left: Int8Array; top: Int8Array; right: Int8Array; bottom: Int8Array }
export interface SceneInfo3 { name: string; folder: string; id: string; highlighted: number }
export interface GFXSurface3 { fileName: string; height: number; width: number; widthShift: number; dataPosition: number }
export interface ScriptFunction3 { name: string; ptr: ScriptPtr3 }
export interface SfxInfo3 { name: string }

export class Matrix3 {
  readonly values = [new Int32Array(4), new Int32Array(4), new Int32Array(4), new Int32Array(4)];
}

const newSpriteFrame = (): SpriteFrame3 => ({ sprX: 0, sprY: 0, width: 0, height: 0, pivotX: 0, pivotY: 0, sheetID: 0, hitboxID: 0 });
const newPtr = (): ScriptPtr3 => ({ scriptCodePtr: C.SCRIPTDATA_COUNT - 1, jumpTablePtr: C.JUMPTABLE_COUNT - 1 });

export interface Engine3 extends ScalarVars3 {}

export class Engine3 {
  readonly vars = new Int32Array(SCALARS.length);
  readonly cams = new Int32Array(MAX_PLAYERS3 * CAM3_STRIDE);
  /** Which camera the camera accessors and drawing currently use. */
  curCam = 0;
  camBase = 0;

  // ---- objects and players
  readonly entityBuffer = new Int32Array(C.ENTITY_COUNT * ENT3_STRIDE);
  readonly objectEntityList: Entity3[] = [];
  readonly playerBuffer = new Int32Array(C.PLAYER_COUNT * PLAYER3_STRIDE);
  readonly playerList: Player3[] = [];
  readonly drawListEntries: DrawList3[] = [];
  typeNames: string[] = new Array(C.OBJECT_COUNT).fill("");
  OBJECT_BORDER_X1 = 0x80;
  OBJECT_BORDER_X2 = 0;

  // ---- scripts
  readonly operands = new Int32Array(10);
  readonly tempValue = new Int32Array(8);
  readonly arrayPosition = new Int32Array(3);
  readonly globalVariables = new Int32Array(C.GLOBALVAR_COUNT);
  globalVariableNames: string[] = [];
  readonly scriptCode = new Int32Array(C.SCRIPTDATA_COUNT);
  readonly jumpTable = new Int32Array(C.JUMPTABLE_COUNT);
  readonly jumpTableStack = new Int32Array(C.JUMPSTACK_COUNT);
  readonly functionStack = new Int32Array(C.FUNCSTACK_COUNT);
  readonly objectScriptList: ObjectScript3[] = [];
  readonly scriptFunctionList: ScriptFunction3[] = [];
  scriptFunctionCount = 0;
  /** The string operand of the opcode being run (scriptText in the original). */
  scriptText = "";
  readonly saveRAM = new Int32Array(C.SAVEDATA_SIZE);
  /** Origins-only global variables exist (game.playMode): the Origins callbacks and draw list 7 apply. */
  usingOrigins = false;

  // ---- collision
  readonly sensors: CollisionSensor3[] = [];
  /** collisionStorage[2]: entityNo, type, left, right, top, bottom (Origins Plus). */
  readonly collisionStorage = new Int32Array(C.COLSTORE_COUNT * 6);

  // ---- stage
  stageListCount = [0, 0, 0, 0];
  stageList: SceneInfo3[][] = [[], [], [], []];
  currentStageFolder = "";
  /** "list:position" of the act whose layout was last loaded. */
  loadedActKey = "";
  titleCardText = "";
  readonly activeTileLayers = new Uint8Array(4);
  readonly stageLayouts: TileLayer3[] = [];
  readonly bgDeformationData0 = new Int32Array(C.DEFORM_COUNT);
  readonly bgDeformationData1 = new Int32Array(C.DEFORM_COUNT);
  readonly bgDeformationData2 = new Int32Array(C.DEFORM_COUNT);
  readonly bgDeformationData3 = new Int32Array(C.DEFORM_COUNT);
  readonly hParallax = new LineScroll3();
  readonly vParallax = new LineScroll3();
  readonly tiles128x128 = new Tiles128x128_3();
  readonly collisionMasks = [new CollisionMasks3(), new CollisionMasks3()];
  readonly tilesetGFXData = new Uint8Array(C.TILESET_SIZE);
  readonly tile3DFloorBuffer = new Uint16Array(0x100 * 0x100);
  SCREEN_XSIZE = C.DEFAULT_SCREEN_XSIZE;
  SCREEN_CENTERX = C.DEFAULT_SCREEN_XSIZE / 2;
  SCREEN_SCROLL_LEFT = C.DEFAULT_SCREEN_XSIZE / 2 - 8;
  SCREEN_SCROLL_RIGHT = C.DEFAULT_SCREEN_XSIZE / 2 + 8;

  // ---- animation
  readonly animationFileList: AnimationFile3[] = [];
  animationFileCount = 0;
  readonly scriptFrames: SpriteFrame3[] = [];
  readonly animFrames: SpriteFrame3[] = [];
  animFrameCount = 0;
  readonly animationList: SpriteAnimation3[] = [];
  animationCount = 0;
  readonly hitboxList: Hitbox3[] = [];
  hitboxCount = 0;

  // ---- palettes
  readonly paletteBuffer = new Uint16Array(C.PALETTE_COUNT * C.PALETTE_SIZE);
  readonly palette32Buffer = new Uint8Array(C.PALETTE_COUNT * C.PALETTE_SIZE * 3);
  readonly fullPalette: Uint16Array[] = [];
  readonly gfxLineBuffer = new Uint8Array(C.SCREEN_YSIZE);

  // ---- graphics (pixel data is only decoded where something renders)
  readonly gfxSurface: GFXSurface3[] = [];
  graphicData: Uint8Array;
  gfxDataPosition = 0;

  // ---- 3D
  readonly matWorld = new Matrix3();
  readonly matView = new Matrix3();
  readonly matFinal = new Matrix3();
  readonly matTemp = new Matrix3();
  /** x, y, z, u, v per vertex */
  readonly vertexBuffer = new Int32Array(C.VERTEXBUFFER_SIZE * 5);
  readonly vertexBufferT = new Int32Array(C.VERTEXBUFFER_SIZE * 5);
  /** a, b, c, d, colour, flags per face */
  readonly faceBuffer = new Int32Array(C.FACEBUFFER_SIZE * 6);

  // ---- game info
  gameConfig!: GameConfig3;
  readonly compiler: ScriptCompiler3;
  gameWindowText = "";
  gameDescriptionText = "";
  playerNames: string[] = [];
  readonly sfxList: SfxInfo3[] = [];
  /** SetMusicTrack file names per track (PlayMusic stops the music when a track has none). */
  musicTrackNames: string[] = new Array(C.TRACK_COUNT).fill("");
  globalSFXCount = 0;
  stageSFXCount = 0;

  // ---- input (one pad per player)
  readonly inputDown = new Int32Array(MAX_PLAYERS3);
  readonly inputPress = new Int32Array(MAX_PLAYERS3);
  readonly inputPrev = new Int32Array(MAX_PLAYERS3);
  /** Number of human players driving player slots 0..playerSlots-1. */
  playerSlots = 1;

  readonly gameMenu = [new TextMenu(), new TextMenu()];
  readonly fontCharacterList = newFontList();
  textMenuSurfaceNo = 0;
  /** The renderer, when this engine draws (client). The server leaves it null and skips all drawing. */
  draw: DrawApi3 | null = null;

  /** All typed arrays whose contents make up the simulation state, in a fixed order. */
  readonly state: { name: string; arr: Int32Array | Uint16Array | Uint8Array | Int8Array | Uint32Array }[] = [];

  constructor(
    readonly vfs: Vfs,
    readonly host: ScriptHost,
    readonly opts: { headless: boolean },
  ) {
    for (let i = 0; i < C.ENTITY_COUNT; i++) this.objectEntityList.push(new Entity3(this.entityBuffer, i));
    for (let i = 0; i < C.PLAYER_COUNT; i++) this.playerList.push(new Player3(this.playerBuffer, i));
    for (let i = 0; i < C.DRAWLAYER_COUNT; i++) this.drawListEntries.push(new DrawList3());
    for (let i = 0; i < C.LAYER_COUNT; i++) this.stageLayouts.push(new TileLayer3());
    for (let i = 0; i < 6; i++) this.sensors.push({ xpos: 0, ypos: 0, angle: 0, collided: 0 });
    for (let i = 0; i < C.SPRITEFRAME_COUNT; i++) {
      this.scriptFrames.push(newSpriteFrame());
      this.animFrames.push(newSpriteFrame());
    }
    for (let i = 0; i < C.ANIMATION_COUNT; i++)
      this.animationList.push({ name: "", frameCount: 0, speed: 0, loopPoint: 0, rotationStyle: 0, frameListOffset: 0 });
    for (let i = 0; i < C.HITBOX_COUNT; i++)
      this.hitboxList.push({ left: new Int8Array(8), top: new Int8Array(8), right: new Int8Array(8), bottom: new Int8Array(8) });
    for (let i = 0; i < C.ANIFILE_COUNT; i++) this.animationFileList.push({ index: i, fileName: "", animCount: 0, aniListOffset: 0, hitboxListOffset: 0 });
    for (let i = 0; i < C.OBJECT_COUNT; i++) {
      this.objectScriptList.push({
        frameCount: 0, spriteSheetID: 0, frameListOffset: 0, animFile: this.animationFileList[0], mobile: true,
        subMain: newPtr(), subPlayerInteraction: newPtr(), subDraw: newPtr(), subStartup: newPtr(),
      });
    }
    for (let i = 0; i < C.FUNCTION_COUNT; i++) this.scriptFunctionList.push({ name: "", ptr: newPtr() });
    for (let i = 0; i < C.PALETTE_COUNT; i++) this.fullPalette.push(this.paletteBuffer.subarray(i * 256, i * 256 + 256));
    for (let i = 0; i < C.SURFACE_COUNT; i++) this.gfxSurface.push({ fileName: "", height: 0, width: 0, widthShift: 0, dataPosition: 0 });
    for (let i = 0; i < C.SFX_COUNT; i++) this.sfxList.push({ name: "" });
    this.graphicData = new Uint8Array(opts.headless ? 1 : C.GFXDATA_SIZE);
    this.compiler = new ScriptCompiler3(this);
    this.OBJECT_BORDER_X2 = this.SCREEN_XSIZE + 0x80;
    this.gameMode = C.ENGINE_MAINGAME;
    this.masterVolume = C.MAX_VOLUME;
    this.sfxVolume = C.MAX_VOLUME;
    this.bgmVolume = C.MAX_VOLUME;
    this.activePlayerCount = 1;
    this.camCount = 1;
    this.rngState = 1;
    for (let c = 0; c < MAX_PLAYERS3; c++) {
      this.setCamera(c);
      this.cameraTarget = -1;
      this.yScrollB = C.SCREEN_YSIZE;
      this.xScrollB = this.SCREEN_XSIZE;
    }
    this.setCamera(0);

    // Registration order defines the snapshot layout.
    const reg = (name: string, arr: Int32Array | Uint16Array | Uint8Array | Int8Array | Uint32Array) => this.state.push({ name, arr });
    reg("vars", this.vars);
    reg("inputDown", this.inputDown);
    reg("inputPress", this.inputPress);
    reg("inputPrev", this.inputPrev);
    reg("cams", this.cams);
    reg("entities", this.entityBuffer);
    reg("players", this.playerBuffer);
    this.drawListEntries.forEach((l, i) => { reg(`draw${i}.n`, l.n); reg(`draw${i}`, l.entityRefs); });
    reg("operands", this.operands);
    reg("temp", this.tempValue);
    reg("arrayPosition", this.arrayPosition);
    reg("globals", this.globalVariables);
    reg("saveRAM", this.saveRAM);
    reg("collisionStorage", this.collisionStorage);
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
    reg("vertices", this.vertexBuffer);
    reg("faces", this.faceBuffer);
    for (const m of [this.matWorld, this.matView, this.matTemp]) m.values.forEach((r, i) => reg(`mat${i}`, r));
  }

  /** Select the camera the per-camera accessors resolve to. */
  setCamera(index: number): void {
    this.curCam = index;
    this.camBase = index * CAM3_STRIDE;
  }

  get activePalette(): Uint16Array {
    return this.fullPalette[this.activePaletteID];
  }

  /** The player's bound entity (Player::boundEntity). */
  boundEntity(player: Player3) {
    return this.objectEntityList[player.boundEntity];
  }
}

const mask = (kind: Kind) =>
  kind === "b" ? (v: number | boolean) => (v ? 1 : 0) : kind === "u8" ? (v: number) => v & 0xff : kind === "u16" ? (v: number) => v & 0xffff : (v: number) => v | 0;
SCALARS.forEach(([name, kind], i) => {
  const m = mask(kind) as (v: number) => number;
  Object.defineProperty(Engine3.prototype, name, {
    get(this: Engine3) { return this.vars[i]; },
    set(this: Engine3, v: number) { this.vars[i] = m(v); },
    configurable: false,
  });
});
CAM_SCALARS.forEach(([name, kind], i) => {
  const m = mask(kind) as (v: number) => number;
  Object.defineProperty(Engine3.prototype, name, {
    get(this: Engine3) { return this.cams[this.camBase + i]; },
    set(this: Engine3, v: number) { this.cams[this.camBase + i] = m(v); },
    configurable: false,
  });
});
