// RSDKv3 (Sonic CD) engine constants, from the decompilation's headers.

// Object.hpp / Player.hpp
export const ENTITY_COUNT = 0x4a0;
export const TEMPENTITY_START = ENTITY_COUNT - 0x80;
export const OBJECT_COUNT = 0x100;
export const PLAYER_COUNT = 2;
export const OBJECT_BORDER_Y1 = 0x100;

export const PRIORITY_BOUNDS = 0;
export const PRIORITY_ACTIVE = 1;
export const PRIORITY_ALWAYS = 2;
export const PRIORITY_XBOUNDS = 3;
export const PRIORITY_BOUNDS_DESTROY = 4;
export const PRIORITY_INACTIVE = 5;

export const CONTROLMODE_NONE = -1;
export const CONTROLMODE_NORMAL = 0;
export const CONTROLMODE_SIDEKICK = 1;

// Script.hpp
export const SCRIPTDATA_COUNT = 0x40000;
export const JUMPTABLE_COUNT = 0x4000;
export const FUNCTION_COUNT = 0x200;
export const JUMPSTACK_COUNT = 0x400;
export const FUNCSTACK_COUNT = 0x400;
export const SUB_MAIN = 0;
export const SUB_PLAYERINTERACTION = 1;
export const SUB_DRAW = 2;
export const SUB_SETUP = 3;

// RetroEngine.hpp / Drawing.hpp
export const SCREEN_YSIZE = 240;
export const SCREEN_CENTERY = SCREEN_YSIZE / 2;
export const DEFAULT_SCREEN_XSIZE = 424;
export const SURFACE_COUNT = 32;
export const GFXDATA_SIZE = 0x800 * 0x800;
export const DRAWLAYER_COUNT = 8;
export const GLOBALVAR_COUNT = 0x100;
export const SAVEDATA_SIZE = 0x2000;

export const ENGINE_DEVMENU = 0;
export const ENGINE_MAINGAME = 1;
export const ENGINE_INITDEVMENU = 2;
export const ENGINE_EXITGAME = 3;
export const ENGINE_SCRIPTERROR = 4;
export const ENGINE_ENTER_HIRESMODE = 5;
export const ENGINE_EXIT_HIRESMODE = 6;
export const ENGINE_PAUSE = 7;
export const ENGINE_WAIT = 8;
export const ENGINE_VIDEOWAIT = 9;

export const FLIP_NONE = 0;
export const FLIP_X = 1;
export const FLIP_Y = 2;
export const FLIP_XY = 3;
export const INK_NONE = 0;
export const INK_BLEND = 1;
export const INK_ALPHA = 2;
export const INK_ADD = 3;
export const INK_SUB = 4;
export const FX_SCALE = 0;
export const FX_ROTATE = 1;
export const FX_ROTOZOOM = 2;
export const FX_INK = 3;
export const FX_TINT = 4;
export const FX_FLIP = 5;

// Scene.hpp
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
export const TILELAYER_SCROLL_COUNT = TILELAYER_CHUNK_H * CHUNK_SIZE;
export const CHUNKTILE_COUNT = 0x200 * (8 * 8);
export const CPATH_COUNT = 2;

export const STAGELIST_PRESENTATION = 0;
export const STAGELIST_REGULAR = 1;
export const STAGELIST_BONUS = 2;
export const STAGELIST_SPECIAL = 3;
export const STAGELIST_MAX = 4;

export const LAYER_NOSCROLL = 0;
export const LAYER_HSCROLL = 1;
export const LAYER_VSCROLL = 2;
export const LAYER_3DFLOOR = 3;
export const LAYER_3DSKY = 4;

export const STAGEMODE_LOAD = 0;
export const STAGEMODE_NORMAL = 1;
export const STAGEMODE_PAUSED = 2;

export const TILEINFO_INDEX = 0;
export const TILEINFO_DIRECTION = 1;
export const TILEINFO_VISUALPLANE = 2;
export const TILEINFO_SOLIDITYA = 3;
export const TILEINFO_SOLIDITYB = 4;
export const TILEINFO_FLAGSA = 5;
export const TILEINFO_ANGLEA = 6;
export const TILEINFO_FLAGSB = 7;
export const TILEINFO_ANGLEB = 8;

export const DEFORM_FG = 0;
export const DEFORM_FG_WATER = 1;
export const DEFORM_BG = 2;
export const DEFORM_BG_WATER = 3;

export const CAMERASTYLE_FOLLOW = 0;
export const CAMERASTYLE_EXTENDED = 1;
export const CAMERASTYLE_EXTENDED_OFFSET_L = 2;
export const CAMERASTYLE_EXTENDED_OFFSET_R = 3;
export const CAMERASTYLE_HLOCKED = 4;

// Animation.hpp
export const ANIFILE_COUNT = 0x100;
export const ANIMATION_COUNT = 0x400;
export const SPRITEFRAME_COUNT = 0x1000;
export const HITBOX_COUNT = 0x20;
export const ROTSTYLE_NONE = 0;
export const ROTSTYLE_FULL = 1;
export const ROTSTYLE_45DEG = 2;
export const ROTSTYLE_STATICFRAMES = 3;

// Palette.hpp
export const PALETTE_COUNT = 8;
export const PALETTE_SIZE = 0x100;

// Audio.hpp
export const TRACK_COUNT = 0x10;
export const SFX_COUNT = 0x100;
export const MAX_VOLUME = 100;

// Collision.hpp
export const COLSTORE_COUNT = 2;
export const CSIDE_FLOOR = 0;
export const CSIDE_LWALL = 1;
export const CSIDE_RWALL = 2;
export const CSIDE_ROOF = 3;
export const CSIDE_ENTITY = 4;
export const CMODE_FLOOR = 0;
export const CMODE_LWALL = 1;
export const CMODE_ROOF = 2;
export const CMODE_RWALL = 3;
export const SOLID_ALL = 0;
export const SOLID_TOP = 1;
export const SOLID_LRB = 2;
export const SOLID_NONE = 3;
export const C_TOUCH = 0;
export const C_BOX = 1;
export const C_BOX2 = 2;
export const C_PLATFORM = 3;
export const C_BOX3 = 4;
export const C_ENEMY = 5;
export const ECEFFECT_NONE = 0;
export const ECEFFECT_RESETSTORAGE = 1;
export const ECEFFECT_BOXCOL3 = 2;

// Scene3D.hpp
export const VERTEXBUFFER_SIZE = 0x1000;
export const FACEBUFFER_SIZE = 0x400;

// Text.hpp
export const TEXTDATA_COUNT = 0x2800;
export const TEXTENTRY_COUNT = 0x200;
export const TEXTMENU_COUNT = 0x2;
