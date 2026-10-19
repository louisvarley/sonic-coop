// The co-op room: lobby (game, characters, ready-up) and the authoritative 60 Hz simulation.
//
// Clients send pad inputs tagged with sequence numbers; the server applies one input per player per tick and
// broadcasts state snapshots (deltas against the last snapshot each client acknowledged). Clients predict
// locally and re-simulate from each snapshot, so the server never trusts client positions.

import { Room, type Client } from "@colyseus/core";
import {
  createGameSim, captureState, encodeDelta, encodeSnapshot, decodeInput, decodeU32, isCharacterAvailable, makeRoomCode, KEYFRAME,
  type AnyGameSim, type GameEvent, type GameId, type LobbyState, type LobbyPlayer, type ClientLobbyMessage, type StartInfo, type ScriptHost,
} from "@ringlink/engine";
import { availableGames, createSonic3Game, loadSonic3Pack, loadVfs, stageList } from "./gamedata.js";
import type { V5Gameplay } from "../../../packages/engine/src/v5/gameplay.js";
import type { V5OnlineSnapshot } from "../../../packages/engine/src/v5/net.js";
import { log } from "./log.js";
import { stats } from "./stats.js";

const MAX_PLAYERS = Math.max(1, Math.min(2, Number(process.env.MAX_PLAYERS ?? 2)));
const SNAPSHOT_RATE = Math.max(5, Math.min(60, Number(process.env.SNAPSHOT_RATE ?? 20)));
const RECONNECT_SECONDS = Number(process.env.RECONNECT_SECONDS ?? 60);
const DEV_TOOLS = process.env.ENABLE_DEV_TOOLS === "1";
const MAX_INPUT_BUFFER = 8;
const SNAPSHOT_HISTORY = 24;

const activeCodes = new Set<string>();

interface Seat {
  sessionId: string;
  queue: { seq: number; pad: number }[];
  lastQueuedSeq: number;
  lastPad: number;
  ackSeq: number;
  ackSnap: number;
}

export class CoopRoom extends Room {
  override maxClients = MAX_PLAYERS;
  private lobby!: LobbyState;
  private sim: AnyGameSim | null = null;
  /** The Sonic 3 (RSDKv5) world, when that game is running instead of the script-engine sim. */
  private v5: V5Gameplay | null = null;
  private seats: (Seat | null)[] = [];
  private snapshots = new Map<number, Uint8Array>();
  private snapId = 0;
  private loopTimer: NodeJS.Timeout | null = null;
  private loadTimer: NodeJS.Timeout | null = null;
  private serverTick = 0;

  override onCreate(options: { name?: string; game?: GameId }): void {
    let code = makeRoomCode();
    while (activeCodes.has(code)) code = makeRoomCode();
    activeCodes.add(code);
    this.roomId = code;
    const games = availableGames();
    this.lobby = {
      code,
      game: options.game && games.includes(options.game) ? options.game : (games.includes("sonic1") ? "sonic1" : games[0] ?? "sonic1"),
      phase: "lobby",
      games,
      hostId: "",
      players: [],
      maxPlayers: MAX_PLAYERS,
      startStage: 0,
      devTools: DEV_TOOLS,
    };
    this.setMetadata({ code });
    stats.rooms++;
    log("room", `created ${code}`);

    this.onMessage("lobby", (client, msg: ClientLobbyMessage) => this.onLobbyMessage(client, msg));
    this.onMessage("loaded", (client) => this.onLoaded(client));
    this.onMessage("in", (client, bytes: Uint8Array) => this.onInput(client, bytes));
    this.onMessage("ack", (client, bytes: Uint8Array) => {
      const seat = this.seatOf(client);
      if (seat) seat.ackSnap = decodeU32(bytes);
    });
    this.onMessage("ping", (client, t: number) => client.send("pong", { t, tick: this.serverTick }));
    this.onMessage("dev", (client, msg: { setStage?: number; restart?: boolean; teleport?: boolean }) => this.onDev(client, msg));
  }

