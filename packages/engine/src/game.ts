// A game instance: the engine plus the per-frame loop of the original (RetroGameLoop / ProcessStage),
// driven by one pad per player. Used identically by the server (authoritative, headless) and the browser.

import { Engine, MAX_PLAYERS } from "./engine.js";
import type { ScriptHost } from "./host.js";
import type { Vfs } from "./core/pak.js";
import { LoadGameConfig, setGlobalVariableByName, getGlobalVariableByName } from "./config.js";
import { InitStartingStage, ProcessStage, LoadStageFiles } from "./scene.js";
import { restoreStateWithStage, captureState } from "./state.js";
import { DEFAULT_SETTINGS, type GameSettings } from "./settings.js";
import { ARENA_MARGIN_X, ARENA_MARGIN_Y, ARENA_MAX_WIDTH } from "./arena.js";
import { ENGINE_MAINGAME, ENGINE_INITPAUSE, ENGINE_EXITPAUSE, ENGINE_ENDGAME, ENGINE_RESETGAME, ENGINE_SCRIPTERROR, ENGINE_WAIT, ENGINE_DEVMENU, STAGELIST_REGULAR, STAGEMODE_NORMAL, STAGEMODE_2P } from "./c.js";

export type GameEvent =
  | { type: "stageLoaded"; list: number; stage: number; folder: string; name: string }
  | { type: "gameOver" }
  | { type: "endGame" }
  | { type: "scriptError"; message: string }
  | { type: "pause" }
  | { type: "teleport"; from: number[]; to: number }
  | { type: "arena"; from: number[]; to: number }
  | { type: "notice"; message: string };

/** Result of a regroup request: who was moved to whom, or why nobody was. */
export type TeleportResult = { from: number[]; to: number } | { reason: string };

/** What the lives counters are held at with infinite lives (the HUD draws ∞ instead). */
export const INFINITE_LIVES = 9;

/** Frames between regroups. */
export const TELEPORT_COOLDOWN = 180;

export interface GameOptions {
  headless: boolean;
  players: number;
}

export class GameSim {
  readonly E: Engine;
  /** Which camera this instance renders (its local player). */
  viewCamera = 0;
  private lastLoadCount = 0;

  constructor(vfs: Vfs, host: ScriptHost, readonly opts: GameOptions) {
    this.E = new Engine(vfs, host, { headless: opts.headless });
    LoadGameConfig(this.E);
    this.setPlayers(opts.players);
  }

  setPlayers(n: number): void {
    const E = this.E;
    E.playerSlots = Math.max(1, Math.min(MAX_PLAYERS, n));
    E.camCount = E.playerSlots;
    setGlobalVariableByName(E, "coop.playerCount", E.playerSlots);
    setGlobalVariableByName(E, "coop.enabled", E.playerSlots > 1 ? 1 : 0);
  }

  global(name: string): number {
    return getGlobalVariableByName(this.E, name);
  }

  setGlobal(name: string, value: number): void {
    setGlobalVariableByName(this.E, name, value);
  }

  /**
   * Set up a co-op game: characters[i] is player i's character (0 Sonic, 1 Tails, 2 Knuckles). Call before
   * startStage. Lives and scores start fresh for every player.
   */
  configurePlayers(characters: number[], settings: GameSettings = DEFAULT_SETTINGS, lives = 3): void {
    const E = this.E;
    this.setPlayers(characters.length);
    const coop = characters.length > 1;
    this.setGlobal("coop.enabled", coop ? 1 : 0);
    this.setGlobal("stage.player2Enabled", coop ? 1 : 0);
    this.setGlobal("coop.p2Character", characters[1] ?? 0);
    const livesID = E.globalVariableNames.indexOf("player.lives");
    const scoreID = E.globalVariableNames.indexOf("player.score");
    const twoSlots = E.globalVariableNames[livesID + 1] === "player.lives2";
    for (let p = 0; p < characters.length; p++) {
      if (p === 0 || twoSlots) {
        E.globalVariables[livesID + p] = lives;
        E.globalVariables[scoreID + p] = 0;
      }
      if (p === 1) this.setGlobal("coop.p2Lives", lives);
    }
    this.playerListPos = characters[0] ?? 0;
    this.setGlobal("coop.infiniteLives", +settings.infiniteLives);
    this.setGlobal("coop.respawnRule", settings.respawn === "partner" ? 0 : 1);
    this.setGlobal("coop.tailsFlight", +settings.tailsFlight);
    this.setGlobal("coop.knuxClimb", +settings.knucklesClimb);
    this.setGlobal("options.spindash", +settings.spindash);
    this.setGlobal("options.tailsFlight", +settings.tailsFlight);
  }

