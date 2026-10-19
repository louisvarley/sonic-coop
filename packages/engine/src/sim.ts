// One entry point for the script-engine games: Sonic 1 and 2 (RSDKv4) and Sonic CD (RSDKv3) share the GameSim shape
// (tick, applyState, configurePlayers, startStage), so the server room and the netcode drive either.

import { GameSim, type GameOptions } from "./game.js";
import { GameSim3 } from "./v3/game.js";
import type { ScriptHost } from "./host.js";
import type { Vfs } from "./core/pak.js";
import type { GameId } from "./net/protocol.js";

export type AnyGameSim = GameSim | GameSim3;

export function createGameSim(game: GameId, vfs: Vfs, host: ScriptHost, opts: GameOptions): AnyGameSim {
  return game === "soniccd" ? new GameSim3(vfs, host, opts) : new GameSim(vfs, host, opts);
}
