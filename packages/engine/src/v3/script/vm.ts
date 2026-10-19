// The RetroScript v3 interpreter (Script.cpp: ProcessScript), ported faithfully. Player variables address
// playerList[activePlayer] and, for the entity half of the player, its bound entity (as in the original).

import type { Engine3, ObjectScript3 } from "../engine.js";
import { VAR, FUNC } from "./ids.js";
import { FUNCTIONS } from "./tables.js";
import * as C from "../consts.js";
import { BTN } from "../../input.js";
import { Sin512, Cos512, Sin256, Cos256, ArcTanLookup, nextRand } from "../../math.js";
import { StrComp, FindStringToken } from "../../strings.js";
import { AddGraphicsFile, RemoveGraphicsFile } from "../sprite.js";
import { AddAnimationFile, ProcessObjectAnimation } from "../animation.js";
import { LoadPalette, RotatePalette, SetFade, SetActivePalette, SetLimitedFade, CopyPalette } from "../palette.js";
import { SetupTextMenu, AddTextMenuEntry, EditTextMenuEntry, LoadFontFile, LoadTextFile } from "../text.js";
import {
  TouchCollision, BoxCollision, BoxCollision2, BoxCollision3, PlatformCollision, EnemyCollision,
  ObjectFloorCollision, ObjectLWallCollision, ObjectRWallCollision, ObjectRoofCollision,
  ObjectFloorGrip, ObjectLWallGrip, ObjectRWallGrip, ObjectRoofGrip, ObjectEntityGrip, ProcessPlayerTileCollisions,
} from "../collision.js";
import { ProcessPlayerControl } from "../object.js";
import { SetLayerDeformation, Copy16x16Tile } from "../scene.js";
import {
  SetIdentityMatrix, MatrixMultiply, MatrixTranslateXYZ, MatrixScaleXYZ, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixRotateXYZ, TransformVerticies,
} from "../scene3d.js";
import { EngineCallback } from "../callbacks.js";

const SCRIPTVAR_VAR = 1, SCRIPTVAR_INTCONST = 2, SCRIPTVAR_STRCONST = 3;
const VARARR_NONE = 0, VARARR_ARRAY = 1, VARARR_ENTNOPLUS1 = 2, VARARR_ENTNOMINUS1 = 3;
const OPSIZE = FUNCTIONS.map(([, n]) => n);

const KEY_BITS = [BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, BTN.A, BTN.B, BTN.C, BTN.START];
const keyBit = (mask: number, i: number) => ((mask & KEY_BITS[i]) !== 0 ? 1 : 0);
const setKeyBit = (mask: number, i: number, v: number) => (v ? mask | KEY_BITS[i] : mask & ~KEY_BITS[i]);

function outOfBounds(E: Engine3, xpos: number, ypos: number): number {
  const x = xpos >> 16;
  if (x <= E.xScrollOffset - E.OBJECT_BORDER_X1 || x >= E.OBJECT_BORDER_X2 + E.xScrollOffset) return 1;
  const y = ypos >> 16;
  return y <= E.yScrollOffset - C.OBJECT_BORDER_Y1 || y >= E.yScrollOffset + C.SCREEN_YSIZE + 0x100 ? 1 : 0;
}

function playerHitbox(E: Engine3, side: "left" | "top" | "right" | "bottom"): number {
  const plr = E.playerList[E.activePlayer];
  const animFile = E.animationFileList[plr.animationFile];
  const ent = E.objectEntityList[plr.boundEntity];
  const h = E.animFrames[E.animationList[animFile.aniListOffset + ent.animation].frameListOffset + ent.frame].hitboxID;
  return E.hitboxList[animFile.hitboxListOffset + h][side][0];
}

