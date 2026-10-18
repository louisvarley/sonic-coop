// Engine limits and enums (RSDKv4, revision 3 feature set).

export const ENTITY_COUNT = 0x4a0;
export const TEMPENTITY_START = ENTITY_COUNT - 0x80;
export const OBJECT_COUNT = 0x100;
export const TYPEGROUP_COUNT = 0x103;
export const GROUP_ALL = 0;
export const OBJ_TYPE_BLANKOBJECT = 0;

export const SCREEN_YSIZE = 240;
export const SCREEN_CENTERY = SCREEN_YSIZE / 2;
export const DEFAULT_SCREEN_XSIZE = 424;

export const LAYER_COUNT = 9;
export const DEFORM_STORE = 256;
export const DEFORM_SIZE = 320;
export const DEFORM_COUNT = DEFORM_STORE + DEFORM_SIZE;
export const PARALLAX_COUNT = 0x100;
export const TILE_COUNT = 0x400;
export const TILE_SIZE = 0x10;
export const CHUNK_SIZE = 0x80;
export const TILE_DATASIZE = TILE_SIZE * TILE_SIZE;
export const TILESET_SIZE = TILE_COUNT * TILE_DATASIZE;
export const TILELAYER_CHUNK_W = 0x100;
export const TILELAYER_CHUNK_H = 0x100;
export const TILELAYER_CHUNK_COUNT = TILELAYER_CHUNK_W * TILELAYER_CHUNK_H;
export const TILELAYER_LINESCROLL_COUNT = TILELAYER_CHUNK_H * CHUNK_SIZE;
export const CHUNKTILE_COUNT = 0x200 * (8 * 8);
export const CPATH_COUNT = 2;

export const SURFACE_COUNT = 24;
export const GFXDATA_SIZE = 0x800 * 0x800;
export const DRAWLAYER_COUNT = 8;

export const SCRIPTCODE_COUNT = 0x40000;
export const JUMPTABLE_COUNT = 0x4000;
export const FUNCTION_COUNT = 0x200;
export const JUMPSTACK_COUNT = 0x400;
export const FUNCSTACK_COUNT = 0x400;
export const FORSTACK_COUNT = 0x400;

export const ANIFILE_COUNT = 0x100;
export const ANIMATION_COUNT = 0x400;
export const SPRITEFRAME_COUNT = 0x1000;
export const HITBOX_COUNT = 0x20;
export const HITBOX_DIR_COUNT = 8;

export const PALETTE_COUNT = 8;
export const PALETTE_COLOR_COUNT = 0x100;

export const GLOBALVAR_COUNT = 0x100;
export const SAVEDATA_SIZE = 0x2000;
export const NATIVEFUNCTION_COUNT = 0x10;
export const SFX_COUNT = 0x100;
export const TRACK_COUNT = 0x10;

export const VERTEXBUFFER_SIZE = 0x1000;
export const FACEBUFFER_SIZE = 0x400;

export const enum Priority {
  BOUNDS,
  ACTIVE,
  ALWAYS,
  XBOUNDS,
  XBOUNDS_DESTROY,
  INACTIVE,
  BOUNDS_SMALL,
  ACTIVE_SMALL,
}

export const enum StageMode {
  LOAD,
  NORMAL,
  PAUSED,
  FROZEN,
  TWO_P,
  NORMAL_STEP,
  PAUSED_STEP,
  FROZEN_STEP,
  TWO_P_STEP,
}

export const enum StageList {
  PRESENTATION,
  REGULAR,
  BONUS,
  SPECIAL,
  MAX,
}

export const enum LayerType {
  NOSCROLL,
  HSCROLL,
  VSCROLL,
  FLOOR3D,
  SKY3D,
}

export const enum CameraStyle {
  FOLLOW,
  EXTENDED,
  EXTENDED_OFFSET_L,
  EXTENDED_OFFSET_R,
  HLOCKED,
}

export const enum Flip {
  NONE,
  X,
  Y,
  XY,
}

export const enum Ink {
  NONE,
  BLEND,
  ALPHA,
  ADD,
  SUB,
}

export const enum DrawFX {
  SCALE,
  ROTATE,
  ROTOZOOM,
  INK,
  TINT,
  FLIP,
}

export const enum CSide {
  FLOOR = 0,
  LWALL = 1,
  RWALL = 2,
  ROOF = 3,
  LENTITY = 4,
  RENTITY = 5,
}

export const enum CMode {
  FLOOR = 0,
  LWALL = 1,
  ROOF = 2,
  RWALL = 3,
}

export const enum Solid {
  ALL = 0,
  TOP = 1,
  LRB = 2,
  NONE = 3,
  TOP_NOGRIP = 4,
}

export const enum CollisionType {
  TOUCH = 0,
  SOLID = 1,
  SOLID2 = 2,
  PLATFORM = 3,
}

export const C_BOX = 0x10000;

export const enum TileInfo {
  INDEX,
  DIRECTION,
  VISUALPLANE,
  SOLIDITYA,
  SOLIDITYB,
  FLAGSA,
  ANGLEA,
  FLAGSB,
  ANGLEB,
}

export const enum Deform {
  FG,
  FG_WATER,
  BG,
  BG_WATER,
}

export const enum EngineState {
  DEVMENU = 0,
  MAINGAME = 1,
  INITDEVMENU = 2,
  WAIT = 3,
  SCRIPTERROR = 4,
  INITPAUSE = 5,
  EXITPAUSE = 6,
  ENDGAME = 7,
  RESETGAME = 8,
}

export const enum ScriptEvent {
  MAIN = 0,
  DRAW = 1,
  SETUP = 2,
}

export const enum RotStyle {
  NONE,
  FULL,
  DEG45,
  STATICFRAMES,
}
