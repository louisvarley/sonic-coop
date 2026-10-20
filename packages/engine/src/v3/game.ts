// A Sonic CD (RSDKv3) game instance: the engine plus the per-frame loop of the original (RetroEngine::Run /
// ProcessStage), driven by one pad per player. Same shape as the v4 GameSim, so the server and the netcode can drive
// either.

import { Engine3, MAX_PLAYERS3 } from "./engine.js";
import type { ScriptHost } from "../host.js";
import type { Vfs } from "../core/pak.js";
import { ARENA_MARGIN_X, ARENA_MARGIN_Y, ARENA_MAX_WIDTH } from "../arena.js";
import { DEFAULT_SETTINGS, type GameSettings } from "../settings.js";
import { INFINITE_LIVES, TELEPORT_COOLDOWN, type GameEvent, type GameOptions, type TeleportResult } from "../game.js";
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
  configurePlayers(characters: number[], settings: GameSettings = DEFAULT_SETTINGS, lives = 3): void {
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
    this.setGlobal("Coop.InfiniteLives", +settings.infiniteLives);
    this.setGlobal("Coop.TailsFlight", +settings.tailsFlight);
    this.setGlobal("Coop.PeelOut", +settings.peelOut);
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

  private scriptFunction(name: string): number {
    return this.E.scriptFunctionList.findIndex((f) => f.name === name);
  }

  /** A player is "in play" when it is a live, colliding player (not dying, warping or in a cutscene). */
  private inPlay(p: number): boolean {
    const E = this.E;
    const plr = E.playerList[p];
    if (!plr.objectInteractions || !plr.tileCollisions) return false;
    const state = E.objectEntityList[plr.boundEntity]?.state ?? -1;
    return !["Player_State_Death", "Player_State_Drown", "Player_State_OuttaHere"].some((n) => this.scriptFunction(n) === state);
  }

  /** Co-op emergency teleport: every player well behind the one furthest ahead is moved to them (see GameSim). */
  emergencyTeleport(): TeleportResult {
    const E = this.E;
    if (E.playerSlots < 2) return { reason: "Regroup needs two or more players" };
    if (E.stageMode !== C.STAGEMODE_NORMAL) return { reason: "Can't regroup right now" };
    if (E.teleportCooldown > 0) return { reason: `Regroup ready in ${Math.ceil(E.teleportCooldown / 60)}s` };
    let lead = -1;
    for (let p = 0; p < E.playerSlots; p++) {
      if (this.inPlay(p) && (lead < 0 || E.playerList[p].xpos > E.playerList[lead].xpos)) lead = p;
    }
    if (lead < 0) return { reason: "Can't regroup while nobody is on their feet" };
    const L = E.playerList[lead];
    const from: number[] = [];
    for (let p = 0; p < E.playerSlots; p++) {
      if (p === lead || !this.inPlay(p)) continue;
      const T = E.playerList[p];
      if (Math.abs((L.xpos - T.xpos) >> 16) < 96 && Math.abs((L.ypos - T.ypos) >> 16) < 96) continue;
      this.moveToPartner(p, lead);
      from.push(p);
    }
    if (!from.length) {
      let inPlay = 0;
      for (let p = 0; p < E.playerSlots; p++) inPlay += +this.inPlay(p);
      return { reason: inPlay < 2 ? "Can't regroup while a player is respawning" : "Everyone is already together" };
    }
    E.teleportCooldown = TELEPORT_COOLDOWN;
    return { from, to: lead };
  }

  /** Put player `p` just above player `to`, airborne and briefly invulnerable, with their camera on them. */
  private moveToPartner(p: number, to: number): void {
    const E = this.E;
    const T = E.playerList[p], L = E.playerList[to];
    const air = this.scriptFunction("Player_State_Air");
    T.xpos = L.xpos;
    T.ypos = L.ypos - 0x100000;
    T.xvel = 0;
    T.yvel = 0;
    T.speed = 0;
    T.gravity = 1;
    T.collisionMode = 0;
    T.angle = 0;
    T.collisionPlane = L.collisionPlane;
    const body = E.objectEntityList[T.boundEntity];
    if (body) {
      body.xpos = T.xpos;
      body.ypos = T.ypos;
      body.rotation = 0;
      if (air >= 0) body.state = air;
    }
    T.values[5] = Math.max(T.values[5], 60); // Player.BlinkTimer (brief invulnerability)
    const prev = E.curCam;
    E.setCamera(p);
    // re-centre the scroll window on the player (SetPlayerScreenPosition only drifts it 16px per frame)
    E.xScrollA = (T.xpos >> 16) - E.SCREEN_CENTERX;
    E.xScrollB = E.xScrollA + E.SCREEN_XSIZE;
    E.yScrollA = (T.ypos >> 16) - (C.SCREEN_YSIZE >> 1);
    E.yScrollB = E.yScrollA + C.SCREEN_YSIZE;
    E.xScrollOffset = E.xScrollA;
    E.yScrollOffset = E.yScrollA;
    E.cameraEnabled = 1;
    E.setCamera(prev);
  }

  /**
   * Co-op boss arenas (see arena.ts): while a boss that locked the screen is alive, a player outside its arena is
   * brought to a partner inside it, and their screen is locked to the arena too.
   */
  private captureArena(): { from: number[]; to: number } | null {
    const E = this.E;
    if (!E.arenaLock || E.playerSlots < 2 || E.stageMode !== C.STAGEMODE_NORMAL) return null;
    const { arenaX1: x1, arenaX2: x2, arenaY1: y1, arenaY2: y2 } = E;
    if (x2 - x1 > ARENA_MAX_WIDTH) return null;
    let boss = false;
    for (let i = 0; i < E.objectEntityList.length && !boss; i++) boss = E.bossType[E.objectEntityList[i].type] === 1;
    if (!boss) {
      E.arenaLock = 0;
      return null;
    }
    const inside = (p: number) => {
      const x = E.playerList[p].xpos >> 16, y = E.playerList[p].ypos >> 16;
      return x >= x1 - ARENA_MARGIN_X && x <= x2 + ARENA_MARGIN_X && y >= y1 - ARENA_MARGIN_Y && y <= y2 + ARENA_MARGIN_Y;
    };
    let anchor = -1;
    const mid = (x1 + x2) >> 1;
    for (let p = 0; p < E.playerSlots; p++) {
      if (!this.inPlay(p) || !inside(p)) continue;
      if (anchor < 0 || Math.abs((E.playerList[p].xpos >> 16) - mid) < Math.abs((E.playerList[anchor].xpos >> 16) - mid)) anchor = p;
    }
    if (anchor < 0) return null;
    const from: number[] = [];
    for (let p = 0; p < E.playerSlots; p++) {
      if (p === anchor || !this.inPlay(p) || inside(p)) continue;
      this.moveToPartner(p, anchor);
      const prev = E.curCam;
      E.setCamera(p);
      E.xBoundary1 = E.newXBoundary1 = x1;
      E.xBoundary2 = E.newXBoundary2 = x2;
      E.yBoundary1 = E.newYBoundary1 = y1;
      E.yBoundary2 = E.newYBoundary2 = y2;
      E.setCamera(prev);
      from.push(p);
    }
    return from.length ? { from, to: anchor } : null;
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
        // with infinite lives the counter is kept topped up, so no death ends the game (the HUD shows ∞)
        if (this.global("Coop.InfiniteLives")) this.setGlobal("Player.Lives", INFINITE_LIVES);
        ProcessStage(E, this.viewCamera);
        {
          const captured = this.captureArena();
          if (captured) events.push({ type: "arena", ...captured });
        }
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
