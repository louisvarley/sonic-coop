// Wire protocol shared by server and client.
//
// Lobby traffic is JSON (Colyseus messages). Gameplay is binary:
//   client -> server  "in"   inputs: u32 seq, u16 pad (one per client frame)
//   client -> server  "ack"  u32 snapshotId (the newest snapshot the client has applied)
//   server -> client  "snap" a state snapshot: a delta against a snapshot the client acknowledged, or a keyframe
import { deflateSync, inflateSync } from "fflate";

export const PROTOCOL_VERSION = 1;
export const TICK_RATE = 60;
export const KEYFRAME = 0xffffffff;

export type GameId = "sonic1" | "sonic2";

export const CHARACTERS = [
  { id: 0, name: "Sonic" },
  { id: 1, name: "Tails" },
  { id: 2, name: "Knuckles" },
] as const;

export function isCharacterAvailable(game: GameId, id: number): boolean {
  return CHARACTERS.some((character) => character.id === id && (game === "sonic2" || id < 2));
}

export interface LobbyPlayer {
  id: string;
  name: string;
  slot: number;
  character: number;
  ready: boolean;
  connected: boolean;
  loaded: boolean;
}

export interface LobbyState {
  code: string;
  game: GameId;
  phase: "lobby" | "loading" | "playing";
  hostId: string;
  players: LobbyPlayer[];
  maxPlayers: number;
  /** Stage list position to start from (regular list); the first zone by default. */
  startStage: number;
  devTools: boolean;
  message?: string;
}

/** Sent when a game starts (or to a client that reconnects into a running game). */
export interface StartInfo {
  game: GameId;
  slot: number;
  characters: number[];
  startStage: number;
  snapshotRate: number;
}

export type ClientLobbyMessage =
  | { setGame: GameId }
  | { setCharacter: number }
  | { setName: string }
  | { ready: boolean }
  | { setStartStage: number }
  | { start: true }
  | { endGame: true };

export interface SnapshotHeader {
  snapId: number;
  baseId: number;
  tick: number;
  /** Per player: seq of the last input the server applied, and the pad it used this tick. */
  acks: number[];
  pads: number[];
}

export function encodeSnapshot(h: SnapshotHeader, payload: Uint8Array): Uint8Array {
  const n = h.acks.length;
  const z = deflateSync(payload, { level: 1 });
  const out = new Uint8Array(13 + n * 6 + 4 + z.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, h.snapId, true);
  dv.setUint32(4, h.baseId, true);
  dv.setUint32(8, h.tick, true);
  dv.setUint8(12, n);
  let o = 13;
  for (let i = 0; i < n; i++) {
    dv.setUint32(o, h.acks[i] >>> 0, true);
    dv.setUint16(o + 4, h.pads[i] & 0xffff, true);
    o += 6;
  }
  dv.setUint32(o, payload.length, true);
  out.set(z, o + 4);
  return out;
}

export function decodeSnapshot(buf: Uint8Array): { header: SnapshotHeader; payload: Uint8Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint8(12);
  const acks: number[] = [], pads: number[] = [];
  let o = 13;
  for (let i = 0; i < n; i++) {
    acks.push(dv.getUint32(o, true));
    pads.push(dv.getUint16(o + 4, true));
    o += 6;
  }
  const rawLen = dv.getUint32(o, true);
  const payload = inflateSync(buf.subarray(o + 4), { out: new Uint8Array(rawLen) });
  return { header: { snapId: dv.getUint32(0, true), baseId: dv.getUint32(4, true), tick: dv.getUint32(8, true), acks, pads }, payload };
}

export function encodeInput(seq: number, pad: number): Uint8Array {
  const out = new Uint8Array(6);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, seq >>> 0, true);
  dv.setUint16(4, pad & 0xffff, true);
  return out;
}

export function decodeInput(buf: Uint8Array): { seq: number; pad: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { seq: dv.getUint32(0, true), pad: dv.getUint16(4, true) };
}

export function encodeU32(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v >>> 0, true);
  return out;
}

export function decodeU32(buf: Uint8Array): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true);
}

/** Short room codes without easily confused letters. */
export function makeRoomCode(rand: () => number = Math.random): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[Math.floor(rand() * letters.length)];
  return s;
}