  override onJoin(client: Client, options: { name?: string }): void {
    const name = String(options?.name ?? "").trim().slice(0, 16) || `Player ${this.lobby.players.length + 1}`;
    let slot = 0;
    while (this.lobby.players.some((p) => p.slot === slot)) slot++;
    if (this.lobby.phase !== "lobby" || slot >= MAX_PLAYERS) throw new Error(this.lobby.phase !== "lobby" ? "A game is already in progress in this room" : "This room is full");
    const player: LobbyPlayer = { id: client.sessionId, name, slot, character: slot === 0 ? 0 : 1, ready: false, connected: true, loaded: false };
    this.lobby.players.push(player);
    this.lobby.players.sort((a, b) => a.slot - b.slot);
    if (!this.lobby.hostId) this.lobby.hostId = client.sessionId;
    log("room", `${this.lobby.code}: ${name} joined as player ${slot + 1}`);
    this.broadcastLobby();
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.playerOf(client);
    if (!player) return;
    if (this.lobby.phase === "lobby" || consented) {
      this.removePlayer(client.sessionId);
      return;
    }
    // In a game: keep the seat for a while so the player can reconnect.
    player.connected = false;
    this.broadcastLobby();
    log("room", `${this.lobby.code}: ${player.name} disconnected, holding their seat for ${RECONNECT_SECONDS}s`);
    try {
      const again = await this.allowReconnection(client, RECONNECT_SECONDS);
      player.connected = true;
      const seat = this.seats[player.slot];
      if (seat) {
        seat.sessionId = again.sessionId;
        seat.queue.length = 0;
        seat.ackSnap = KEYFRAME;
        if (this.v5) {
          // the reconnecting client numbers its inputs from the start again
          seat.lastQueuedSeq = -1;
          seat.ackSeq = -1;
        }
      }
      log("room", `${this.lobby.code}: ${player.name} reconnected`);
      this.broadcastLobby();
      if (this.sim || this.v5) again.send("start", this.startInfo(player));
    } catch {
      log("room", `${this.lobby.code}: ${player.name} did not come back`);
      this.removePlayer(client.sessionId);
    }
  }

  override onDispose(): void {
    this.stopLoop();
    activeCodes.delete(this.lobby.code);
    stats.rooms--;
    log("room", `disposed ${this.lobby.code}`);
  }

  // ---- lobby -----------------------------------------------------------------------------------------------------

  private playerOf(client: Client): LobbyPlayer | undefined {
    return this.lobby.players.find((p) => p.id === client.sessionId);
  }

  private seatOf(client: Client): Seat | null {
    return this.seats.find((s) => s?.sessionId === client.sessionId) ?? null;
  }

  private removePlayer(id: string): void {
    const p = this.lobby.players.find((x) => x.id === id);
    this.lobby.players = this.lobby.players.filter((x) => x.id !== id);
    if (this.lobby.hostId === id) this.lobby.hostId = this.lobby.players[0]?.id ?? "";
    if (p && this.seats[p.slot]) this.seats[p.slot] = null;
    if (this.lobby.phase !== "lobby" && !this.lobby.players.some((x) => x.connected)) this.endGame("Everyone left");
    else if (this.lobby.phase === "loading") this.maybeBeginPlay();
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    if (this.lobby.devTools) {
      try { this.lobby.stages = stageList(this.lobby.game); } catch (e) { log("error", `stage list: ${(e as Error).message}`); }
    }
    this.broadcast("lobby", this.lobby);
  }