function getVar(E: Engine3, id: number, arrayVal: number): number {
  const ent = E.objectEntityList[arrayVal];
  const plr = E.playerList[E.activePlayer];
  switch (id) {
    case VAR.TEMPVALUE0: case VAR.TEMPVALUE1: case VAR.TEMPVALUE2: case VAR.TEMPVALUE3:
    case VAR.TEMPVALUE4: case VAR.TEMPVALUE5: case VAR.TEMPVALUE6: case VAR.TEMPVALUE7:
      return E.tempValue[id - VAR.TEMPVALUE0];
    case VAR.CHECKRESULT: return E.checkResult;
    case VAR.ARRAYPOS0: return E.arrayPosition[0];
    case VAR.ARRAYPOS1: return E.arrayPosition[1];
    case VAR.GLOBAL: return E.globalVariables[arrayVal];
    case VAR.OBJECTENTITYNO: return arrayVal;
    case VAR.OBJECTTYPE: return ent.type;
    case VAR.OBJECTPROPERTYVALUE: return ent.propertyValue;
    case VAR.OBJECTXPOS: return ent.xpos;
    case VAR.OBJECTYPOS: return ent.ypos;
    case VAR.OBJECTIXPOS: return ent.xpos >> 16;
    case VAR.OBJECTIYPOS: return ent.ypos >> 16;
    case VAR.OBJECTSTATE: return ent.state;
    case VAR.OBJECTROTATION: return ent.rotation;
    case VAR.OBJECTSCALE: return ent.scale;
    case VAR.OBJECTPRIORITY: return ent.priority;
    case VAR.OBJECTDRAWORDER: return ent.drawOrder;
    case VAR.OBJECTDIRECTION: return ent.direction;
    case VAR.OBJECTINKEFFECT: return ent.inkEffect;
    case VAR.OBJECTALPHA: return ent.alpha;
    case VAR.OBJECTFRAME: return ent.frame;
    case VAR.OBJECTANIMATION: return ent.animation;
    case VAR.OBJECTPREVANIMATION: return ent.prevAnimation;
    case VAR.OBJECTANIMATIONSPEED: return ent.animationSpeed;
    case VAR.OBJECTANIMATIONTIMER: return ent.animationTimer;
    case VAR.OBJECTVALUE0: case VAR.OBJECTVALUE1: case VAR.OBJECTVALUE2: case VAR.OBJECTVALUE3:
    case VAR.OBJECTVALUE4: case VAR.OBJECTVALUE5: case VAR.OBJECTVALUE6: case VAR.OBJECTVALUE7:
      return ent.values[id - VAR.OBJECTVALUE0];
    case VAR.OBJECTOUTOFBOUNDS: return outOfBounds(E, ent.xpos, ent.ypos);
    case VAR.PLAYERSTATE: return E.objectEntityList[plr.boundEntity].state;
    case VAR.PLAYERCONTROLMODE: return plr.controlMode;
    case VAR.PLAYERCONTROLLOCK: return plr.controlLock;
    case VAR.PLAYERCOLLISIONMODE: return plr.collisionMode;
    case VAR.PLAYERCOLLISIONPLANE: return plr.collisionPlane;
    case VAR.PLAYERXPOS: return plr.xpos;
    case VAR.PLAYERYPOS: return plr.ypos;
    case VAR.PLAYERIXPOS: return plr.xpos >> 16;
    case VAR.PLAYERIYPOS: return plr.ypos >> 16;
    case VAR.PLAYERSCREENXPOS: return plr.screenXPos;
    case VAR.PLAYERSCREENYPOS: return plr.screenYPos;
    case VAR.PLAYERSPEED: return plr.speed;
    case VAR.PLAYERXVELOCITY: return plr.xvel;
    case VAR.PLAYERYVELOCITY: return plr.yvel;
    case VAR.PLAYERGRAVITY: return plr.gravity;
    case VAR.PLAYERANGLE: return plr.angle;
    case VAR.PLAYERSKIDDING: return plr.skidding;
    case VAR.PLAYERPUSHING: return plr.pushing;
    case VAR.PLAYERTRACKSCROLL: return plr.trackScroll;
    case VAR.PLAYERUP: return plr.up;
    case VAR.PLAYERDOWN: return plr.down;
    case VAR.PLAYERLEFT: return plr.left;
    case VAR.PLAYERRIGHT: return plr.right;
    case VAR.PLAYERJUMPPRESS: return plr.jumpPress;
    case VAR.PLAYERJUMPHOLD: return plr.jumpHold;
    case VAR.PLAYERFOLLOWPLAYER1: return plr.followPlayer1;
    case VAR.PLAYERLOOKPOS: return plr.lookPos;
    case VAR.PLAYERWATER: return plr.water;
    case VAR.PLAYERTOPSPEED: return plr.topSpeed;
    case VAR.PLAYERACCELERATION: return plr.acceleration;
    case VAR.PLAYERDECELERATION: return plr.deceleration;
    case VAR.PLAYERAIRACCELERATION: return plr.airAcceleration;
    case VAR.PLAYERAIRDECELERATION: return plr.airDeceleration;
    case VAR.PLAYERGRAVITYSTRENGTH: return plr.gravityStrength;
    case VAR.PLAYERJUMPSTRENGTH: return plr.jumpStrength;
    case VAR.PLAYERJUMPCAP: return plr.jumpCap;
    case VAR.PLAYERROLLINGACCELERATION: return plr.rollingAcceleration;
    case VAR.PLAYERROLLINGDECELERATION: return plr.rollingDeceleration;
    case VAR.PLAYERENTITYNO: return plr.entityNo;
    case VAR.PLAYERCOLLISIONLEFT: return playerHitbox(E, "left");
    case VAR.PLAYERCOLLISIONTOP: return playerHitbox(E, "top");
    case VAR.PLAYERCOLLISIONRIGHT: return playerHitbox(E, "right");
    case VAR.PLAYERCOLLISIONBOTTOM: return playerHitbox(E, "bottom");
    case VAR.PLAYERFLAILING: return plr.getFlailing(arrayVal);
    case VAR.PLAYERTIMER: return plr.timer;
    case VAR.PLAYERTILECOLLISIONS: return plr.tileCollisions;
    case VAR.PLAYEROBJECTINTERACTION: return plr.objectInteractions;
    case VAR.PLAYERVISIBLE: return plr.visible;
    case VAR.PLAYERROTATION: return E.objectEntityList[plr.boundEntity].rotation;
    case VAR.PLAYERSCALE: return E.objectEntityList[plr.boundEntity].scale;
    case VAR.PLAYERPRIORITY: return E.objectEntityList[plr.boundEntity].priority;
    case VAR.PLAYERDRAWORDER: return E.objectEntityList[plr.boundEntity].drawOrder;
    case VAR.PLAYERDIRECTION: return E.objectEntityList[plr.boundEntity].direction;
    case VAR.PLAYERINKEFFECT: return E.objectEntityList[plr.boundEntity].inkEffect;
    case VAR.PLAYERALPHA: return E.objectEntityList[plr.boundEntity].alpha;
    case VAR.PLAYERFRAME: return E.objectEntityList[plr.boundEntity].frame;
    case VAR.PLAYERANIMATION: return E.objectEntityList[plr.boundEntity].animation;
    case VAR.PLAYERPREVANIMATION: return E.objectEntityList[plr.boundEntity].prevAnimation;
    case VAR.PLAYERANIMATIONSPEED: return E.objectEntityList[plr.boundEntity].animationSpeed;
    case VAR.PLAYERANIMATIONTIMER: return E.objectEntityList[plr.boundEntity].animationTimer;
    case VAR.PLAYERVALUE0: case VAR.PLAYERVALUE1: case VAR.PLAYERVALUE2: case VAR.PLAYERVALUE3:
    case VAR.PLAYERVALUE4: case VAR.PLAYERVALUE5: case VAR.PLAYERVALUE6: case VAR.PLAYERVALUE7:
      return E.objectEntityList[plr.boundEntity].values[id - VAR.PLAYERVALUE0];
    case VAR.PLAYERVALUE8: case VAR.PLAYERVALUE9: case VAR.PLAYERVALUE10: case VAR.PLAYERVALUE11:
    case VAR.PLAYERVALUE12: case VAR.PLAYERVALUE13: case VAR.PLAYERVALUE14: case VAR.PLAYERVALUE15:
      return plr.values[id - VAR.PLAYERVALUE8];
    case VAR.PLAYEROUTOFBOUNDS: return outOfBounds(E, plr.xpos, plr.ypos);
    case VAR.STAGESTATE: return E.stageMode;
    case VAR.STAGEACTIVELIST: return E.activeStageList;
    case VAR.STAGELISTPOS: return E.stageListPosition;
    case VAR.STAGETIMEENABLED: return E.timeEnabled;
    case VAR.STAGEMILLISECONDS: return E.stageMilliseconds;
    case VAR.STAGESECONDS: return E.stageSeconds;
    case VAR.STAGEMINUTES: return E.stageMinutes;
    case VAR.STAGEACTNO: return E.actID;
    case VAR.STAGEPAUSEENABLED: return E.pauseEnabled;
    case VAR.STAGELISTSIZE: return E.stageListCount[E.activeStageList];
    case VAR.STAGENEWXBOUNDARY1: return E.newXBoundary1;
    case VAR.STAGENEWXBOUNDARY2: return E.newXBoundary2;
    case VAR.STAGENEWYBOUNDARY1: return E.newYBoundary1;
    case VAR.STAGENEWYBOUNDARY2: return E.newYBoundary2;
    case VAR.STAGEXBOUNDARY1: return E.xBoundary1;
    case VAR.STAGEXBOUNDARY2: return E.xBoundary2;
    case VAR.STAGEYBOUNDARY1: return E.yBoundary1;
    case VAR.STAGEYBOUNDARY2: return E.yBoundary2;
    case VAR.STAGEDEFORMATIONDATA0: return E.bgDeformationData0[arrayVal];
    case VAR.STAGEDEFORMATIONDATA1: return E.bgDeformationData1[arrayVal];
    case VAR.STAGEDEFORMATIONDATA2: return E.bgDeformationData2[arrayVal];
    case VAR.STAGEDEFORMATIONDATA3: return E.bgDeformationData3[arrayVal];
    case VAR.STAGEWATERLEVEL: return E.waterLevel;
    case VAR.STAGEACTIVELAYER: return E.activeTileLayers[arrayVal];
    case VAR.STAGEMIDPOINT: return E.tLayerMidPoint;
    case VAR.STAGEPLAYERLISTPOS: return E.playerSlots > 1 ? E.playerChars[E.activePlayer] : E.playerListPos;
    case VAR.STAGEACTIVEPLAYER: return E.activePlayer;
    case VAR.SCREENCAMERAENABLED: return E.cameraEnabled;
    case VAR.SCREENCAMERATARGET: return E.cameraTarget;
    case VAR.SCREENCAMERASTYLE: return E.cameraStyle;
    case VAR.SCREENDRAWLISTSIZE: return E.drawListEntries[arrayVal].listSize;
    case VAR.SCREENCENTERX: return E.SCREEN_CENTERX;
    case VAR.SCREENCENTERY: return C.SCREEN_CENTERY;
    case VAR.SCREENXSIZE: return E.SCREEN_XSIZE;
    case VAR.SCREENYSIZE: return C.SCREEN_YSIZE;
    case VAR.SCREENXOFFSET: return E.xScrollOffset;
    case VAR.SCREENYOFFSET: return E.yScrollOffset;
    case VAR.SCREENSHAKEX: return E.cameraShakeX;
    case VAR.SCREENSHAKEY: return E.cameraShakeY;
    case VAR.SCREENADJUSTCAMERAY: return E.cameraAdjustY;
    case VAR.TOUCHSCREENDOWN: case VAR.TOUCHSCREENXPOS: case VAR.TOUCHSCREENYPOS: return 0;
    case VAR.MUSICVOLUME: return E.masterVolume;
    case VAR.MUSICCURRENTTRACK: return E.trackID;
    case VAR.KEYDOWNUP: case VAR.KEYDOWNDOWN: case VAR.KEYDOWNLEFT: case VAR.KEYDOWNRIGHT:
    case VAR.KEYDOWNBUTTONA: case VAR.KEYDOWNBUTTONB: case VAR.KEYDOWNBUTTONC: case VAR.KEYDOWNSTART:
      return keyBit(E.keyDown, id - VAR.KEYDOWNUP);
    case VAR.KEYPRESSUP: case VAR.KEYPRESSDOWN: case VAR.KEYPRESSLEFT: case VAR.KEYPRESSRIGHT:
    case VAR.KEYPRESSBUTTONA: case VAR.KEYPRESSBUTTONB: case VAR.KEYPRESSBUTTONC: case VAR.KEYPRESSSTART:
      return keyBit(E.keyPress, id - VAR.KEYPRESSUP);
    case VAR.MENU1SELECTION: return E.gameMenu[0].selection1;
    case VAR.MENU2SELECTION: return E.gameMenu[1].selection1;
    case VAR.TILELAYERXSIZE: return E.stageLayouts[arrayVal].xsize;
    case VAR.TILELAYERYSIZE: return E.stageLayouts[arrayVal].ysize;
    case VAR.TILELAYERTYPE: return E.stageLayouts[arrayVal].type;
    case VAR.TILELAYERANGLE: return E.stageLayouts[arrayVal].angle;
    case VAR.TILELAYERXPOS: return E.stageLayouts[arrayVal].xpos;
    case VAR.TILELAYERYPOS: return E.stageLayouts[arrayVal].ypos;
    case VAR.TILELAYERZPOS: return E.stageLayouts[arrayVal].zpos;
    case VAR.TILELAYERPARALLAXFACTOR: return E.stageLayouts[arrayVal].parallaxFactor;
    case VAR.TILELAYERSCROLLSPEED: return E.stageLayouts[arrayVal].scrollSpeed;
    case VAR.TILELAYERSCROLLPOS: return E.stageLayouts[arrayVal].scrollPos;
    case VAR.TILELAYERDEFORMATIONOFFSET: return E.stageLayouts[arrayVal].deformationOffset;
    case VAR.TILELAYERDEFORMATIONOFFSETW: return E.stageLayouts[arrayVal].deformationOffsetW;
    case VAR.HPARALLAXPARALLAXFACTOR: return E.hParallax.parallaxFactor[arrayVal];
    case VAR.HPARALLAXSCROLLSPEED: return E.hParallax.scrollSpeed[arrayVal];
    case VAR.HPARALLAXSCROLLPOS: return E.hParallax.scrollPos[arrayVal];
    case VAR.VPARALLAXPARALLAXFACTOR: return E.vParallax.parallaxFactor[arrayVal];
    case VAR.VPARALLAXSCROLLSPEED: return E.vParallax.scrollSpeed[arrayVal];
    case VAR.VPARALLAXSCROLLPOS: return E.vParallax.scrollPos[arrayVal];
    case VAR.SCENE_3DSCENENOVERTICES: return E.vertexCount;
    case VAR.SCENE_3DSCENENOFACES: return E.faceCount;
    case VAR.VERTEXBUFFERX: return E.vertexBuffer[arrayVal * 5];
    case VAR.VERTEXBUFFERY: return E.vertexBuffer[arrayVal * 5 + 1];
    case VAR.VERTEXBUFFERZ: return E.vertexBuffer[arrayVal * 5 + 2];
    case VAR.VERTEXBUFFERU: return E.vertexBuffer[arrayVal * 5 + 3];
    case VAR.VERTEXBUFFERV: return E.vertexBuffer[arrayVal * 5 + 4];
    case VAR.FACEBUFFERA: return E.faceBuffer[arrayVal * 6];
    case VAR.FACEBUFFERB: return E.faceBuffer[arrayVal * 6 + 1];
    case VAR.FACEBUFFERC: return E.faceBuffer[arrayVal * 6 + 2];
    case VAR.FACEBUFFERD: return E.faceBuffer[arrayVal * 6 + 3];
    case VAR.FACEBUFFERCOLOR: return E.faceBuffer[arrayVal * 6 + 4];
    case VAR.FACEBUFFERFLAG: return E.faceBuffer[arrayVal * 6 + 5];
    case VAR.SCENE_3DSCENEPROJECTIONX: return E.projectionX;
    case VAR.SCENE_3DSCENEPROJECTIONY: return E.projectionY;
    case VAR.ENGINESTATE: return E.gameMode;
    case VAR.STAGEDEBUGMODE: return E.debugMode;
    case VAR.ENGINEMESSAGE: return E.message;
    case VAR.SAVERAM: return E.saveRAM[arrayVal];
    case VAR.ENGINELANGUAGE: return E.language;
    case VAR.OBJECTSPRITESHEET: return E.objectScriptList[ent.type].spriteSheetID;
    case VAR.ENGINEONLINEACTIVE: return 0;
    case VAR.ENGINEFRAMESKIPTIMER: return E.frameSkipTimer;
    case VAR.ENGINEFRAMESKIPSETTING: return E.frameSkipSetting;
    case VAR.ENGINESFXVOLUME: return E.sfxVolume;
    case VAR.ENGINEBGMVOLUME: return E.bgmVolume;
    case VAR.ENGINEPLATFORMID: return 0; // RETRO_WIN
    case VAR.ENGINETRIALMODE: return 0;
    case VAR.KEYPRESSANYSTART: return E.anyPress;
    case VAR.ENGINEHAPTICSENABLED: return E.hapticsEnabled;
    case VAR.STAGEPLAYERCOUNT: return E.playerSlots;
    default: return 0;
  }
}

