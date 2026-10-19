// RetroEngine::Callback (RSDKv3): the EngineCallback opcode. Most callbacks only notified a store front end or
// Sonic Origins' Hedgehog Engine; the ones below change the game's state, as in the decompilation.

import type { Engine3 } from "./engine.js";
import { GetGlobalVariableByName, SetGlobalVariableByName } from "./config.js";
import { ENGINE_EXITGAME, LAYER_3DFLOOR, OBJECT_COUNT, PRIORITY_ALWAYS, STAGELIST_SPECIAL, STAGEMODE_LOAD, STAGEMODE_PAUSED } from "./consts.js";
import { StrComp } from "../strings.js";
import { PauseSound } from "./script/vm.js";
import { ClearGraphicsData } from "./sprite.js";
import { ClearAnimationData } from "./animation.js";
import { LoadPalette } from "./palette.js";

export const CALLBACK_RETURNSTORE_SELECTED = 5;
export const CALLBACK_RESTART_SELECTED = 6;
export const CALLBACK_EXIT_SELECTED = 7;
export const CALLBACK_BUY_FULL_GAME_SELECTED = 8;
export const CALLBACK_PAUSE_REQUESTED = 13;
export const CALLBACK_AGEGATE = 100;
export const CALLBACK_STARTGAME = 101;
export const NOTIFY_ADD_COIN = 131;
export const NOTIFY_FUTURE_PAST = 134;
export const NOTIFY_STATS_MOVIE = 144;
export const NOTIFY_CHARACTER_SELECT = 147;
export const NOTIFY_SPECIAL_RETRY = 148;
export const NOTIFY_CONTROLLER_SUPPORT = 152;
export const CALLBACK_ONSHOWREWARDADS = 1018;
export const CALLBACK_SET1P = 0x1001;
export const CALLBACK_SET2P = 0x1002;

export function EngineCallback(E: Engine3, callbackID: number): void {
  const param1 = GetGlobalVariableByName(E, "game.callbackParam0");
  switch (callbackID) {
    case CALLBACK_RETURNSTORE_SELECTED:
    case CALLBACK_BUY_FULL_GAME_SELECTED:
      E.gameMode = ENGINE_EXITGAME;
      break;
    case CALLBACK_RESTART_SELECTED:
      E.stageMode = STAGEMODE_LOAD;
      break;
    case CALLBACK_EXIT_SELECTED:
      E.activeStageList = 0;
      E.stageListPosition = 0;
      E.stageMode = STAGEMODE_LOAD;
      break;
    case CALLBACK_PAUSE_REQUESTED:
      E.stageMode = STAGEMODE_PAUSED;
      PauseSound(E);
      for (let o = 0; o < OBJECT_COUNT; ++o) {
        if (!StrComp("PauseMenu", E.typeNames[o])) continue;
        const pause = E.objectEntityList[9];
        pause.type = o;
        pause.drawOrder = 6;
        pause.priority = PRIORITY_ALWAYS;
        if (E.activeStageList === STAGELIST_SPECIAL) E.stageLayouts[0].type = LAYER_3DFLOOR;
        for (let s = 0; s < E.globalSFXCount + E.stageSFXCount; ++s) {
          const name = E.sfxList[s].name;
          if (StrComp("Global/Select.wav", name)) E.host.playSfx(s, 0);
          if (StrComp("Global/Flying.wav", name) || StrComp("Global/Tired.wav", name)) E.host.stopSfx(s);
        }
      }
      break;
    case CALLBACK_AGEGATE:
      SetGlobalVariableByName(E, "HaveLoadAllGDPRValue", 1);
      break;
    case CALLBACK_STARTGAME:
      SetGlobalVariableByName(E, "Config.NumOfLives", 3);
      SetGlobalVariableByName(E, "Config.IsPremiumUser", 1);
      break;
    case NOTIFY_ADD_COIN:
      SetGlobalVariableByName(E, "game.coinCount", GetGlobalVariableByName(E, "game.coinCount") + param1);
      break;
    case NOTIFY_FUTURE_PAST:
      E.objectEntityList[E.objectLoop].state++;
      break;
    case NOTIFY_STATS_MOVIE:
      ClearGraphicsData(E);
      ClearAnimationData(E);
      LoadPalette(E, "MasterPalette.act", 0, 0, 0, 256);
      E.activeStageList = 0;
      E.stageMode = STAGEMODE_LOAD;
      E.stageListPosition = 0;
      break;
    case NOTIFY_CHARACTER_SELECT:
      SetGlobalVariableByName(E, "game.callbackResult", 1);
      SetGlobalVariableByName(E, "game.continueFlag", 0);
      break;
    case NOTIFY_SPECIAL_RETRY:
    case NOTIFY_CONTROLLER_SUPPORT:
      SetGlobalVariableByName(E, "game.callbackResult", 1);
      break;
    case CALLBACK_ONSHOWREWARDADS:
      SetGlobalVariableByName(E, "RewardAdCallback", 1);
      break;
    case CALLBACK_SET1P:
      E.activePlayerCount = 1;
      break;
    case CALLBACK_SET2P:
      E.activePlayerCount = 2;
      break;
    default:
      break;
  }
}
