// A game instance: the engine plus the per-frame loop of the original (RetroGameLoop / ProcessStage),
// driven by one pad per player. Used identically by the server (authoritative, headless) and the browser.

import { Engine, MAX_PLAYERS } from "./engine.js";
import type { ScriptHost } from "./host.js";
import type { Vfs } from "./core/pak.js";
import { BTN } from "./input.js";
import { LoadGameConfig, setGlobalVariableByName, getGlobalVariableByName } from "./config.js";
import { InitStartingStage, ProcessStage, LoadStageFiles } from "./scene.js";
import { restoreStateWithStage, captureState } from "./state.js";
import { ENGINE_MAINGAME, ENGINE_INITPAUSE, ENGINE_EXITPAUSE, ENGINE_ENDGAME, ENGINE_RESETGAME, ENGINE_SCRIPTERROR, ENGINE_WAIT, ENGINE_DEVMENU, STAGELIST_REGULAR } from "./c.js";

export type GameEvent =
  | { type: "stageLoaded"; list: number; stage: number; folder: string; name: string }
  | { type: "gameOver" }
  | { type: "endGame" }
  | { type: "scriptError"; message: string }
  | { type: "pause" }
  | { type: "teleport"; from: number; to: number };

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
   * Set up a co-op game: characters[i] is player i's character (0 Sonic, 1 Tails). Call before startStage.
   * Lives and scores start fresh for every player.
   */
  configurePlayers(characters: number[], lives = 3): void {
    const E = this.E;
    this.setPlayers(characters.length);
    const coop = characters.length > 1;
    this.setGlobal("coop.enabled", coop ? 1 : 0);
    this.setGlobal("stage.player2Enabled", coop ? 1 : 0);
    this.setGlobal("coop.p1Character", characters[0] ?? 0);
    this.setGlobal("coop.p2Character", characters[1] ?? 0);
    const livesID = E.globalVariableNames.indexOf("player.lives");
    const scoreID = E.globalVariableNames.indexOf("player.score");
    const twoSlots = E.globalVariableNames[livesID + 1] === "player.lives2";
    for (let p = 0; p < characters.length; p++) {
      if (p === 0 || twoSlots) {
        E.globalVariables[livesID + p] = lives;
        E.globalVariables[scoreID + p] = 0;
      }
      this.setGlobal(`coop.p${p + 1}Lives`, lives);
      this.setGlobal(`coop.p${p + 1}Score`, 0);
    }
    this.playerListPos = characters[0] ?? 0;
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
   * Emergency teleport (co-op): the player furthest behind is moved to the player furthest ahead. Players in a
   * stage-controlled state (dying, results, cutscenes) are left alone. A cooldown stops it being spammed.
   */
  emergencyTeleport(): { from: number; to: number } | null {
    const E = this.E;
    if (E.playerSlots < 2 || E.teleportCooldown > 0 || E.stageMode !== 1) return null;
    let lead = -1, trail = -1;
    for (let p = 0; p < E.playerSlots; p++) {
      if (!this.inPlay(p)) continue;
      const x = E.objectEntityList[p].xpos;
      if (lead < 0 || x > E.objectEntityList[lead].xpos) lead = p;
      if (trail < 0 || x < E.objectEntityList[trail].xpos) trail = p;
    }
    if (lead < 0 || trail < 0 || lead === trail) return null;
    const L = E.objectEntityList[lead], T = E.objectEntityList[trail];
    const dx = Math.abs((L.xpos - T.xpos) >> 16), dy = Math.abs((L.ypos - T.ypos) >> 16);
    if (dx < 96 && dy < 96) return null;
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
    E.setCamera(trail);
    E.cameraXPos = T.xpos >> 16;
    E.cameraYPos = T.ypos >> 16;
    E.cameraEnabled = 1;
    E.setCamera(prev);
    E.teleportCooldown = 300;
    return { from: trail, to: lead };
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
        for (let p = 0; p < E.playerSlots; p++) {
          if (E.inputPress[p] & BTN.TELEPORT) {
            const t = this.emergencyTeleport();
            if (t) events.push({ type: "teleport", ...t });
            break;
          }
        }
        // Sky Chase, Wing Fortress and Death Egg have no second player body; spectate player 1 there.
        const body = E.objectEntityList[this.viewCamera];
        ProcessStage(E, body && E.typeNames[body.type] === "BlankObject" ? 0 : this.viewCamera);
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