function setVar(E: Engine3, id: number, arrayVal: number, value: number): void {
  const ent = E.objectEntityList[arrayVal];
  const plr = E.playerList[E.activePlayer];
  const bound = () => E.objectEntityList[plr.boundEntity];
  switch (id) {
    case VAR.TEMPVALUE0: case VAR.TEMPVALUE1: case VAR.TEMPVALUE2: case VAR.TEMPVALUE3:
    case VAR.TEMPVALUE4: case VAR.TEMPVALUE5: case VAR.TEMPVALUE6: case VAR.TEMPVALUE7:
      E.tempValue[id - VAR.TEMPVALUE0] = value; return;
    case VAR.CHECKRESULT: E.checkResult = value; return;
    case VAR.ARRAYPOS0: E.arrayPosition[0] = value; return;
    case VAR.ARRAYPOS1: E.arrayPosition[1] = value; return;
    case VAR.GLOBAL: E.globalVariables[arrayVal] = value; return;
    case VAR.OBJECTENTITYNO: return;
    case VAR.OBJECTTYPE: ent.type = value; return;
    case VAR.OBJECTPROPERTYVALUE: ent.propertyValue = value; return;
    case VAR.OBJECTXPOS: ent.xpos = value; return;
    case VAR.OBJECTYPOS: ent.ypos = value; return;
    case VAR.OBJECTIXPOS: ent.xpos = value << 16; return;
    case VAR.OBJECTIYPOS: ent.ypos = value << 16; return;
    case VAR.OBJECTSTATE: ent.state = value; return;
    case VAR.OBJECTROTATION: ent.rotation = value; return;
    case VAR.OBJECTSCALE: ent.scale = value; return;
    case VAR.OBJECTPRIORITY: ent.priority = value; return;
    case VAR.OBJECTDRAWORDER: ent.drawOrder = value; return;
    case VAR.OBJECTDIRECTION: ent.direction = value; return;
    case VAR.OBJECTINKEFFECT: ent.inkEffect = value; return;
    case VAR.OBJECTALPHA: ent.alpha = value; return;
    case VAR.OBJECTFRAME: ent.frame = value; return;
    case VAR.OBJECTANIMATION: ent.animation = value; return;
    case VAR.OBJECTPREVANIMATION: ent.prevAnimation = value; return;
    case VAR.OBJECTANIMATIONSPEED: ent.animationSpeed = value; return;
    case VAR.OBJECTANIMATIONTIMER: ent.animationTimer = value; return;
    case VAR.OBJECTVALUE0: case VAR.OBJECTVALUE1: case VAR.OBJECTVALUE2: case VAR.OBJECTVALUE3:
    case VAR.OBJECTVALUE4: case VAR.OBJECTVALUE5: case VAR.OBJECTVALUE6: case VAR.OBJECTVALUE7:
      ent.values[id - VAR.OBJECTVALUE0] = value; return;
    case VAR.OBJECTOUTOFBOUNDS: return;
    case VAR.PLAYERSTATE: bound().state = value; return;
    case VAR.PLAYERCONTROLMODE:
      plr.controlMode = value;
      // scripts outside the players (title card, signposts, ...) steer player 1 only: the others follow
      if (E.activePlayer === 0 && E.playerSlots > 1 && E.objectLoop !== 0 && E.objectLoop !== 1 && E.objectLoop !== 5 && E.objectLoop !== 6) {
        for (let p = 1; p < E.playerSlots; p++) E.playerList[p].controlMode = value;
      }
      return;
    case VAR.PLAYERCONTROLLOCK: plr.controlLock = value; return;
    case VAR.PLAYERCOLLISIONMODE: plr.collisionMode = value; return;
    case VAR.PLAYERCOLLISIONPLANE: plr.collisionPlane = value; return;
    case VAR.PLAYERXPOS: plr.xpos = value; return;
    case VAR.PLAYERYPOS: plr.ypos = value; return;
    case VAR.PLAYERIXPOS: plr.xpos = value << 16; return;
    case VAR.PLAYERIYPOS: plr.ypos = value << 16; return;
    case VAR.PLAYERSCREENXPOS: plr.screenXPos = value; return;
    case VAR.PLAYERSCREENYPOS: plr.screenYPos = value; return;
    case VAR.PLAYERSPEED: plr.speed = value; return;
    case VAR.PLAYERXVELOCITY: plr.xvel = value; return;
    case VAR.PLAYERYVELOCITY: plr.yvel = value; return;
    case VAR.PLAYERGRAVITY: plr.gravity = value; return;
    case VAR.PLAYERANGLE: plr.angle = value; return;
    case VAR.PLAYERSKIDDING: plr.skidding = value; return;
    case VAR.PLAYERPUSHING: plr.pushing = value; return;
    case VAR.PLAYERTRACKSCROLL: plr.trackScroll = value; return;
    case VAR.PLAYERUP: plr.up = value; return;
    case VAR.PLAYERDOWN: plr.down = value; return;
    case VAR.PLAYERLEFT: plr.left = value; return;
    case VAR.PLAYERRIGHT: plr.right = value; return;
    case VAR.PLAYERJUMPPRESS: plr.jumpPress = value; return;
    case VAR.PLAYERJUMPHOLD: plr.jumpHold = value; return;
    case VAR.PLAYERFOLLOWPLAYER1: plr.followPlayer1 = value; return;
    case VAR.PLAYERLOOKPOS: plr.lookPos = value; return;
    case VAR.PLAYERWATER: plr.water = value; return;
    case VAR.PLAYERTOPSPEED: plr.topSpeed = value; return;
    case VAR.PLAYERACCELERATION: plr.acceleration = value; return;
    case VAR.PLAYERDECELERATION: plr.deceleration = value; return;
    case VAR.PLAYERAIRACCELERATION: plr.airAcceleration = value; return;
    case VAR.PLAYERAIRDECELERATION: plr.airDeceleration = value; return;
    case VAR.PLAYERGRAVITYSTRENGTH: plr.gravityStrength = value; return;
    case VAR.PLAYERJUMPSTRENGTH: plr.jumpStrength = value; return;
    case VAR.PLAYERJUMPCAP: plr.jumpCap = value; return;
    case VAR.PLAYERROLLINGACCELERATION: plr.rollingAcceleration = value; return;
    case VAR.PLAYERROLLINGDECELERATION: plr.rollingDeceleration = value; return;
    case VAR.PLAYERENTITYNO: case VAR.PLAYERCOLLISIONLEFT: case VAR.PLAYERCOLLISIONTOP:
    case VAR.PLAYERCOLLISIONRIGHT: case VAR.PLAYERCOLLISIONBOTTOM:
      return;
    case VAR.PLAYERFLAILING: plr.setFlailing(arrayVal, value); return;
    case VAR.PLAYERTIMER: plr.timer = value; return;
    case VAR.PLAYERTILECOLLISIONS: plr.tileCollisions = value; return;
    case VAR.PLAYEROBJECTINTERACTION: plr.objectInteractions = value; return;
    case VAR.PLAYERVISIBLE: plr.visible = value; return;
    case VAR.PLAYERROTATION: bound().rotation = value; return;
    case VAR.PLAYERSCALE: bound().scale = value; return;
    case VAR.PLAYERPRIORITY: bound().priority = value; return;
    case VAR.PLAYERDRAWORDER: bound().drawOrder = value; return;
    case VAR.PLAYERDIRECTION: bound().direction = value; return;
    case VAR.PLAYERINKEFFECT: bound().inkEffect = value; return;
    case VAR.PLAYERALPHA: bound().alpha = value; return;
    case VAR.PLAYERFRAME: bound().frame = value; return;
    case VAR.PLAYERANIMATION: bound().animation = value; return;
    case VAR.PLAYERPREVANIMATION: bound().prevAnimation = value; return;
    case VAR.PLAYERANIMATIONSPEED: bound().animationSpeed = value; return;
    case VAR.PLAYERANIMATIONTIMER: bound().animationTimer = value; return;
    case VAR.PLAYERVALUE0: case VAR.PLAYERVALUE1: case VAR.PLAYERVALUE2: case VAR.PLAYERVALUE3:
    case VAR.PLAYERVALUE4: case VAR.PLAYERVALUE5: case VAR.PLAYERVALUE6: case VAR.PLAYERVALUE7:
      bound().values[id - VAR.PLAYERVALUE0] = value; return;
    case VAR.PLAYERVALUE8: case VAR.PLAYERVALUE9: case VAR.PLAYERVALUE10: case VAR.PLAYERVALUE11:
    case VAR.PLAYERVALUE12: case VAR.PLAYERVALUE13: case VAR.PLAYERVALUE14: case VAR.PLAYERVALUE15:
      plr.values[id - VAR.PLAYERVALUE8] = value; return;
    case VAR.PLAYEROUTOFBOUNDS: return;
    case VAR.STAGESTATE: E.stageMode = value; return;
    case VAR.STAGEACTIVELIST: E.activeStageList = value; return;
    case VAR.STAGELISTPOS: E.stageListPosition = value; return;
    case VAR.STAGETIMEENABLED: E.timeEnabled = value; return;
    case VAR.STAGEMILLISECONDS: E.stageMilliseconds = value; return;
    case VAR.STAGESECONDS: E.stageSeconds = value; return;
    case VAR.STAGEMINUTES: E.stageMinutes = value; return;
    case VAR.STAGEACTNO: E.actID = value; return;
    case VAR.STAGEPAUSEENABLED: E.pauseEnabled = value; return;
    case VAR.STAGELISTSIZE: return;
    case VAR.STAGENEWXBOUNDARY1: E.newXBoundary1 = value; return;
    case VAR.STAGENEWXBOUNDARY2: E.newXBoundary2 = value; return;
    case VAR.STAGENEWYBOUNDARY1: E.newYBoundary1 = value; return;
    case VAR.STAGENEWYBOUNDARY2: E.newYBoundary2 = value; return;
    case VAR.STAGEXBOUNDARY1: setBoundary(E, "xBoundary1", "newXBoundary1", value); return;
    case VAR.STAGEXBOUNDARY2: setBoundary(E, "xBoundary2", "newXBoundary2", value); return;
    case VAR.STAGEYBOUNDARY1: setBoundary(E, "yBoundary1", "newYBoundary1", value); return;
    case VAR.STAGEYBOUNDARY2: setBoundary(E, "yBoundary2", "newYBoundary2", value); return;
    case VAR.STAGEDEFORMATIONDATA0: E.bgDeformationData0[arrayVal] = value; return;
    case VAR.STAGEDEFORMATIONDATA1: E.bgDeformationData1[arrayVal] = value; return;
    case VAR.STAGEDEFORMATIONDATA2: E.bgDeformationData2[arrayVal] = value; return;
    case VAR.STAGEDEFORMATIONDATA3: E.bgDeformationData3[arrayVal] = value; return;
    case VAR.STAGEWATERLEVEL: E.waterLevel = value; return;
    case VAR.STAGEACTIVELAYER: E.activeTileLayers[arrayVal] = value; return;
    case VAR.STAGEMIDPOINT: E.tLayerMidPoint = value; return;
    case VAR.STAGEPLAYERLISTPOS:
      if (E.playerSlots <= 1 || E.activePlayer === 0) E.playerListPos = value;
      if (E.playerSlots > 1) E.playerChars[E.activePlayer] = value;
      return;
    case VAR.STAGEACTIVEPLAYER:
      E.activePlayer = value;
      if (E.activePlayer > E.activePlayerCount) E.activePlayer = 0;
      return;
    case VAR.SCREENCAMERAENABLED: E.cameraEnabled = value; return;
    case VAR.SCREENCAMERATARGET: E.cameraTarget = value; return;
    case VAR.SCREENCAMERASTYLE: E.cameraStyle = value; return;
    case VAR.SCREENDRAWLISTSIZE: E.drawListEntries[arrayVal].listSize = value; return;
    case VAR.SCREENXOFFSET:
      E.xScrollOffset = value;
      E.xScrollA = E.xScrollOffset;
      E.xScrollB = E.SCREEN_XSIZE + E.xScrollOffset;
      return;
    case VAR.SCREENYOFFSET:
      E.yScrollOffset = value;
      E.yScrollA = E.yScrollOffset;
      E.yScrollB = C.SCREEN_YSIZE + E.yScrollOffset;
      return;
    case VAR.SCREENSHAKEX: E.cameraShakeX = value; return;
    case VAR.SCREENSHAKEY: E.cameraShakeY = value; return;
    case VAR.SCREENADJUSTCAMERAY: E.cameraAdjustY = value; return;
    case VAR.MUSICVOLUME:
      E.masterVolume = Math.max(0, Math.min(C.MAX_VOLUME, value));
      E.host.setMusicVolume(E.masterVolume);
      return;
    case VAR.KEYDOWNUP: case VAR.KEYDOWNDOWN: case VAR.KEYDOWNLEFT: case VAR.KEYDOWNRIGHT:
    case VAR.KEYDOWNBUTTONA: case VAR.KEYDOWNBUTTONB: case VAR.KEYDOWNBUTTONC: case VAR.KEYDOWNSTART:
      E.keyDown = setKeyBit(E.keyDown, id - VAR.KEYDOWNUP, value); return;
    case VAR.KEYPRESSUP: case VAR.KEYPRESSDOWN: case VAR.KEYPRESSLEFT: case VAR.KEYPRESSRIGHT:
    case VAR.KEYPRESSBUTTONA: case VAR.KEYPRESSBUTTONB: case VAR.KEYPRESSBUTTONC: case VAR.KEYPRESSSTART:
      E.keyPress = setKeyBit(E.keyPress, id - VAR.KEYPRESSUP, value); return;
    case VAR.MENU1SELECTION: E.gameMenu[0].selection1 = value; return;
    case VAR.MENU2SELECTION: E.gameMenu[1].selection1 = value; return;
    case VAR.TILELAYERXSIZE: E.stageLayouts[arrayVal].xsize = value; return;
    case VAR.TILELAYERYSIZE: E.stageLayouts[arrayVal].ysize = value; return;
    case VAR.TILELAYERTYPE: E.stageLayouts[arrayVal].type = value; return;
    case VAR.TILELAYERANGLE: {
      const l = E.stageLayouts[arrayVal];
      l.angle = value;
      if (l.angle < 0) l.angle += 0x200;
      l.angle &= 0x1ff;
      return;
    }
    case VAR.TILELAYERXPOS: E.stageLayouts[arrayVal].xpos = value; return;
    case VAR.TILELAYERYPOS: E.stageLayouts[arrayVal].ypos = value; return;
    case VAR.TILELAYERZPOS: E.stageLayouts[arrayVal].zpos = value; return;
    case VAR.TILELAYERPARALLAXFACTOR: E.stageLayouts[arrayVal].parallaxFactor = value; return;
    case VAR.TILELAYERSCROLLSPEED: E.stageLayouts[arrayVal].scrollSpeed = value; return;
    case VAR.TILELAYERSCROLLPOS: E.stageLayouts[arrayVal].scrollPos = value; return;
    case VAR.TILELAYERDEFORMATIONOFFSET: E.stageLayouts[arrayVal].deformationOffset = value & 0xff; return;
    case VAR.TILELAYERDEFORMATIONOFFSETW: E.stageLayouts[arrayVal].deformationOffsetW = value & 0xff; return;
    case VAR.HPARALLAXPARALLAXFACTOR: E.hParallax.parallaxFactor[arrayVal] = value; return;
    case VAR.HPARALLAXSCROLLSPEED: E.hParallax.scrollSpeed[arrayVal] = value; return;
    case VAR.HPARALLAXSCROLLPOS: E.hParallax.scrollPos[arrayVal] = value; return;
    case VAR.VPARALLAXPARALLAXFACTOR: E.vParallax.parallaxFactor[arrayVal] = value; return;
    case VAR.VPARALLAXSCROLLSPEED: E.vParallax.scrollSpeed[arrayVal] = value; return;
    case VAR.VPARALLAXSCROLLPOS: E.vParallax.scrollPos[arrayVal] = value; return;
    case VAR.SCENE_3DSCENENOVERTICES: E.vertexCount = value; return;
    case VAR.SCENE_3DSCENENOFACES: E.faceCount = value; return;
    case VAR.VERTEXBUFFERX: E.vertexBuffer[arrayVal * 5] = value; return;
    case VAR.VERTEXBUFFERY: E.vertexBuffer[arrayVal * 5 + 1] = value; return;
    case VAR.VERTEXBUFFERZ: E.vertexBuffer[arrayVal * 5 + 2] = value; return;
    case VAR.VERTEXBUFFERU: E.vertexBuffer[arrayVal * 5 + 3] = value; return;
    case VAR.VERTEXBUFFERV: E.vertexBuffer[arrayVal * 5 + 4] = value; return;
    case VAR.FACEBUFFERA: E.faceBuffer[arrayVal * 6] = value; return;
    case VAR.FACEBUFFERB: E.faceBuffer[arrayVal * 6 + 1] = value; return;
    case VAR.FACEBUFFERC: E.faceBuffer[arrayVal * 6 + 2] = value; return;
    case VAR.FACEBUFFERD: E.faceBuffer[arrayVal * 6 + 3] = value; return;
    case VAR.FACEBUFFERCOLOR: E.faceBuffer[arrayVal * 6 + 4] = value; return;
    case VAR.FACEBUFFERFLAG: E.faceBuffer[arrayVal * 6 + 5] = value; return;
    case VAR.SCENE_3DSCENEPROJECTIONX: E.projectionX = value; return;
    case VAR.SCENE_3DSCENEPROJECTIONY: E.projectionY = value; return;
    case VAR.ENGINESTATE: E.gameMode = value; return;
    case VAR.STAGEDEBUGMODE: E.debugMode = value; return;
    case VAR.SAVERAM: E.saveRAM[arrayVal] = value; return;
    case VAR.ENGINELANGUAGE: E.language = value; return;
    case VAR.OBJECTSPRITESHEET: E.objectScriptList[ent.type].spriteSheetID = value; return;
    case VAR.ENGINEFRAMESKIPTIMER: E.frameSkipTimer = value; return;
    case VAR.ENGINEFRAMESKIPSETTING: E.frameSkipSetting = value; return;
    case VAR.ENGINESFXVOLUME: E.sfxVolume = Math.max(0, Math.min(C.MAX_VOLUME, value)); return;
    case VAR.ENGINEBGMVOLUME: E.bgmVolume = Math.max(0, Math.min(C.MAX_VOLUME, value)); return;
    case VAR.ENGINEHAPTICSENABLED: E.hapticsEnabled = value; return;
    default: return;
  }
}

