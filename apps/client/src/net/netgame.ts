// Client side of the netcode: local prediction with server reconciliation.
//
// Every frame the client sends its pad (with a sequence number) and simulates one tick immediately. When a
// snapshot arrives it restores the server's state and re-simulates the inputs the server has not applied yet.
// Other players are predicted by repeating the pad the server last saw them use. No DOM: also used by tests.

import {
  createGameSim, applyDelta, normalizeSettings, decodeSnapshot, encodeInput, encodeU32, KEYFRAME, type AnyGameSim, type GameEvent, type ScriptHost, type StartInfo, type Vfs,
} from "@ringlink/engine";

export interface RoomLike {
  send(type: string, message?: unknown): void;
  sendBytes(type: string, bytes: Uint8Array): void;
}

/** A host wrapper that can be muted while re-simulating, so corrected frames don't replay sounds. */
export class GatedHost implements ScriptHost {
  muted = false;
  constructor(private inner: ScriptHost) {}
  log(m: string) { this.inner.log(m); }
  playSfx(s: number, l: number) { if (!this.muted) this.inner.playSfx(s, l); }
  stopSfx(s: number) { if (!this.muted) this.inner.stopSfx(s); }
  setSfxAttributes(s: number, l: number, p: number) { if (!this.muted) this.inner.setSfxAttributes(s, l, p); }
  setMusicTrack(p: string, t: number, l: boolean, lp: number) { this.inner.setMusicTrack(p, t, l, lp); }
  playMusic(t: number, s: number) { if (!this.muted) this.inner.playMusic(t, s); }
  stopMusic() { if (!this.muted) this.inner.stopMusic(); }
  pauseMusic() { if (!this.muted) this.inner.pauseMusic(); }
  resumeMusic() { if (!this.muted) this.inner.resumeMusic(); }
  swapMusicTrack(p: string, t: number, lp: number, r: number) { if (!this.muted) this.inner.swapMusicTrack(p, t, lp, r); }
  setMusicVolume(v: number) { if (!this.muted) this.inner.setMusicVolume(v); }
  syncMusic(track: number, playing: boolean) { this.inner.syncMusic?.(track, playing); }
  loadSfx(id: number, path: string) { this.inner.loadSfx?.(id, path); }
  stopAllSfx() { if (!this.muted) this.inner.stopAllSfx?.(); }
  releaseStageSfx() { this.inner.releaseStageSfx?.(); }
}

export interface NetStats {
  snapshots: number;
  lastSnapshotBytes: number;
  resimTicks: number;
  pending: number;
  serverTick: number;
  stageLoads: number;
}

const MAX_PREDICTION = 45;

export class NetGame {
  readonly sim: AnyGameSim;
  readonly host: GatedHost;
  readonly slot: number;
  private seq = 0;
  private pending: { seq: number; pad: number }[] = [];
  private baselines = new Map<number, Uint8Array>();
  private remotePads: number[];
  private latest = 0;
  started = false;
  readonly stats: NetStats = { snapshots: 0, lastSnapshotBytes: 0, resimTicks: 0, pending: 0, serverTick: 0, stageLoads: 0 };
  onEvent: ((e: GameEvent) => void) | null = null;

  constructor(private room: RoomLike, vfs: Vfs, host: ScriptHost, readonly info: StartInfo, opts: { headless: boolean }) {
    this.host = new GatedHost(host);
    this.slot = info.slot;
    this.sim = createGameSim(info.game, vfs, this.host, { headless: opts.headless, players: info.characters.length });
    this.sim.configurePlayers(info.characters, normalizeSettings(info.settings));
    // a spectator beyond the players the game drives watches player 1
    this.sim.viewCamera = info.slot < this.sim.E.playerSlots ? info.slot : 0;
    this.remotePads = new Array(info.characters.length).fill(0);
  }

  /** Feed a "snap" message from the server. */
  onSnapshot(bytes: Uint8Array): void {
    const { header, payload } = decodeSnapshot(bytes);
    let state: Uint8Array;
    if (header.baseId === KEYFRAME) state = payload;
    else {
      const base = this.baselines.get(header.baseId);
      if (!base) return; // baseline already dropped: the server will send a keyframe once it sees our ack
      state = base.slice();
      applyDelta(state, payload);
    }
    if (header.snapId <= this.latest) return;
    this.latest = header.snapId;
    this.baselines.set(header.snapId, state);
    for (const k of this.baselines.keys()) if (k < header.snapId - 8) this.baselines.delete(k);
    this.room.sendBytes("ack", encodeU32(header.snapId));
    this.stats.snapshots++;
    this.stats.lastSnapshotBytes = bytes.length;
    this.stats.serverTick = header.tick;
    for (let i = 0; i < this.remotePads.length; i++) if (i !== this.slot) this.remotePads[i] = header.pads[i] ?? 0;
    this.reconcile(state, header.acks[this.slot] ?? 0);
  }

  private reconcile(state: Uint8Array, ackSeq: number): void {
    const drawable = this.sim.E as { draw: unknown };
    const draw = drawable.draw;
    drawable.draw = null;
    this.host.muted = true;
    try {
      if (this.sim.applyState(state)) this.stats.stageLoads++;
      this.pending = this.pending.filter((p) => p.seq > ackSeq);
      for (const p of this.pending) this.sim.tick(this.padsWith(p.pad));
      this.stats.resimTicks += this.pending.length;
    } finally {
      this.host.muted = false;
      drawable.draw = draw;
    }
    this.host.syncMusic(this.sim.E.trackID, this.sim.E.musicStatus !== 0);
    const E = this.sim.E;
    this.host.setMusicVolume("musicVolume" in E ? E.musicVolume : E.masterVolume);
    this.started = true;
    this.stats.pending = this.pending.length;
  }

  private padsWith(myPad: number): number[] {
    const pads = this.remotePads.slice();
    pads[this.slot] = myPad;
    return pads;
  }

  /** One local frame: send the pad and predict a tick. Returns the game events of that tick. */
  step(pad: number): GameEvent[] {
    if (!this.started) return [];
    const seq = ++this.seq;
    this.room.sendBytes("in", encodeInput(seq, pad));
    if (this.pending.length >= MAX_PREDICTION) this.pending.shift();
    this.pending.push({ seq, pad });
    const events = this.sim.tick(this.padsWith(pad));
    if (this.onEvent) for (const e of events) this.onEvent(e);
    this.stats.pending = this.pending.length;
    return events;
  }
}
