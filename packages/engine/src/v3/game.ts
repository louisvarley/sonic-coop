// A Sonic CD (RSDKv3) game instance: the engine plus the per-frame loop of the original (RetroEngine::Run /
// ProcessStage), driven by one pad per player. Same shape as the v4 GameSim, so the server and the netcode can drive
// either.

import { Engine3, MAX_PLAYERS3 } from "./engine.js";
import type { ScriptHost } from "../host.js";
import type { Vfs } from "../core/pak.js";
import type { GameEvent, GameOptions } from "../game.js";
import { BTN } from "../input.js";
import * as C from "./consts.js";
import { LoadGameConfig, GetGlobalVariableByName, SetGlobalVariableByName } from "./config.js";
import { ProcessStage, LoadStageFiles, actKey } from "./scene.js";
import { ClearGraphicsData } from "./sprite.js";
import { ClearAnimationData } from "./animation.js";
import { SetActivePalette, LoadPalette } from "./palette.js";
import { captureState, restoreState } from "../state.js";

export class GameSim3 {
  readonly E: Engine3;
  /** Which camera this instance renders (its local player). */
  viewCamera = 0;
  /** GameConfig player list entry for player 1. */
  playerListPos = 0;
  private lastLoadCount = 0;

  constructor(vfs: Vfs, host: ScriptHost, readonly opts: GameOptions) {
    const E = (this.E = new Engine3(vfs, host, { headless: opts.headless }));
    E.gameConfig = LoadGameConfig(E);
    // LoadGlobalSfx
    E.globalSFXCount = E.gameConfig.sfxPaths.length;
    E.gameConfig.sfxPaths.forEach((path, i) => {
      E.sfxList[i].name = path;
      host.loadSfx?.(i, path);
    });
    LoadPalette(E, "MasterPalette.act", 0, 0, 0, 256);
    this.setPlayers(opts.players);
  }

  setPlayers(n: number): void {
    const E = this.E;
    E.playerSlots = Math.max(1, Math.min(MAX_PLAYERS3, n));
    E.camCount = E.playerSlots;
  }

  global(name: string): number {
    return GetGlobalVariableByName(this.E, name);
  }

  setGlobal(name: string, value: number): void {
    SetGlobalVariableByName(this.E, name, value);
  }

  /**
   * Set up a new game as the title screen's "no save" start does (characters: 0 Sonic, 1 Tails, 2 Knuckles; Amy is
   * only spawned by the Use_Origins script platform). Up to two players play; any others in the room watch a camera.
   * Call before startStage.
   */
  configurePlayers(characters: number[], lives = 3): void {
    this.setPlayers(Math.min(MAX_PLAYERS3, Math.max(1, characters.length)));
    const E = this.E;
    E.playerChars.fill(0);
    for (let p = 0; p < MAX_PLAYERS3; p++) E.playerChars[p] = this.playerListPosOf(characters[p] ?? characters[0] ?? 0);
    this.playerListPos = E.playerChars[0];
    this.setGlobal("Options.GameMode", 0); // MODE_NOSAVE
    this.setGlobal("Options.AttractMode", 0);
    this.setGlobal("Player.Score", 0);
    this.setGlobal("Player.Lives", lives);
    this.setGlobal("Player.ScoreBonus", 50000);
    this.setGlobal("LampPost.Check", 0);
    this.setGlobal("Good_Future", 0);
  }

  /** Stage.PlayerListPos of a character: the game's PLAYER_* globals (Origins numbers Amy 5), else the list index. */
  playerListPosOf(character: number): number {
    const name = ["PLAYER_SONIC", "PLAYER_TAILS", "PLAYER_KNUCKLES", "PLAYER_AMY"][character];
    const id = name ? this.E.globalVariableNames.indexOf(name) : -1;
    return id >= 0 ? this.E.globalVariables[id] : character;
  }