function setBoundary(E: Engine3, cur: "xBoundary1" | "xBoundary2" | "yBoundary1" | "yBoundary2", next: "newXBoundary1" | "newXBoundary2" | "newYBoundary1" | "newYBoundary2", value: number): void {
  if (E[cur] !== value) {
    E[cur] = value;
    E[next] = value;
  }
}

/** Decodes a packed string operand into E.scriptText; returns the new code pointer. */
function readString(E: Engine3, ptr: number): number {
  const code = E.scriptCode;
  const strLen = code[ptr++];
  let s = "";
  for (let c = 0; c < strLen; ++c) {
    switch (c & 3) {
      case 0: s += String.fromCharCode((code[ptr] >>> 24) & 0xff); break;
      case 1: s += String.fromCharCode((code[ptr] >>> 16) & 0xff); break;
      case 2: s += String.fromCharCode((code[ptr] >>> 8) & 0xff); break;
      case 3: s += String.fromCharCode(code[ptr++] & 0xff); break;
    }
  }
  E.scriptText = s;
  return ptr + 1;
}

/** Resolves the array index of a SCRIPTVAR_VAR operand; returns [arrayVal, new pointer]. */
function readArrayVal(E: Engine3, ptr: number): [number, number] {
  const code = E.scriptCode;
  let arrayVal = 0;
  switch (code[ptr++]) {
    case VARARR_NONE: arrayVal = E.objectLoop; break;
    case VARARR_ARRAY:
      if (code[ptr++] === 1) arrayVal = E.arrayPosition[code[ptr++]];
      else arrayVal = code[ptr++];
      break;
    case VARARR_ENTNOPLUS1:
      if (code[ptr++] === 1) arrayVal = E.arrayPosition[code[ptr++]] + E.objectLoop;
      else arrayVal = code[ptr++] + E.objectLoop;
      break;
    case VARARR_ENTNOMINUS1:
      if (code[ptr++] === 1) arrayVal = E.objectLoop - E.arrayPosition[code[ptr++]];
      else arrayVal = E.objectLoop - code[ptr++];
      break;
  }
  return [arrayVal, ptr];
}