  private onLobbyMessage(client: Client, msg: ClientLobbyMessage): void {
    const player = this.playerOf(client);
    if (!player || !msg || typeof msg !== "object") return;
    const isHost = client.sessionId === this.lobby.hostId;
    if ("setName" in msg) player.name = String(msg.setName).trim().slice(0, 16) || player.name;
    if (this.lobby.phase === "lobby") {
      if ("setGame" in msg && isHost && availableGames().includes(msg.setGame)) {
        this.lobby.game = msg.setGame;
        this.lobby.startStage = 0;
        for (const p of this.lobby.players) {
          if (msg.setGame === "sonic3") p.character = Math.min(p.slot, 1);
          else if (!isCharacterAvailable(msg.setGame, p.character)) p.character = 0;
        }
        for (const p of this.lobby.players) p.ready = false;
      }
      if ("setCharacter" in msg && this.lobby.game !== "sonic3" && isCharacterAvailable(this.lobby.game, msg.setCharacter)) player.character = msg.setCharacter;
      if ("ready" in msg) player.ready = !!msg.ready;
      if ("setStartStage" in msg && isHost) {
        const count = stageList(this.lobby.game).length;
        this.lobby.startStage = Math.max(0, Math.min(Math.floor(Number(msg.setStartStage) || 0), count - 1));
      }
      if ("start" in msg && isHost) this.tryStart(client);
    } else if ("endGame" in msg && isHost) {
      this.endGame("The host ended the game");
    }
    this.broadcastLobby();
  }

  private tryStart(client: Client): void {
    const players = this.lobby.players;
    if (!players.length) return;
    if (!players.every((p) => p.ready)) {
      client.send("notice", "Everyone needs to be ready first.");
      return;
    }
    if (!availableGames().includes(this.lobby.game)) {
      client.send("notice", `${this.lobby.game} data is not installed on the server.`);
      return;
    }
    this.lobby.phase = "loading";
    this.lobby.message = undefined;
    for (const p of players) p.loaded = false;
    for (const c of this.clients) {
      const p = this.playerOf(c);
      if (p) c.send("start", this.startInfo(p));
    }
    // a client that cannot load in time is left behind rather than blocking everyone
    this.loadTimer = setTimeout(() => this.maybeBeginPlay(true), 90_000);
    log("room", `${this.lobby.code}: starting ${this.lobby.game} for ${players.length} player(s)`);
  }

  private startInfo(p: LobbyPlayer): StartInfo {
    return {
      game: this.lobby.game,
      slot: p.slot,
      characters: this.lobby.players.map((x) => x.character),
      startStage: this.lobby.startStage,
      snapshotRate: SNAPSHOT_RATE,
      levelHash: this.lobby.game === "sonic3" ? loadSonic3Pack().hash : undefined,
    };
  }

  private onLoaded(client: Client): void {
    const p = this.playerOf(client);
    if (!p) return;
    p.loaded = true;
    if (this.lobby.phase === "loading") this.maybeBeginPlay();
    else if (this.lobby.phase === "playing") {
      // a reconnecting client: next snapshot is a keyframe
      const seat = this.seatOf(client);
      if (seat) seat.ackSnap = KEYFRAME;
    }
    this.broadcastLobby();
  }

  private maybeBeginPlay(force = false): void {
    if (this.lobby.phase !== "loading") return;
    const players = this.lobby.players;
    if (!players.length) return;
    if (!force && !players.every((p) => p.loaded || !p.connected)) return;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.beginPlay();
  }

  // ---- the game --------------------------------------------------------------------------------------------------

  private beginPlay(): void {
    const players = [...this.lobby.players].sort((a, b) => a.slot - b.slot);
    const host: ScriptHost = {
      log: (m) => log("script", `${this.lobby.code}: ${m}`),
      playSfx() {}, stopSfx() {}, setSfxAttributes() {}, setMusicTrack() {}, playMusic() {}, stopMusic() {},
      pauseMusic() {}, resumeMusic() {}, swapMusicTrack() {}, setMusicVolume() {},
    };
    const slots = Math.max(...players.map((p) => p.slot)) + 1;
    const characters = Array.from({ length: slots }, (_, s) => players.find((p) => p.slot === s)?.character ?? 0);
    try {
      if (this.lobby.game === "sonic3") {
        this.v5 = createSonic3Game();
      } else {
        const sim = createGameSim(this.lobby.game, loadVfs(this.lobby.game), host, { headless: true, players: slots });
        sim.configurePlayers(characters);
        sim.startStage(1, this.startListPos(sim));
        this.sim = sim;
      }
    } catch (e) {
      log("error", `${this.lobby.code}: could not start: ${(e as Error).stack}`);
      this.endGame("The server could not start the game");
      return;
    }
    this.seats = Array.from({ length: slots }, (_, s) => {
      const p = players.find((x) => x.slot === s);
      return p ? { sessionId: p.id, queue: [], lastQueuedSeq: -1, lastPad: 0, ackSeq: 0, ackSnap: KEYFRAME } : null;
    });
    this.snapshots.clear();
    this.lobby.phase = "playing";
    this.broadcastLobby();
    this.startLoop();
  }