  /** With infinite lives the counters are kept topped up, so no death ever ends the game. */
  private topUpLives(): void {
    const E = this.E;
    if (!this.global("coop.infiniteLives")) return;
    const livesID = E.globalVariableNames.indexOf("player.lives");
    if (livesID >= 0) E.globalVariables[livesID] = INFINITE_LIVES;
    if (E.globalVariableNames[livesID + 1] === "player.lives2") E.globalVariables[livesID + 1] = INFINITE_LIVES;
    this.setGlobal("coop.p2Lives", INFINITE_LIVES);
  }

  /** GameConfig player list entry for player 1 (0 Sonic, 1 Tails, 2 Knuckles, 3 Sonic & Tails). */
  playerListPos = 0;

  /** Start a stage from a list (0 presentation, 1 regular, 2 bonus, 3 special) with the given GameConfig player entry. */
  startStage(list: number, stage: number, playerListPos = this.playerListPos): void {
    InitStartingStage(this.E, list, stage, playerListPos);
  }

  findStage(name: string, list = STAGELIST_REGULAR): number {
    const n = name.replace(/ /g, "").toUpperCase();
    return this.E.stageList[list].findIndex((s) => s.name.replace(/ /g, "").toUpperCase() === n);
  }

  private scriptFunction(name: string): number {
    return this.E.scriptFunctionList.findIndex((f) => f.name === name);
  }

  /** A player is "in play" when it is a live player object (not dying, not in a cutscene with collisions off). */
  private inPlay(slot: number): boolean {
    const e = this.E.objectEntityList[slot];
    if (e.groupID !== 0x100 || !e.objectInteractions || !e.tileCollisions) return false;
    const dead = [this.scriptFunction("Player_State_Death"), this.scriptFunction("Player_State_Drown")];
    return !dead.includes(e.state);
  }