function drawFrame(E: Engine3, script: ObjectScript3, frameID: number, x: number, y: number): void {
  const fr = E.scriptFrames[script.frameListOffset + frameID];
  E.draw?.DrawSprite(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, script.spriteSheetID);
}

/** DrawActName: draws a word of the title card text (0 = word 1 right-aligned, 1 = word 1, 2 = word 2). */
function drawActName(E: Engine3, script: ObjectScript3, ops: Int32Array): void {
  const text = E.titleCardText;
  const charAt = (i: number) => (i < text.length ? text.charCodeAt(i) : 0);
  const glyph = (ch: number, spaceIsZero: boolean): number => {
    let c = ch;
    if (c === 32) c = spaceIsZero ? 0 : -1;
    if (c === 45) c = 0;
    if (c >= 48 && c <= 57) c -= 22;
    if (c > 57 && c < 102) c -= 65;
    return c;
  };
  const drawAt = (c: number) => {
    const fr = E.scriptFrames[script.frameListOffset + c];
    E.draw?.DrawSprite(E, ops[1] + fr.pivotX, ops[2] + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, script.spriteSheetID);
    return fr;
  };
  switch (ops[3]) {
    case 0: {
      let charID = 0;
      for (;; ++charID) {
        const next = charAt(charID + 1);
        if (next === 45 || !next) break;
      }
      while (charID >= 0) {
        let c = glyph(charAt(charID), false);
        if (c <= -1) ops[1] -= ops[5] + ops[6];
        else {
          c += ops[0];
          const fr = E.scriptFrames[script.frameListOffset + c];
          ops[1] -= fr.width + ops[6];
          drawAt(c);
        }
        charID--;
      }
      break;
    }
    case 1:
    case 2: {
      let charID = ops[3] === 1 ? 0 : E.titleCardWord2;
      if (ops[4] === 1 && charAt(charID) !== 0) {
        let c = glyph(charAt(charID), ops[3] === 2);
        if (c <= -1) ops[1] += ops[5] + ops[6];
        else {
          c += ops[0];
          const fr = drawAt(c);
          ops[1] += fr.width + ops[6];
        }
        ops[0] += 26;
        charID++;
      }
      while (charAt(charID) !== 0 && (ops[3] === 2 || charAt(charID) !== 45)) {
        let c = glyph(charAt(charID), false);
        if (c <= -1) ops[1] += ops[5] + ops[6];
        else {
          c += ops[0];
          const fr = drawAt(c);
          ops[1] += fr.width + ops[6];
        }
        charID++;
      }
      break;
    }
  }
}