  /** The regular stage list position of the lobby's chosen level. */
  private startListPos(sim: AnyGameSim): number {
    let pos = this.lobby.startStage;
    try {
      pos = stageList(this.lobby.game)[pos]?.listPos ?? pos;
    } catch {
      /* no stage list: use the index */
    }
    return Math.max(0, Math.min(pos, sim.E.stageListCount[1] - 1));
  }

  private onInput(client: Client, bytes: Uint8Array): void {
    const seat = this.seatOf(client);
    if (!seat || !(bytes instanceof Uint8Array) || bytes.length < 6) return;
    const { seq, pad } = decodeInput(bytes);
    if (seq <= seat.lastQueuedSeq) return;
    seat.lastQueuedSeq = seq;
    seat.queue.push({ seq, pad });
    if (seat.queue.length > MAX_INPUT_BUFFER * 4) seat.queue.splice(0, seat.queue.length - MAX_INPUT_BUFFER);
  }

  private startLoop(): void {
    this.stopLoop();
    const step = 1000 / 60;
    let next = performance.now();
    const loop = () => {
      const now = performance.now();
      let n = 0;
      while (now >= next && n < 6) {
        this.step();
        next += step;
        n++;
      }
      if (now - next > 250) next = now; // too far behind (debugger, overload): drop time instead of spiralling
      this.loopTimer = setTimeout(loop, Math.max(0, next - performance.now()));
    };
    this.loopTimer = setTimeout(loop, 0);
  }

