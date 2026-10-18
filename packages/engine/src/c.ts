// Enum values under their original C names, so ported code reads like the decompilation it came from.

export * from "./consts.js";

export const PRIORITY_BOUNDS = 0;
export const PRIORITY_ACTIVE = 1;
export const PRIORITY_ALWAYS = 2;
export const PRIORITY_XBOUNDS = 3;
export const PRIORITY_XBOUNDS_DESTROY = 4;
export const PRIORITY_INACTIVE = 5;
export const PRIORITY_BOUNDS_SMALL = 6;
export const PRIORITY_ACTIVE_SMALL = 7;

export const STAGEMODE_LOAD = 0;
export const STAGEMODE_NORMAL = 1;
export const STAGEMODE_PAUSED = 2;
export const STAGEMODE_FROZEN = 3;
export const STAGEMODE_2P = 4;
export const STAGEMODE_NORMAL_STEP = 5;
export const STAGEMODE_PAUSED_STEP = 6;
export const STAGEMODE_FROZEN_STEP = 7;
export const STAGEMODE_2P_STEP = 8;

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

export const CAMERASTYLE_FOLLOW = 0;
export const CAMERASTYLE_EXTENDED = 1;
export const CAMERASTYLE_EXTENDED_OFFSET_L = 2;
export const CAMERASTYLE_EXTENDED_OFFSET_R = 3;
export const CAMERASTYLE_HLOCKED = 4;

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

export const CSIDE_FLOOR = 0;
export const CSIDE_LWALL = 1;
export const CSIDE_RWALL = 2;
export const CSIDE_ROOF = 3;
export const CSIDE_LENTITY = 4;
export const CSIDE_RENTITY = 5;

export const CMODE_FLOOR = 0;
export const CMODE_LWALL = 1;
export const CMODE_ROOF = 2;
export const CMODE_RWALL = 3;

export const SOLID_ALL = 0;
export const SOLID_TOP = 1;
export const SOLID_LRB = 2;
export const SOLID_NONE = 3;
export const SOLID_TOP_NOGRIP = 4;

export const C_TOUCH = 0;
export const C_SOLID = 1;
export const C_SOLID2 = 2;
export const C_PLATFORM = 3;

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

export const ENGINE_DEVMENU = 0;
export const ENGINE_MAINGAME = 1;
export const ENGINE_INITDEVMENU = 2;
export const ENGINE_WAIT = 3;
export const ENGINE_SCRIPTERROR = 4;
export const ENGINE_INITPAUSE = 5;
export const ENGINE_EXITPAUSE = 6;
export const ENGINE_ENDGAME = 7;
export const ENGINE_RESETGAME = 8;

export const EVENT_MAIN = 0;
export const EVENT_DRAW = 1;
export const EVENT_SETUP = 2;

export const ROTSTYLE_NONE = 0;
export const ROTSTYLE_FULL = 1;
export const ROTSTYLE_45DEG = 2;
export const ROTSTYLE_STATICFRAMES = 3;

export const MAT_WORLD = 0;
export const MAT_VIEW = 1;
export const MAT_TEMP = 2;

export const TEXTINFO_TEXTDATA = 0;
export const TEXTINFO_TEXTSIZE = 1;
export const TEXTINFO_ROWCOUNT = 2;

export const RETRO_STANDARD = 0;
export const RETRO_MOBILE = 1;

export const OBJECT_BORDER_Y1 = 0x100;
export const OBJECT_BORDER_Y3 = 0x80;
export const OBJECT_BORDER_Y2 = 240 + 0x100;
export const OBJECT_BORDER_Y4 = 240 + 0x80;
export const SCREEN_SCROLL_UP = 240 / 2 - 16;
export const SCREEN_SCROLL_DOWN = 240 / 2 + 16;