export function ProcessScript(E: Engine3, scriptCodeStart: number, jumpTableStart: number, scriptSub: number): void {
  const code = E.scriptCode;
  const jt = E.jumpTable;
  const jts = E.jumpTableStack;
  const ops = E.operands;
  let running = true;
  let scriptCodePtr = scriptCodeStart;
  let jumpTableStackPos = 0;
  let functionStackPos = 0;
  let guard = 0;

  while (running) {
    if (++guard > 0x400000) {
      E.host.log("script ran too long; stopping");
      return;
    }
    const opcode = code[scriptCodePtr++];
    let opcodeSize = OPSIZE[opcode] ?? 0;
    const scriptCodeOffset = scriptCodePtr;

    // Get values
    for (let i = 0; i < opcodeSize; ++i) {
      const opcodeType = code[scriptCodePtr++];
      if (opcodeType === SCRIPTVAR_VAR) {
        const [arrayVal, p] = readArrayVal(E, scriptCodePtr);
        scriptCodePtr = p;
        ops[i] = getVar(E, code[scriptCodePtr++], arrayVal);
      } else if (opcodeType === SCRIPTVAR_INTCONST) {
        ops[i] = code[scriptCodePtr++];
      } else if (opcodeType === SCRIPTVAR_STRCONST) {
        scriptCodePtr = readString(E, scriptCodePtr);
      }
    }

    const scriptInfo = E.objectScriptList[E.objectEntityList[E.objectLoop].type];
    const entity = E.objectEntityList[E.objectLoop];
    const player = E.playerList[E.activePlayer];
    const draw = E.draw;

    switch (opcode) {
      default: break;
      case FUNC.END: running = false; break;
      case FUNC.EQUAL: ops[0] = ops[1]; break;
      case FUNC.ADD: ops[0] += ops[1]; break;
      case FUNC.SUB: ops[0] -= ops[1]; break;
      case FUNC.INC: ++ops[0]; break;
      case FUNC.DEC: --ops[0]; break;
      case FUNC.MUL: ops[0] = Math.imul(ops[0], ops[1]); break;
      case FUNC.DIV: ops[0] = ops[1] === 0 ? 0 : (ops[0] / ops[1]) | 0; break;
      case FUNC.SHR: ops[0] >>= ops[1]; break;
      case FUNC.SHL: ops[0] <<= ops[1]; break;
      case FUNC.AND: ops[0] &= ops[1]; break;
      case FUNC.OR: ops[0] |= ops[1]; break;
      case FUNC.XOR: ops[0] ^= ops[1]; break;
      case FUNC.MOD: ops[0] = ops[1] === 0 ? 0 : ops[0] % ops[1]; break;
      case FUNC.FLIPSIGN: ops[0] = -ops[0]; break;
      case FUNC.CHECKEQUAL: E.checkResult = +(ops[0] === ops[1]); opcodeSize = 0; break;
      case FUNC.CHECKGREATER: E.checkResult = +(ops[0] > ops[1]); opcodeSize = 0; break;
      case FUNC.CHECKLOWER: E.checkResult = +(ops[0] < ops[1]); opcodeSize = 0; break;
      case FUNC.CHECKNOTEQUAL: E.checkResult = +(ops[0] !== ops[1]); opcodeSize = 0; break;
      case FUNC.IFEQUAL:
        if (ops[1] !== ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IFGREATER:
        if (ops[1] <= ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IFGREATEROREQUAL:
        if (ops[1] < ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IFLOWER:
        if (ops[1] >= ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IFLOWEROREQUAL:
        if (ops[1] > ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.IFNOTEQUAL:
        if (ops[1] === ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0]];
        jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.ELSE:
        opcodeSize = 0;
        scriptCodePtr = scriptCodeStart + jt[jumpTableStart + jts[jumpTableStackPos--] + 1];
        break;
      case FUNC.ENDIF:
        opcodeSize = 0;
        --jumpTableStackPos;
        break;
      case FUNC.WEQUAL:
        if (ops[1] !== ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WGREATER:
        if (ops[1] <= ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WGREATEROREQUAL:
        if (ops[1] < ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WLOWER:
        if (ops[1] >= ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WLOWEROREQUAL:
        if (ops[1] > ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.WNOTEQUAL:
        if (ops[1] === ops[2]) scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 1];
        else jts[++jumpTableStackPos] = ops[0];
        opcodeSize = 0;
        break;
      case FUNC.LOOP:
        opcodeSize = 0;
        scriptCodePtr = scriptCodeStart + jt[jumpTableStart + jts[jumpTableStackPos--]];
        break;
      case FUNC.SWITCH:
        jts[++jumpTableStackPos] = ops[0];
        if (ops[1] < jt[jumpTableStart + ops[0]] || ops[1] > jt[jumpTableStart + ops[0] + 1])
          scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 2];
        else scriptCodePtr = scriptCodeStart + jt[jumpTableStart + ops[0] + 4 + (ops[1] - jt[jumpTableStart + ops[0]])];
        opcodeSize = 0;
        break;
      case FUNC.BREAK:
        opcodeSize = 0;
        scriptCodePtr = scriptCodeStart + jt[jumpTableStart + jts[jumpTableStackPos--] + 3];
        break;
      case FUNC.ENDSWITCH:
        opcodeSize = 0;
        --jumpTableStackPos;
        break;
      case FUNC.RAND: {
        const [s, r] = nextRand(E.rngState);
        E.rngState = s;
        ops[0] = ops[1] === 0 ? 0 : r % ops[1];
        break;
      }
      case FUNC.SIN: ops[0] = Sin512(ops[1]); break;
      case FUNC.COS: ops[0] = Cos512(ops[1]); break;
      case FUNC.SIN256: ops[0] = Sin256(ops[1]); break;
      case FUNC.COS256: ops[0] = Cos256(ops[1]); break;
      case FUNC.SINCHANGE: ops[0] = ops[3] + (Sin512(ops[1]) >> ops[2]) - ops[4]; break;
      case FUNC.COSCHANGE: ops[0] = ops[3] + (Cos512(ops[1]) >> ops[2]) - ops[4]; break;
      case FUNC.ATAN2: ops[0] = ArcTanLookup(ops[1], ops[2]); break;
      case FUNC.INTERPOLATE:
        ops[0] = (Math.imul(ops[2], 0x100 - ops[3]) + Math.imul(ops[3], ops[1])) >> 8;
        break;
      case FUNC.INTERPOLATEXY:
        ops[0] = (Math.imul(ops[3], 0x100 - ops[6]) >> 8) + (Math.imul(ops[6], ops[2]) >> 8);
        ops[1] = (Math.imul(ops[5], 0x100 - ops[6]) >> 8) + (Math.imul(ops[6], ops[4]) >> 8);
        break;
      case FUNC.LOADSPRITESHEET:
        opcodeSize = 0;
        scriptInfo.spriteSheetID = AddGraphicsFile(E, E.scriptText);
        break;
      case FUNC.REMOVESPRITESHEET:
        opcodeSize = 0;
        RemoveGraphicsFile(E, E.scriptText, -1);
        break;
      case FUNC.DRAWSPRITE:
        opcodeSize = 0;
        drawFrame(E, scriptInfo, ops[0], (entity.xpos >> 16) - E.xScrollOffset, (entity.ypos >> 16) - E.yScrollOffset);
        break;
      case FUNC.DRAWSPRITEXY:
        opcodeSize = 0;
        drawFrame(E, scriptInfo, ops[0], (ops[1] >> 16) - E.xScrollOffset, (ops[2] >> 16) - E.yScrollOffset);
        break;
      case FUNC.DRAWSPRITESCREENXY:
        opcodeSize = 0;
        drawFrame(E, scriptInfo, ops[0], ops[1], ops[2]);
        break;
      case FUNC.DRAWTINTRECT:
        opcodeSize = 0;
        draw?.DrawTintRectangle(E, ops[0], ops[1], ops[2], ops[3]);
        break;
      case FUNC.DRAWNUMBERS: {
        // (runs headless too: it consumes the operands, which are part of the state)
        opcodeSize = 0;
        let i = 10;
        if (ops[6]) {
          while (ops[4] > 0) {
            const frameID = ((ops[3] % i) / (i / 10) | 0) + ops[0];
            drawFrame(E, scriptInfo, frameID, ops[1], ops[2]);
            ops[1] -= ops[5];
            i *= 10;
            --ops[4];
          }
        } else {
          let extra = 10;
          if (ops[3]) extra = 10 * ops[3];
          while (ops[4] > 0) {
            if (extra >= i) {
              const frameID = ((ops[3] % i) / (i / 10) | 0) + ops[0];
              drawFrame(E, scriptInfo, frameID, ops[1], ops[2]);
            }
            ops[1] -= ops[5];
            i *= 10;
            --ops[4];
          }
        }
        break;
      }
      case FUNC.DRAWACTNAME:
        opcodeSize = 0;
        drawActName(E, scriptInfo, ops);
        break;
      case FUNC.DRAWMENU:
        opcodeSize = 0;
        E.textMenuSurfaceNo = scriptInfo.spriteSheetID;
        draw?.DrawTextMenu(E, E.gameMenu[ops[0]], ops[1], ops[2], scriptInfo.spriteSheetID);
        break;
      case FUNC.SPRITEFRAME:
        opcodeSize = 0;
        if (scriptSub === C.SUB_SETUP && E.scriptFrameCount < C.SPRITEFRAME_COUNT) {
          const fr = E.scriptFrames[E.scriptFrameCount];
          fr.pivotX = ops[0];
          fr.pivotY = ops[1];
          fr.width = ops[2];
          fr.height = ops[3];
          fr.sprX = ops[4];
          fr.sprY = ops[5];
          ++E.scriptFrameCount;
        }
        break;
      case FUNC.EDITFRAME: {
        opcodeSize = 0;
        const fr = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        fr.pivotX = ops[1];
        fr.pivotY = ops[2];
        fr.width = ops[3];
        fr.height = ops[4];
        fr.sprX = ops[5];
        fr.sprY = ops[6];
        break;
      }
      case FUNC.LOADPALETTE:
        opcodeSize = 0;
        LoadPalette(E, E.scriptText, ops[1], ops[2], ops[3], ops[4]);
        break;
      case FUNC.ROTATEPALETTE:
        opcodeSize = 0;
        RotatePalette(E, ops[0], ops[1], ops[2]);
        break;
      case FUNC.SETSCREENFADE:
        opcodeSize = 0;
        SetFade(E, ops[0], ops[1], ops[2], ops[3]);
        break;
      case FUNC.SETACTIVEPALETTE:
        opcodeSize = 0;
        SetActivePalette(E, ops[0], ops[1], ops[2]);
        break;
      case FUNC.SETPALETTEFADE:
        opcodeSize = 0;
        SetLimitedFade(E, ops[0], ops[1], ops[2], ops[3], ops[4], ops[5], ops[6]);
        break;
      case FUNC.COPYPALETTE:
        opcodeSize = 0;
        CopyPalette(E, ops[0], ops[1]);
        break;
      case FUNC.CLEARSCREEN:
        opcodeSize = 0;
        draw?.ClearScreen(E, ops[0]);
        break;
      case FUNC.DRAWSPRITEFX:
      case FUNC.DRAWSPRITESCREENFX: {
        opcodeSize = 0;
        if (!draw) break;
        const fr = E.scriptFrames[scriptInfo.frameListOffset + ops[0]];
        const world = opcode === FUNC.DRAWSPRITEFX;
        const x = world ? (ops[2] >> 16) - E.xScrollOffset : ops[2];
        const y = world ? (ops[3] >> 16) - E.yScrollOffset : ops[3];
        const sheet = scriptInfo.spriteSheetID;
        switch (ops[1]) {
          case C.FX_SCALE:
            draw.DrawSpriteScaled(E, entity.direction, x, y, -fr.pivotX, -fr.pivotY, entity.scale, entity.scale, fr.width, fr.height, fr.sprX, fr.sprY, sheet);
            break;
          case C.FX_ROTATE:
            draw.DrawSpriteRotated(E, entity.direction, x, y, -fr.pivotX, -fr.pivotY, fr.sprX, fr.sprY, fr.width, fr.height, entity.rotation, sheet);
            break;
          case C.FX_ROTOZOOM:
            draw.DrawSpriteRotozoom(E, entity.direction, x, y, -fr.pivotX, -fr.pivotY, fr.sprX, fr.sprY, fr.width, fr.height, entity.rotation, entity.scale, sheet);
            break;
          case C.FX_INK:
            switch (entity.inkEffect) {
              case C.INK_NONE: draw.DrawSprite(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, sheet); break;
              case C.INK_BLEND: draw.DrawBlendedSprite(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, sheet); break;
              case C.INK_ALPHA: draw.DrawAlphaBlendedSprite(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, entity.alpha, sheet); break;
              case C.INK_ADD: draw.DrawAdditiveBlendedSprite(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, entity.alpha, sheet); break;
              case C.INK_SUB: draw.DrawSubtractiveBlendedSprite(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, entity.alpha, sheet); break;
            }
            break;
          case C.FX_TINT:
            if (entity.inkEffect === C.INK_ALPHA)
              draw.DrawScaledTintMask(E, entity.direction, x, y, -fr.pivotX, -fr.pivotY, entity.scale, entity.scale, fr.width, fr.height, fr.sprX, fr.sprY, sheet);
            else
              draw.DrawSpriteScaled(E, entity.direction, x, y, -fr.pivotX, -fr.pivotY, entity.scale, entity.scale, fr.width, fr.height, fr.sprX, fr.sprY, sheet);
            break;
          case C.FX_FLIP:
            switch (entity.direction) {
              default:
              case C.FLIP_NONE: draw.DrawSpriteFlipped(E, x + fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, C.FLIP_NONE, sheet); break;
              case C.FLIP_X: draw.DrawSpriteFlipped(E, x - fr.width - fr.pivotX, y + fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, C.FLIP_X, sheet); break;
              case C.FLIP_Y: draw.DrawSpriteFlipped(E, x + fr.pivotX, y - fr.height - fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, C.FLIP_Y, sheet); break;
              case C.FLIP_XY: draw.DrawSpriteFlipped(E, x - fr.width - fr.pivotX, y - fr.height - fr.pivotY, fr.width, fr.height, fr.sprX, fr.sprY, C.FLIP_XY, sheet); break;
            }
            break;
        }
        break;
      }
      case FUNC.LOADANIMATION:
        opcodeSize = 0;
        scriptInfo.animFile = AddAnimationFile(E, E.scriptText);
        break;
      case FUNC.SETUPMENU: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        SetupTextMenu(menu, ops[1]);
        menu.selectionCount = ops[2] & 0xff;
        menu.alignment = ops[3] & 0xff;
        break;
      }
      case FUNC.ADDMENUENTRY: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        menu.entryHighlight[menu.rowCount] = ops[2];
        AddTextMenuEntry(menu, E.scriptText);
        break;
      }
      case FUNC.EDITMENUENTRY: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        EditTextMenuEntry(menu, E.scriptText, ops[2]);
        menu.entryHighlight[ops[2]] = ops[3];
        break;
      }
      case FUNC.LOADSTAGE:
        opcodeSize = 0;
        E.stageMode = C.STAGEMODE_LOAD;
        break;
      case FUNC.DRAWRECT:
        opcodeSize = 0;
        draw?.DrawRectangle(E, ops[0], ops[1], ops[2], ops[3], ops[4], ops[5], ops[6], ops[7]);
        break;
      case FUNC.RESETOBJECTENTITY: {
        opcodeSize = 0;
        const e = E.objectEntityList[ops[0]];
        e.type = ops[1];
        e.propertyValue = ops[2];
        e.xpos = ops[3];
        e.ypos = ops[4];
        e.direction = C.FLIP_NONE;
        e.frame = 0;
        e.priority = C.PRIORITY_BOUNDS;
        e.rotation = 0;
        e.state = 0;
        e.drawOrder = 3;
        e.scale = 0x200;
        e.inkEffect = C.INK_NONE;
        e.values.fill(0);
        break;
      }
      case FUNC.PLAYEROBJECTCOLLISION:
        opcodeSize = 0;
        switch (ops[0]) {
          case C.C_TOUCH:
            ops[5] = entity.xpos >> 16;
            ops[6] = entity.ypos >> 16;
            TouchCollision(E, ops[5] + ops[1], ops[6] + ops[2], ops[5] + ops[3], ops[6] + ops[4]);
            break;
          case C.C_BOX:
            BoxCollision(E, entity.xpos + (ops[1] << 16), entity.ypos + (ops[2] << 16), entity.xpos + (ops[3] << 16), entity.ypos + (ops[4] << 16));
            break;
          case C.C_BOX2:
            BoxCollision2(E, entity.xpos + (ops[1] << 16), entity.ypos + (ops[2] << 16), entity.xpos + (ops[3] << 16), entity.ypos + (ops[4] << 16));
            break;
          case C.C_PLATFORM:
            PlatformCollision(E, entity.xpos + (ops[1] << 16), entity.ypos + (ops[2] << 16), entity.xpos + (ops[3] << 16), entity.ypos + (ops[4] << 16));
            break;
          case C.C_BOX3:
            BoxCollision3(E, entity.xpos + (ops[1] << 16), entity.ypos + (ops[2] << 16), entity.xpos + (ops[3] << 16), entity.ypos + (ops[4] << 16));
            break;
          case C.C_ENEMY:
            ops[5] = entity.xpos >> 16;
            ops[6] = entity.ypos >> 16;
            EnemyCollision(E, ops[5] + ops[1], ops[6] + ops[2], ops[5] + ops[3], ops[6] + ops[4]);
            break;
        }
        break;
      case FUNC.CREATETEMPOBJECT: {
        opcodeSize = 0;
        if (E.objectEntityList[E.arrayPosition[2]].type > 0 && ++E.arrayPosition[2] === C.ENTITY_COUNT) E.arrayPosition[2] = C.TEMPENTITY_START;
        const t = E.objectEntityList[E.arrayPosition[2]];
        t.type = ops[0];
        t.propertyValue = ops[1];
        t.xpos = ops[2];
        t.ypos = ops[3];
        t.direction = C.FLIP_NONE;
        t.frame = 0;
        t.priority = C.PRIORITY_ACTIVE;
        t.rotation = 0;
        t.state = 0;
        t.drawOrder = 3;
        t.scale = 512;
        t.inkEffect = C.INK_NONE;
        t.alpha = 0;
        t.animation = 0;
        t.prevAnimation = 0;
        t.animationSpeed = 0;
        t.animationTimer = 0;
        t.values.fill(0);
        break;
      }
      case FUNC.BINDPLAYERTOOBJECT: {
        opcodeSize = 0;
        const p = E.playerList[ops[0]];
        p.animationFile = scriptInfo.animFile.index;
        p.boundEntity = ops[1];
        p.entityNo = ops[1];
        break;
      }
      case FUNC.PLAYERTILECOLLISION:
        opcodeSize = 0;
        if (player.tileCollisions) ProcessPlayerTileCollisions(E, player);
        else {
          player.xpos += player.xvel;
          player.ypos += player.yvel;
        }
        break;
      case FUNC.PROCESSPLAYERCONTROL:
        opcodeSize = 0;
        ProcessPlayerControl(E, player);
        break;
      case FUNC.PROCESSANIMATION:
        ProcessObjectAnimation(E, scriptInfo, entity);
        opcodeSize = 0;
        break;
      case FUNC.DRAWOBJECTANIMATION:
        opcodeSize = 0;
        draw?.DrawObjectAnimation(E, scriptInfo, entity, (entity.xpos >> 16) - E.xScrollOffset, (entity.ypos >> 16) - E.yScrollOffset);
        break;
      case FUNC.DRAWPLAYERANIMATION:
        opcodeSize = 0;
        if (draw && player.visible) {
          if (E.cameraTarget === E.activePlayer) draw.DrawObjectAnimation(E, scriptInfo, entity, player.screenXPos, player.screenYPos);
          else draw.DrawObjectAnimation(E, scriptInfo, entity, (player.xpos >> 16) - E.xScrollOffset, (player.ypos >> 16) - E.yScrollOffset);
        }
        break;
      case FUNC.SETMUSICTRACK:
        opcodeSize = 0;
        E.musicTrackNames[ops[1] & 0xff] = E.scriptText;
        if (ops[2] <= 1) E.host.setMusicTrack(E.scriptText, ops[1] & 0xff, ops[2] !== 0, 0);
        else E.host.setMusicTrack(E.scriptText, ops[1] & 0xff, true, ops[2] >>> 0);
        break;
      case FUNC.PLAYMUSIC:
        opcodeSize = 0;
        PlayMusic(E, ops[0]);
        break;
      case FUNC.STOPMUSIC:
        opcodeSize = 0;
        E.musicStatus = 0;
        E.host.stopMusic();
        break;
      case FUNC.PLAYSFX:
        opcodeSize = 0;
        E.host.playSfx(ops[0], ops[1]);
        break;
      case FUNC.STOPSFX:
        opcodeSize = 0;
        E.host.stopSfx(ops[0]);
        break;
      case FUNC.SETSFXATTRIBUTES:
        opcodeSize = 0;
        E.host.setSfxAttributes(ops[0], ops[1], ops[2]);
        break;
      case FUNC.OBJECTTILECOLLISION:
        opcodeSize = 0;
        switch (ops[0]) {
          case C.CSIDE_FLOOR: ObjectFloorCollision(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_LWALL: ObjectLWallCollision(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_RWALL: ObjectRWallCollision(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_ROOF: ObjectRoofCollision(E, ops[1], ops[2], ops[3]); break;
        }
        break;
      case FUNC.OBJECTTILEGRIP:
        opcodeSize = 0;
        switch (ops[0]) {
          case C.CSIDE_FLOOR: ObjectFloorGrip(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_LWALL: ObjectLWallGrip(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_RWALL: ObjectRWallGrip(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_ROOF: ObjectRoofGrip(E, ops[1], ops[2], ops[3]); break;
          case C.CSIDE_ENTITY: ObjectEntityGrip(E, ops[1], ops[2], ops[3]); break;
        }
        break;
      case FUNC.LOADVIDEO:
        opcodeSize = 0;
        // Videos are not played; an .rsv frame source registers as a (blank) sprite sheet.
        if (FindStringToken(E.scriptText, ".rsv", 1) > -1) scriptInfo.spriteSheetID = AddGraphicsFile(E, E.scriptText);
        break;
      case FUNC.NEXTVIDEOFRAME:
        opcodeSize = 0;
        break;
      case FUNC.PLAYSTAGESFX:
        opcodeSize = 0;
        E.host.playSfx(E.globalSFXCount + ops[0], ops[1]);
        break;
      case FUNC.STOPSTAGESFX:
        opcodeSize = 0;
        E.host.stopSfx(E.globalSFXCount + ops[0]);
        break;
      case FUNC.NOT: ops[0] = ~ops[0]; break;
      case FUNC.DRAW3DSCENE:
        opcodeSize = 0;
        draw?.Draw3DScene(E, scriptInfo.spriteSheetID);
        break;
      case FUNC.SETIDENTITYMATRIX:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) SetIdentityMatrix(m); }
        break;
      case FUNC.MATRIXMULTIPLY:
        opcodeSize = 0;
        { const a = matrix(E, ops[0]), b = matrix(E, ops[1]); if (a && b) MatrixMultiply(a, b); }
        break;
      case FUNC.MATRIXTRANSLATEXYZ:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) MatrixTranslateXYZ(m, ops[1], ops[2], ops[3]); }
        break;
      case FUNC.MATRIXSCALEXYZ:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) MatrixScaleXYZ(m, ops[1], ops[2], ops[3]); }
        break;
      case FUNC.MATRIXROTATEX:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) MatrixRotateX(m, ops[1]); }
        break;
      case FUNC.MATRIXROTATEY:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) MatrixRotateY(m, ops[1]); }
        break;
      case FUNC.MATRIXROTATEZ:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) MatrixRotateZ(m, ops[1]); }
        break;
      case FUNC.MATRIXROTATEXYZ:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) MatrixRotateXYZ(m, ops[1], ops[2], ops[3]); }
        break;
      case FUNC.TRANSFORMVERTICES:
        opcodeSize = 0;
        { const m = matrix(E, ops[0]); if (m) TransformVerticies(E, m, ops[1], ops[2]); }
        break;
      case FUNC.CALLFUNCTION: {
        opcodeSize = 0;
        E.functionStack[functionStackPos++] = scriptCodePtr;
        E.functionStack[functionStackPos++] = jumpTableStart;
        E.functionStack[functionStackPos++] = scriptCodeStart;
        const fn = E.scriptFunctionList[ops[0]];
        scriptCodeStart = fn.ptr.scriptCodePtr;
        jumpTableStart = fn.ptr.jumpTablePtr;
        scriptCodePtr = scriptCodeStart;
        break;
      }
      case FUNC.ENDFUNCTION:
        opcodeSize = 0;
        if (functionStackPos <= 0) {
          running = false;
          break;
        }
        scriptCodeStart = E.functionStack[--functionStackPos];
        jumpTableStart = E.functionStack[--functionStackPos];
        scriptCodePtr = E.functionStack[--functionStackPos];
        break;
      case FUNC.SETLAYERDEFORMATION:
        opcodeSize = 0;
        SetLayerDeformation(E, ops[0], ops[1], ops[2], ops[3], ops[4], ops[5]);
        break;
      case FUNC.CHECKTOUCHRECT:
        opcodeSize = 0;
        E.checkResult = -1;
        break;
      case FUNC.GETTILELAYERENTRY:
        ops[0] = E.stageLayouts[ops[1]].tiles[ops[2] + 0x100 * ops[3]];
        break;
      case FUNC.SETTILELAYERENTRY:
        E.stageLayouts[ops[1]].tiles[ops[2] + 0x100 * ops[3]] = ops[0];
        break;
      case FUNC.GETBIT: ops[0] = (ops[1] & (1 << ops[2])) >> ops[2]; break;
      case FUNC.SETBIT:
        if (ops[2] <= 0) ops[0] &= ~(1 << ops[1]);
        else ops[0] |= 1 << ops[1];
        break;
      case FUNC.PAUSEMUSIC:
        opcodeSize = 0;
        PauseSound(E);
        break;
      case FUNC.RESUMEMUSIC:
        opcodeSize = 0;
        ResumeSound(E);
        break;
      case FUNC.CLEARDRAWLIST:
        opcodeSize = 0;
        E.drawListEntries[ops[0]].listSize = 0;
        break;
      case FUNC.ADDDRAWLISTENTITYREF: {
        opcodeSize = 0;
        const l = E.drawListEntries[ops[0]];
        l.entityRefs[l.listSize++] = ops[1];
        break;
      }
      case FUNC.GETDRAWLISTENTITYREF:
        ops[0] = E.drawListEntries[ops[1]].entityRefs[ops[2]];
        break;
      case FUNC.SETDRAWLISTENTITYREF:
        opcodeSize = 0;
        E.drawListEntries[ops[1]].entityRefs[ops[2]] = ops[0];
        break;
      case FUNC.GET16X16TILEINFO: {
        ops[4] = ops[1] >> 7;
        ops[5] = ops[2] >> 7;
        ops[6] = E.stageLayouts[0].tiles[ops[4] + (ops[5] << 8)] << 6;
        ops[6] += ((ops[1] & 0x7f) >> 4) + 8 * ((ops[2] & 0x7f) >> 4);
        const t = E.tiles128x128;
        const index = t.tileIndex[ops[6]];
        switch (ops[3]) {
          case C.TILEINFO_INDEX: ops[0] = t.tileIndex[ops[6]]; break;
          case C.TILEINFO_DIRECTION: ops[0] = t.direction[ops[6]]; break;
          case C.TILEINFO_VISUALPLANE: ops[0] = t.visualPlane[ops[6]]; break;
          case C.TILEINFO_SOLIDITYA: ops[0] = t.collisionFlags[0][ops[6]]; break;
          case C.TILEINFO_SOLIDITYB: ops[0] = t.collisionFlags[1][ops[6]]; break;
          case C.TILEINFO_FLAGSA: ops[0] = E.collisionMasks[0].flags[index]; break;
          case C.TILEINFO_ANGLEA: ops[0] = E.collisionMasks[0].angles[index] | 0; break;
          case C.TILEINFO_FLAGSB: ops[0] = E.collisionMasks[1].flags[index]; break;
          case C.TILEINFO_ANGLEB: ops[0] = E.collisionMasks[1].angles[index] | 0; break;
        }
        break;
      }
      case FUNC.COPY16X16TILE:
        opcodeSize = 0;
        Copy16x16Tile(E, ops[0], ops[1]);
        break;
      case FUNC.SET16X16TILEINFO: {
        ops[4] = ops[1] >> 7;
        ops[5] = ops[2] >> 7;
        ops[6] = E.stageLayouts[0].tiles[ops[4] + (ops[5] << 8)] << 6;
        ops[6] += ((ops[1] & 0x7f) >> 4) + 8 * ((ops[2] & 0x7f) >> 4);
        const t = E.tiles128x128;
        switch (ops[3]) {
          case C.TILEINFO_INDEX:
            t.tileIndex[ops[6]] = ops[0];
            t.gfxDataPos[ops[6]] = ops[0] << 8;
            break;
          case C.TILEINFO_DIRECTION: t.direction[ops[6]] = ops[0]; break;
          case C.TILEINFO_VISUALPLANE: t.visualPlane[ops[6]] = ops[0]; break;
          case C.TILEINFO_SOLIDITYA: t.collisionFlags[0][ops[6]] = ops[0]; break;
          case C.TILEINFO_SOLIDITYB: t.collisionFlags[1][ops[6]] = ops[0]; break;
          case C.TILEINFO_FLAGSA: E.collisionMasks[1].flags[t.tileIndex[ops[6]]] = ops[0]; break;
          case C.TILEINFO_ANGLEA: E.collisionMasks[1].angles[t.tileIndex[ops[6]]] = ops[0]; break;
        }
        break;
      }
      case FUNC.GETANIMATIONBYNAME: {
        const animFile = scriptInfo.animFile;
        ops[0] = -1;
        let id = 0;
        while (ops[0] === -1) {
          const anim = E.animationList[animFile.aniListOffset + id];
          if (StrComp(E.scriptText, anim.name)) ops[0] = id;
          else if (++id >= animFile.animCount) ops[0] = 0;
        }
        break;
      }
      case FUNC.READSAVERAM:
        opcodeSize = 0;
        E.checkResult = 1;
        break;
      case FUNC.WRITESAVERAM:
        opcodeSize = 0;
        E.checkResult = 1;
        break;
      case FUNC.LOADTEXTFONT:
        opcodeSize = 0;
        LoadFontFile(E, E.scriptText);
        break;
      case FUNC.LOADTEXTFILE:
        opcodeSize = 0;
        LoadTextFile(E, E.gameMenu[ops[0]], E.scriptText, ops[2] !== 0);
        break;
      case FUNC.DRAWTEXT:
        opcodeSize = 0;
        E.textMenuSurfaceNo = scriptInfo.spriteSheetID;
        draw?.DrawBitmapText(E, E.gameMenu[ops[0]], ops[1], ops[2], ops[3], ops[4], ops[5], ops[6], scriptInfo.spriteSheetID);
        break;
      case FUNC.GETTEXTINFO: {
        const menu = E.gameMenu[ops[1]];
        switch (ops[2]) {
          case 0: ops[0] = menu.textData[menu.entryStart[ops[3]] + ops[4]]; break;
          case 1: ops[0] = menu.entrySize[ops[3]]; break;
          case 2: ops[0] = menu.rowCount; break;
        }
        break;
      }
      case FUNC.GETVERSIONNUMBER: {
        opcodeSize = 0;
        const menu = E.gameMenu[ops[0]];
        menu.entryHighlight[menu.rowCount] = ops[1];
        AddTextMenuEntry(menu, "1.3.3");
        break;
      }
      case FUNC.SETACHIEVEMENT:
      case FUNC.SETLEADERBOARD:
      case FUNC.LOADONLINEMENU:
      case FUNC.HAPTICEFFECT:
        opcodeSize = 0;
        break;
      case FUNC.ENGINECALLBACK:
        opcodeSize = 0;
        EngineCallback(E, ops[0]);
        break;
    }

    // Set values
    if (opcodeSize > 0) scriptCodePtr = scriptCodeOffset;
    for (let i = 0; i < opcodeSize; ++i) {
      const opcodeType = code[scriptCodePtr++];
      if (opcodeType === SCRIPTVAR_VAR) {
        const [arrayVal, p] = readArrayVal(E, scriptCodePtr);
        scriptCodePtr = p;
        setVar(E, code[scriptCodePtr++], arrayVal, ops[i]);
      } else if (opcodeType === SCRIPTVAR_INTCONST) {
        scriptCodePtr++;
      } else if (opcodeType === SCRIPTVAR_STRCONST) {
        const strLen = code[scriptCodePtr++];
        scriptCodePtr += (strLen >> 2) + 1;
      }
    }
  }
}

function matrix(E: Engine3, id: number) {
  switch (id) {
    case 0: return E.matWorld;
    case 1: return E.matView;
    case 2: return E.matTemp;
    default: return null;
  }
}

/** PlayMusic: starts a track that has a file set, otherwise stops the music. */
export function PlayMusic(E: Engine3, track: number): void {
  const name = E.musicTrackNames[track & 0xff] ?? "";
  if (name.length) {
    E.trackID = track;
    E.musicStatus = 1;
    E.host.playMusic(track, 0);
  } else {
    E.musicStatus = 0;
    E.host.stopMusic();
  }
}

export function PauseSound(E: Engine3): void {
  if (E.musicStatus === 1) {
    E.musicStatus = 2;
    E.host.pauseMusic();
  }
}

export function ResumeSound(E: Engine3): void {
  if (E.musicStatus === 2) {
    E.musicStatus = 1;
    E.host.resumeMusic();
  }
}
