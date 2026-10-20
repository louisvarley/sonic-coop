// Options the host picks in the lobby. They reach the scripts as globals (coop.* for Sonic 1 and 2, Coop.* for
// Sonic CD) that the co-op patches read; see games/<game>/patches.ts.

import type { GameId } from "./net/protocol.js";

export interface GameSettings {
  /** Lives never run out; the HUD shows ∞. */
  infiniteLives: boolean;
  /** Where a player who dies comes back (Sonic 1 and 2; Sonic CD always uses the checkpoint). */
  respawn: "checkpoint" | "partner";
  /** Sonic 1: the spin dash. */
  spindash: boolean;
  /** Tails can fly. */
  tailsFlight: boolean;
  /** Knuckles can climb walls. */
  knucklesClimb: boolean;
  /** Sonic CD: Sonic's super peel out (hold up and press jump). */
  peelOut: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  infiniteLives: true,
  respawn: "checkpoint",
  spindash: true,
  tailsFlight: true,
  knucklesClimb: true,
  peelOut: true,
};

/** The settings each game offers (the others have no effect there). */
export const GAME_SETTINGS: Record<GameId, (keyof GameSettings)[]> = {
  sonic1: ["infiniteLives", "respawn", "spindash", "tailsFlight", "knucklesClimb"],
  sonic2: ["infiniteLives", "respawn", "tailsFlight", "knucklesClimb"],
  soniccd: ["infiniteLives", "tailsFlight", "peelOut"],
  sonic3: [],
};

/** A complete, valid settings object from untrusted input (missing or bad fields take the default). */
export function normalizeSettings(input: unknown): GameSettings {
  const s = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof GameSettings, unknown>>;
  const bool = (k: Exclude<keyof GameSettings, "respawn">) => (typeof s[k] === "boolean" ? (s[k] as boolean) : DEFAULT_SETTINGS[k]);
  return {
    infiniteLives: bool("infiniteLives"),
    respawn: s.respawn === "partner" || s.respawn === "checkpoint" ? s.respawn : DEFAULT_SETTINGS.respawn,
    spindash: bool("spindash"),
    tailsFlight: bool("tailsFlight"),
    knucklesClimb: bool("knucklesClimb"),
    peelOut: bool("peelOut"),
  };
}