  /** Start a stage from a list (0 presentation, 1 regular, 2 bonus, 3 special). */
  startStage(list: number, stage: number, playerListPos = this.playerListPos): void {
    const E = this.E;
    E.host.stopMusic();
    E.musicStatus = 0;
    E.fadeMode = 0;
    E.playerListPos = playerListPos;
    ClearGraphicsData(E);
    ClearAnimationData(E);
    E.currentStageFolder = "";
    E.activeStageList = list;
    E.activePaletteID = 0;
    SetActivePalette(E, 0, 0, 256);
    E.stageMode = C.STAGEMODE_LOAD;
    E.gameMode = C.ENGINE_MAINGAME;
    E.stageListPosition = stage;
  }

  findStage(name: string, list = C.STAGELIST_REGULAR): number {
    const n = name.replace(/ /g, "").toUpperCase();
    return this.E.stageList[list].findIndex((s) => s.name.replace(/ /g, "").toUpperCase() === n);
  }

  /** Co-op emergency teleport: not available for Sonic CD yet. */
  emergencyTeleport(): { from: number; to: number } | null {
    return null;
  }

  /** Restore a full state (from a snapshot), loading the stage it belongs to if necessary. */
  applyState(buf: Uint8Array): boolean {
    const E = this.E;
    restoreState(E, buf);
    const stage = E.stageList[E.activeStageList]?.[E.stageListPosition];
    if (!stage || E.stageMode === C.STAGEMODE_LOAD || (stage.folder === E.currentStageFolder && E.loadedActKey === actKey(E))) return false;
    LoadStageFiles(E);
    restoreState(E, buf);
    return true;
  }

  captureState(out?: Uint8Array): Uint8Array {
    return captureState(this.E, out);
  }

  /** Advance one 60 Hz frame. `pads[p]` is player p's button mask (see BTN). */
  tick(pads: ArrayLike<number>): GameEvent[] {
    const E = this.E;
    const events: GameEvent[] = [];
    for (let p = 0; p < MAX_PLAYERS3; p++) {
      const down = p < E.playerSlots ? pads[p] | 0 : 0;
      E.inputPress[p] = down & ~E.inputPrev[p];
      E.inputDown[p] = down;
      E.inputPrev[p] = down;
    }
    // The original reads one controller (CheckKeyDown / CheckKeyPress); scripts see player 1's pad.
    E.keyDown = E.inputDown[0] & ~BTN.TELEPORT;
    E.keyPress = E.inputPress[0] & ~BTN.TELEPORT;
    // INPUT_ANY: one of the eight inputs became held this frame
    const ANY = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT | BTN.A | BTN.B | BTN.C | BTN.START;
    E.anyPress = +((E.inputDown[0] & ANY) !== 0 && (E.inputPrevAny & ANY) === 0);
    E.inputPrevAny = E.inputDown[0];
    switch (E.gameMode) {
      case C.ENGINE_MAINGAME:
        if (E.teleportCooldown > 0) E.teleportCooldown--;
        ProcessStage(E, this.viewCamera);
        break;
      case C.ENGINE_ENTER_HIRESMODE:
      case C.ENGINE_EXIT_HIRESMODE:
      case C.ENGINE_VIDEOWAIT:
        E.gameMode = C.ENGINE_MAINGAME;
        break;
      case C.ENGINE_EXITGAME:
        events.push({ type: "endGame" });
        E.gameMode = C.ENGINE_WAIT;
        break;
      case C.ENGINE_SCRIPTERROR:
        events.push({ type: "scriptError", message: E.compiler.errors.map((e) => `${e.script}:${e.line}: ${e.message}`).join("; ") });
        E.gameMode = C.ENGINE_WAIT;
        break;
      default:
        break;
    }
    if (E.stageLoadCount !== this.lastLoadCount) {
      this.lastLoadCount = E.stageLoadCount;
      const s = E.stageList[E.activeStageList][E.stageListPosition];
      events.push({ type: "stageLoaded", list: E.activeStageList, stage: E.stageListPosition, folder: s?.folder ?? "", name: s?.name ?? "" });
    }
    E.tick++;
    return events;
  }
}