  /**
   * Emergency teleport (co-op): every player that is well behind (or stuck far away from) the player furthest ahead
   * is moved to them. Players in a stage-controlled state (dying, results, cutscenes) are left alone. A cooldown
   * stops it being spammed.
   */
  emergencyTeleport(): TeleportResult {
    const E = this.E;
    if (E.playerSlots < 2) return { reason: "Regroup needs two or more players" };
    if (E.stageMode !== STAGEMODE_NORMAL && E.stageMode !== STAGEMODE_2P) return { reason: "Can't regroup right now" };
    if (E.teleportCooldown > 0) return { reason: `Regroup ready in ${Math.ceil(E.teleportCooldown / 60)}s` };
    let lead = -1;
    for (let p = 0; p < E.playerSlots; p++) {
      if (this.inPlay(p) && (lead < 0 || E.objectEntityList[p].xpos > E.objectEntityList[lead].xpos)) lead = p;
    }
    if (lead < 0) return { reason: "Can't regroup while nobody is on their feet" };
    const L = E.objectEntityList[lead];
    const from: number[] = [];
    for (let p = 0; p < E.playerSlots; p++) {
      if (p === lead || !this.inPlay(p)) continue;
      const T = E.objectEntityList[p];
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
    const T = E.objectEntityList[p], L = E.objectEntityList[to];
    const air = this.scriptFunction("Player_State_Air");
    T.xpos = L.xpos;
    T.ypos = L.ypos - 0x100000;
    T.xvel = 0;
    T.yvel = 0;
    T.speed = 0;
    T.gravity = 1;
    T.collisionMode = 0;
    T.angle = 0;
    T.rotation = 0;
    T.collisionPlane = L.collisionPlane;
    if (air >= 0) T.state = air;
    T.values[8] = Math.max(T.values[8], 60); // blink (brief invulnerability)
    const prev = E.curCam;
    E.setCamera(p);
    E.cameraXPos = T.xpos >> 16;
    E.cameraYPos = T.ypos >> 16;
    E.cameraEnabled = 1;
    E.setCamera(prev);
  }

  /**
   * Co-op boss arenas (see arena.ts): while a boss that locked the screen is alive, a player outside its arena is
   * brought to a partner inside it, and their screen is locked to the arena too.
   */
  private captureArena(): { from: number[]; to: number } | null {
    const E = this.E;
    if (!E.arenaLock || E.playerSlots < 2 || (E.stageMode !== STAGEMODE_NORMAL && E.stageMode !== STAGEMODE_2P)) return null;
    const x1 = E.newXBoundary1, x2 = E.newXBoundary2, y1 = E.newYBoundary1, y2 = E.newYBoundary2;
    if (x2 - x1 > ARENA_MAX_WIDTH) return null;
    let boss = false;
    for (let i = E.playerSlots; i < E.objectEntityList.length && !boss; i++) boss = E.bossType[E.objectEntityList[i].type] === 1;
    if (!boss) {
      E.arenaLock = 0;
      return null;
    }
    const inside = (p: number) => {
      const e = E.objectEntityList[p];
      const x = e.xpos >> 16, y = e.ypos >> 16;
      return x >= x1 - ARENA_MARGIN_X && x <= x2 + ARENA_MARGIN_X && y >= y1 - ARENA_MARGIN_Y && y <= y2 + ARENA_MARGIN_Y;
    };
    let anchor = -1;
    const mid = (x1 + x2) >> 1;
    for (let p = 0; p < E.playerSlots; p++) {
      if (!this.inPlay(p) || !inside(p)) continue;
      if (anchor < 0 || Math.abs((E.objectEntityList[p].xpos >> 16) - mid) < Math.abs((E.objectEntityList[anchor].xpos >> 16) - mid)) anchor = p;
    }
    if (anchor < 0) return null;
    const from: number[] = [];
    for (let p = 0; p < E.playerSlots; p++) {
      if (p === anchor || !this.inPlay(p) || inside(p)) continue;
      this.moveToPartner(p, anchor);
      const prev = E.curCam;
      E.setCamera(p);
      E.curXBoundary1 = x1;
      E.curXBoundary2 = x2;
      E.curYBoundary1 = y1;
      E.curYBoundary2 = y2;
      E.setCamera(prev);
      from.push(p);
    }
    return from.length ? { from, to: anchor } : null;
  }

  /** Restore a full state (from a snapshot), loading the stage it belongs to if necessary. */
  applyState(buf: Uint8Array): boolean {
    return restoreStateWithStage(this.E, buf, LoadStageFiles);
  }

  captureState(out?: Uint8Array): Uint8Array {
    return captureState(this.E, out);
  }

  /** Advance one 60 Hz frame. `pads[p]` is player p's button mask (see BTN). */
  tick(pads: ArrayLike<number>): GameEvent[] {
    const E = this.E;
    const events: GameEvent[] = [];
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const down = p < E.playerSlots ? pads[p] | 0 : 0;
      E.inputPress[p] = down & ~E.inputPrev[p];
      E.inputDown[p] = down;
      E.inputPrev[p] = down;
    }
    switch (E.gameMode) {
      case ENGINE_MAINGAME:
        if (E.teleportCooldown > 0) E.teleportCooldown--;
        this.topUpLives();
        // Sky Chase, Wing Fortress and Death Egg have no second player body; spectate player 1 there.
        const body = E.objectEntityList[this.viewCamera];
        ProcessStage(E, body && E.typeNames[body.type] === "BlankObject" ? 0 : this.viewCamera);
        const captured = this.captureArena();
        if (captured) events.push({ type: "arena", ...captured });
        break;
      case ENGINE_INITPAUSE:
        // The single-player pause menu is a native object in the original; in online co-op the world keeps running.
        events.push({ type: "pause" });
        E.gameMode = ENGINE_MAINGAME;
        break;
      case ENGINE_EXITPAUSE:
        E.gameMode = ENGINE_MAINGAME;
        break;
      case ENGINE_ENDGAME:
        events.push({ type: "endGame" });
        E.gameMode = ENGINE_WAIT;
        break;
      case ENGINE_RESETGAME:
        events.push({ type: "gameOver" });
        E.gameMode = ENGINE_WAIT;
        break;
      case ENGINE_SCRIPTERROR:
        events.push({ type: "scriptError", message: E.compiler.errors.map((e) => `${e.script}:${e.line}: ${e.message}`).join("; ") });
        E.gameMode = ENGINE_WAIT;
        break;
      case ENGINE_WAIT:
      case ENGINE_DEVMENU:
        break;
      default:
        E.gameMode = ENGINE_MAINGAME;
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