  private stopLoop(): void {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private step(): void {
    if (!this.sim && !this.v5) return;
    const pads: number[] = [];
    for (const seat of this.seats) {
      if (!seat) {
        pads.push(0);
        continue;
      }
      // keep the buffer short: a backlog means the client is ahead; skipping inputs keeps latency bounded
      while (seat.queue.length > MAX_INPUT_BUFFER) seat.queue.shift();
      const inp = seat.queue.shift();
      if (inp) {
        seat.lastPad = inp.pad;
        seat.ackSeq = inp.seq;
      }
      const connected = this.lobby.players.find((p) => p.id === seat.sessionId)?.connected ?? false;
      pads.push(connected ? seat.lastPad : 0);
    }
    if (this.v5) {
      this.stepSonic3(pads);
      return;
    }
    const sim = this.sim!;
    let events: GameEvent[];
    const t0 = performance.now();
    try {
      events = sim.tick(pads);
    } catch (e) {
      log("error", `${this.lobby.code}: simulation error: ${(e as Error).stack}`);
      this.endGame("The game hit an error and was stopped");
      return;
    }
    stats.tickMs = stats.tickMs * 0.98 + (performance.now() - t0) * 0.02;
    stats.ticks++;
    this.serverTick++;
    for (const ev of events) this.onGameEvent(ev);
    if (this.sim && this.serverTick % Math.round(60 / SNAPSHOT_RATE) === 0) this.sendSnapshots(pads);
  }

  private stepSonic3(pads: number[]): void {
    const world = this.v5!;
    const t0 = performance.now();
    try {
      world.tick([pads[0] ?? 0, pads[1] ?? 0]);
    } catch (e) {
      log("error", `${this.lobby.code}: Sonic 3 simulation error: ${(e as Error).stack}`);
      this.endGame("The game hit an error and was stopped");
      return;
    }
    stats.tickMs = stats.tickMs * 0.98 + (performance.now() - t0) * 0.02;
    stats.ticks++;
    this.serverTick++;
    if (this.serverTick % 3 !== 0) return;
    const snapshot: V5OnlineSnapshot = {
      state: world.capture(),
      playing: true,
      owner: this.lobby.hostId,
      acknowledged: [0, 1].map((slot) => this.seats[slot]?.ackSeq ?? -1),
      players: this.lobby.players.map((p) => ({ id: p.id, slot: p.slot })),
    };
    this.broadcast("world", snapshot);
  }

  private onGameEvent(ev: GameEvent): void {
    this.broadcast("event", ev);
    if (ev.type === "gameOver") setTimeout(() => this.endGame("Game over"), 3000);
    else if (ev.type === "endGame") setTimeout(() => this.endGame("Thanks for playing!"), 3000);
    else if (ev.type === "scriptError") {
      log("error", `${this.lobby.code}: script error: ${ev.message}`);
      this.endGame(`Script error: ${ev.message}`);
    } else if (ev.type === "stageLoaded") log("room", `${this.lobby.code}: stage ${ev.name}`);
  }

  private sendSnapshots(pads: number[]): void {
    const sim = this.sim!;
    const state = captureState(sim.E);
    const id = ++this.snapId;
    this.snapshots.set(id, state);
    const acks = this.seats.map((s) => s?.ackSeq ?? 0);
    for (const client of this.clients) {
      const seat = this.seatOf(client);
      const player = this.playerOf(client);
      if (!seat || !player?.loaded) continue;
      const base = seat.ackSnap !== KEYFRAME ? this.snapshots.get(seat.ackSnap) : undefined;
      const payload = base ? encodeDelta(base, state) : state;
      const bytes = encodeSnapshot({ snapId: id, baseId: base ? seat.ackSnap : KEYFRAME, tick: this.serverTick, acks, pads }, payload);
      client.sendBytes("snap", bytes);
      stats.bytesOut += bytes.length;
    }
    // drop snapshots nobody can still use as a baseline
    const oldestNeeded = Math.min(id, ...this.seats.filter((s): s is Seat => !!s && s.ackSnap !== KEYFRAME).map((s) => s.ackSnap));
    for (const k of this.snapshots.keys()) if (k < oldestNeeded || k <= id - SNAPSHOT_HISTORY) this.snapshots.delete(k);
  }

  private onDev(client: Client, msg: { setStage?: number; restart?: boolean; teleport?: boolean }): void {
    if (!DEV_TOOLS || !this.sim) return;
    const sim = this.sim;
    if (typeof msg.setStage === "number") {
      const pos = stageList(this.lobby.game)[msg.setStage]?.listPos ?? msg.setStage;
      sim.startStage(1, Math.max(0, Math.min(pos, sim.E.stageListCount[1] - 1)));
    }
    if (msg.restart) sim.startStage(sim.E.activeStageList, sim.E.stageListPosition);
    if (msg.teleport) sim.emergencyTeleport();
    log("dev", `${this.lobby.code}: ${client.sessionId} ${JSON.stringify(msg)}`);
  }

  private endGame(message: string): void {
    this.stopLoop();
    this.sim = null;
    this.v5 = null;
    this.seats = [];
    this.snapshots.clear();
    this.lobby.phase = "lobby";
    this.lobby.message = message;
    for (const p of this.lobby.players) {
      p.ready = false;
      p.loaded = false;
    }
    this.lobby.players = this.lobby.players.filter((p) => p.connected);
    if (!this.lobby.players.some((p) => p.id === this.lobby.hostId)) this.lobby.hostId = this.lobby.players[0]?.id ?? "";
    this.broadcast("end", { message });
    this.broadcastLobby();
  }
}
