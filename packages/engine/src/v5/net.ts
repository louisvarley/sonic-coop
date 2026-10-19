import type { V5GameplayState } from "./gameplay.js";

export interface V5OnlineSnapshot {
  state: V5GameplayState;
  playing: boolean;
  owner: string;
  players: { id: string; slot: number }[];
  acknowledged: number[];
}
