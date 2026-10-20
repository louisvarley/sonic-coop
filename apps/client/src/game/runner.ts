// Runs one online game in the page: the predicted simulation, the 60 Hz loop, rendering and the overlays.

import type { Room } from "colyseus.js";
import {
  SoftwareRenderer, SoftwareRenderer3, Engine, BTN, CAM_INDEX, CAM_STRIDE, CAM3_INDEX, CAM3_STRIDE, type GameEvent, type LobbyState, type StartInfo,
} from "@ringlink/engine";
import { NetGame } from "../net/netgame.js";
import { AudioHost } from "../audio.js";
import { Input } from "../input.js";
import { loadGameData } from "./data.js";
import { TouchControls, isTouchDevice } from "./touch.js";
import { ChatOverlay, type Chat } from "../chat.js";

const SCREEN_W = 424;
const SCREEN_H = 240;
const FRAME_MS = 1000 / 60;
const GAME_TITLES: Record<string, string> = { sonic1: "Sonic 1", sonic2: "Sonic 2", soniccd: "Sonic CD" };

export interface RunnerUI {
  root: HTMLElement;
  toast(msg: string): void;
  onExit(): void;
  chat?: Chat;
}

export class GameRunner {
  private net: NetGame | null = null;
  private audio: AudioHost | null = null;
  private renderer: SoftwareRenderer | SoftwareRenderer3;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private running = false;
  private status: HTMLElement;
  private devPanel: HTMLElement;
  private showDev = false;
  private showIds = false;
  private ping = 0;
  private fps = 0;
  private frames = 0;
  private fpsAt = 0;
  private scaleMode: "pixel" | "fit" = "pixel";
  private resizeObs: ResizeObserver;
  private touch: TouchControls | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private wentFullscreen = false;
  private chat: ChatOverlay | null = null;

  constructor(
    private room: Room,
    private info: StartInfo,
    private lobby: () => LobbyState,
    private input: Input,
    private ui: RunnerUI,
  ) {
    this.renderer = info.game === "soniccd" ? new SoftwareRenderer3(SCREEN_W) : new SoftwareRenderer(SCREEN_W);
    const root = ui.root;
    root.innerHTML = `
      <div class="game-stage">
        <canvas class="game-canvas" width="${SCREEN_W}" height="${SCREEN_H}"></canvas>
        <canvas class="game-overlay" width="${SCREEN_W * 2}" height="${SCREEN_H * 2}"></canvas>
        <div class="game-status">Loading…</div>
        <pre class="dev-panel" hidden></pre>
        <div class="rotate-hint">Turn your phone sideways</div>
      </div>
      <div class="game-bar">
        <span class="game-bar-title"></span>
        <span class="spacer"></span>
        <button data-act="chat" title="Chat with the other players (Y)" hidden>Chat</button>
        <button data-act="teleport" title="Bring whoever is furthest behind to the player in front (T / gamepad Y)">Regroup</button>
        <button data-act="scale" title="Pixel-perfect or fit-to-window scaling">Pixel perfect</button>
        <button data-act="mute" title="Mute">Mute</button>
        <button data-act="fullscreen" title="Fullscreen (F11)">Fullscreen</button>
        <button data-act="dev" hidden>Dev</button>
        <button data-act="leave" class="danger">Leave</button>
      </div>`;
    this.canvas = root.querySelector(".game-canvas")!;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.overlay = root.querySelector(".game-overlay")!;
    this.octx = this.overlay.getContext("2d")!;
    this.status = root.querySelector(".game-status")!;
    this.devPanel = root.querySelector(".dev-panel")!;
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.pixels = new Uint32Array(this.image.data.buffer);
    try {
      this.scaleMode = (localStorage.getItem("ringlink.scale") as "pixel" | "fit") ?? "pixel";
    } catch {
      /* ignore */
    }
    root.querySelector<HTMLElement>(".game-bar-title")!.textContent = `${GAME_TITLES[info.game] ?? info.game} · Room ${lobby().code} · Player ${info.slot + 1}`;
    root.querySelector<HTMLButtonElement>('[data-act="dev"]')!.hidden = !lobby().devTools;
    root.querySelector(".game-bar")!.addEventListener("click", (e) => this.onBar((e.target as HTMLElement).closest("button")?.dataset.act));
    this.updateScaleButton();
    if (ui.chat) {
      this.chat = new ChatOverlay(ui.chat, root.querySelector(".game-stage")!, info.slot, (open) => {
        // typing must not steer the character
        this.input.enabled = !open;
        if (open) root.classList.remove("bar-open");
      });
    }
    this.onLobby();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(root.querySelector(".game-stage")!);
    window.addEventListener("keydown", this.onKey);
    if (isTouchDevice()) this.enableTouch();
    else window.addEventListener("touchstart", this.onFirstTouchEvent, { once: true, passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Chat is there when the host allows it and someone else is in the room. */
  private chatAvailable(): boolean {
    const l = this.lobby();
    return !!this.chat && l.chat && l.players.length > 1;
  }

  /** The lobby state changed (a player joined or left, the host changed an option). */
  onLobby(): void {
    const available = this.chatAvailable();
    this.ui.root.querySelector<HTMLButtonElement>('[data-act="chat"]')!.hidden = !available;
    if (this.chat) this.chat.root.hidden = !available;
    if (!available) this.chat?.close();
  }

  private onFirstTouchEvent = () => {
    if (this.running || this.net) this.enableTouch();
  };

  private enableTouch(): void {
    if (this.touch) return;
    const root = this.ui.root;
    root.classList.add("touch");
    // fit the screen (pixel-perfect steps leave big borders on a phone) unless the player chose otherwise
    try {
      if (!localStorage.getItem("ringlink.scale")) this.scaleMode = "fit";
    } catch {
      this.scaleMode = "fit";
    }
    this.updateScaleButton();
    this.touch = new TouchControls(root.querySelector(".game-stage")!, {
      regroup: () => this.room.send("regroup"),
      menu: () => root.classList.toggle("bar-open"),
      touched: () => this.onFirstTouch(),
    });
    this.layout();
  }

  /** On the first touch: sound may start, and on phones that allow it the game goes fullscreen in landscape. */
  private onFirstTouch(): void {
    this.audio?.resume();
    if (this.wentFullscreen) return;
    this.wentFullscreen = true;
    const page = document.documentElement;
    if (!document.fullscreenElement && page.requestFullscreen) {
      page.requestFullscreen({ navigationUI: "hide" })
        .then(() => (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.("landscape"))
        .catch(() => {});
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === "hidden") this.touch?.reset();
    else void this.keepAwake();
  };

  /** Stop the phone dimming its screen mid-act (the lock is dropped whenever the page is hidden). */
  private async keepAwake(): Promise<void> {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl || !this.running) return;
    try {
      this.wakeLock = await wl.request("screen");
    } catch {
      /* not allowed (battery saver, unsupported) */
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "KeyY" && this.chatAvailable()) {
      e.preventDefault();
      this.chat!.open();
    } else if (e.code === "F11") {
      e.preventDefault();
      this.toggleFullscreen();
    } else if (e.code === "F1" && this.lobby().devTools) {
      e.preventDefault();
      this.toggleDev();
    } else if (e.code === "F3" && this.lobby().devTools && this.net?.sim.E instanceof Engine) {
      e.preventDefault();
      this.net.sim.E.showHitboxes = !this.net.sim.E.showHitboxes;
    } else if (e.code === "F4" && this.lobby().devTools) {
      e.preventDefault();
      this.showIds = !this.showIds;
    } else if (e.code === "F5" && this.lobby().devTools) {
      e.preventDefault();
      this.room.send("dev", { restart: true });
    }
  };

  private onBar(act?: string): void {
    this.audio?.resume();
    switch (act) {
      case "chat":
        if (this.chatAvailable()) this.chat!.open();
        break;
      case "teleport":
        this.room.send("regroup");
        break;
      case "scale":
        this.scaleMode = this.scaleMode === "pixel" ? "fit" : "pixel";
        try {
          localStorage.setItem("ringlink.scale", this.scaleMode);
        } catch {
          /* ignore */
        }
        this.updateScaleButton();
        this.layout();
        break;
      case "mute":
        if (this.audio) {
          this.audio.setVolumes({ muted: !this.audio.volumes.muted });
          this.ui.root.querySelector<HTMLButtonElement>('[data-act="mute"]')!.textContent = this.audio.volumes.muted ? "Unmute" : "Mute";
        }
        break;
      case "fullscreen":
        this.toggleFullscreen();
        break;
      case "dev":
        this.toggleDev();
        break;
      case "leave":
        this.ui.onExit();
        break;
    }
  }

  /** Whether the regroup button (T / gamepad Y) was held last frame. */
  private teleportHeld = false;

  private updateScaleButton(): void {
    this.ui.root.querySelector<HTMLButtonElement>('[data-act="scale"]')!.textContent = this.scaleMode === "pixel" ? "Pixel perfect" : "Fit window";
  }

  private toggleDev(): void {
    this.showDev = !this.showDev;
    this.devPanel.hidden = !this.showDev;
  }

  private toggleFullscreen(): void {
    // phones put the whole page fullscreen so the touch controls and menu come along
    const el = this.touch ? document.documentElement : this.ui.root.querySelector<HTMLElement>(".game-stage")!;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.()?.catch(() => {});
  }

  /** Integer scaling when it fits (crisp pixels), otherwise the largest size keeping the aspect ratio. */
  private layout(): void {
    const stage = this.ui.root.querySelector<HTMLElement>(".game-stage")!;
    const w = stage.clientWidth, h = stage.clientHeight;
    let scale = Math.min(w / SCREEN_W, h / SCREEN_H);
    if (this.scaleMode === "pixel" && scale >= 1) scale = Math.floor(scale);
    const cw = Math.floor(SCREEN_W * scale), ch = Math.floor(SCREEN_H * scale);
    for (const c of [this.canvas, this.overlay]) {
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
    }
  }

  async start(): Promise<void> {
    const { info } = this;
    this.status.textContent = "Downloading game data…";
    const data = await loadGameData(info.game, (f) => (this.status.textContent = `Downloading game data… ${Math.round(f * 100)}%`));
    this.audio = new AudioHost(info.game, data.audioIndex, (m) => console.debug(`[game] ${m}`), data.audioLoops);
    this.status.textContent = "Starting…";
    // one frame of yield so the status paints before the (synchronous) stage load
    await new Promise((r) => setTimeout(r, 0));
    this.net = new NetGame(this.room, data.vfs, this.audio, info, { headless: false });
    this.setDraw(true);
    if (this.renderer instanceof SoftwareRenderer) this.renderer.overlay = (E, r) => this.drawHitboxes(E, r);
    this.room.onMessage("snap", (bytes: Uint8Array) => this.net?.onSnapshot(bytes));
    this.room.onMessage("event", (e: GameEvent) => this.onServerEvent(e));
    this.room.onMessage("pong", (m: { t: number }) => (this.ping = performance.now() - m.t));
    this.audio.preload();
    this.room.send("loaded");
    this.status.textContent = "Waiting for the other players…";
    this.layout();
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.pingTimer = setInterval(() => this.room.send("ping", performance.now()), 2000);
    document.addEventListener("pointerdown", this.unlockAudio);
    document.addEventListener("touchend", this.unlockAudio);
    document.addEventListener("keydown", this.unlockAudio);
    void this.keepAwake();
  }

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unlockAudio = () => this.audio?.resume();

  private onServerEvent(e: GameEvent): void {
    if (e.type === "gameOver") this.ui.toast("Game over");
    if (e.type === "stageLoaded") this.ui.toast(e.name);
    if (e.type === "notice") this.ui.toast(e.message);
    if (e.type === "teleport") {
      const who = e.from.map((p) => (p === this.info.slot ? "You" : `Player ${p + 1}`)).join(", ");
      this.ui.toast(`${who} warped to ${e.to === this.info.slot ? "you" : `player ${e.to + 1}`}`);
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const net = this.net;
    if (!net) return;
    if (!net.started) return;
    this.status.hidden = true;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    let steps = 0;
    while (this.acc >= FRAME_MS && steps < 4) {
      this.acc -= FRAME_MS;
      steps++;
    }
    if (this.acc > FRAME_MS * 4) this.acc = 0;
    for (let i = 0; i < steps; i++) {
      let pad = this.input.read() | (this.touch?.pad ?? 0);
      // regroup is a server request, not part of the simulated pad
      const teleport = (pad & BTN.TELEPORT) !== 0;
      if (teleport && !this.teleportHeld) this.room.send("regroup");
      this.teleportHeld = teleport;
      pad &= ~BTN.TELEPORT;
      this.setDraw(i === steps - 1);
      net.step(pad);
    }
    this.setDraw(true);
    if (steps > 0) {
      this.renderer.toRGBA(this.pixels);
      this.ctx.putImageData(this.image, 0, 0);
      this.frames++;
      this.drawOverlay();
    }
    if (now - this.fpsAt > 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.fpsAt = now;
      if (this.showDev) this.updateDevPanel();
    }
  };

  /** Draw (into the renderer) on the next tick, or simulate headless. */
  private setDraw(on: boolean): void {
    if (!this.net) return;
    (this.net.sim.E as { draw: unknown }).draw = on ? this.renderer : null;
  }

  /** Camera scroll offset of a player slot. */
  private camScroll(slot: number): [number, number] {
    const E = this.net!.sim.E;
    if (E instanceof Engine) return [E.cams[slot * CAM_STRIDE + CAM_INDEX.xScrollOffset], E.cams[slot * CAM_STRIDE + CAM_INDEX.yScrollOffset]];
    return [E.cams[slot * CAM3_STRIDE + CAM3_INDEX.xScrollOffset], E.cams[slot * CAM3_STRIDE + CAM3_INDEX.yScrollOffset]];
  }

  // ---- developer overlays ----------------------------------------------------------------------------------------

  private drawHitboxes(E: import("@ringlink/engine").Engine, r: SoftwareRenderer): void {
    if (!E.showHitboxes) return;
    const colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 255, 0]];
    for (let i = 0; i < E.debugHitboxCount; i++) {
      const h = E.debugHitboxList[i];
      const x = (h.xpos >> 16) - E.xScrollOffset + h.left, y = (h.ypos >> 16) - E.yScrollOffset + h.top;
      const [cr, cg, cb] = h.collision ? [255, 255, 255] : colors[h.type] ?? [255, 0, 255];
      r.DrawRectangle(E, x, y, h.right - h.left, h.bottom - h.top, cr, cg, cb, 0x60);
    }
  }

  private drawOverlay(): void {
    const o = this.octx;
    o.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.showIds || !this.net) return;
    const E = this.net.sim.E;
    const [xo, yo] = this.camScroll(this.net.sim.viewCamera);
    o.font = "10px monospace";
    o.textAlign = "center";
    for (let i = 0; i < 0x4a0; i++) {
      const e = E.objectEntityList[i];
      if (!e.type || (E instanceof Engine && !E.processObjectFlag[i])) continue;
      const x = ((e.xpos >> 16) - xo) * 2, y = ((e.ypos >> 16) - yo) * 2;
      if (x < 0 || y < 0 || x > this.overlay.width || y > this.overlay.height) continue;
      const label = `${i}:${E.typeNames[e.type]}`;
      o.fillStyle = "rgba(0,0,0,0.6)";
      o.fillRect(x - label.length * 3 - 2, y - 16, label.length * 6 + 4, 12);
      o.fillStyle = "#ff0";
      o.fillText(label, x, y - 6);
    }
  }

  private updateDevPanel(): void {
    const net = this.net;
    if (!net) return;
    const E = net.sim.E;
    const lines: string[] = [];
    const stage = E.stageList[E.activeStageList]?.[E.stageListPosition];
    lines.push(`stage ${stage?.name ?? "?"} (${stage?.folder}) mode ${E.stageMode}`);
    lines.push(`fps ${this.fps}  ping ${this.ping.toFixed(0)} ms  tick ${E.tick}  server tick ${net.stats.serverTick}`);
    lines.push(`snapshots ${net.stats.snapshots} (last ${net.stats.lastSnapshotBytes} B)  predicted ${net.stats.pending}  resim ${net.stats.resimTicks}`);
    for (let p = 0; p < E.playerSlots; p++) {
      // RSDKv3 keeps the physics in a separate player struct bound to the entity
      const e = E instanceof Engine ? E.objectEntityList[p] : E.objectEntityList[E.playerList[p].boundEntity];
      const body = E instanceof Engine ? E.objectEntityList[p] : E.playerList[p];
      const st = E instanceof Engine ? (E.scriptFunctionList[e.state]?.name ?? e.state) : e.state;
      const [cx, cy] = this.camScroll(p);
      lines.push(
        `P${p + 1} ${E.typeNames[e.type]} pos ${body.xpos >> 16},${body.ypos >> 16} vel ${(body.xvel / 65536).toFixed(2)},${(body.yvel / 65536).toFixed(2)} speed ${(body.speed / 65536).toFixed(2)} v0 ${e.values[0]}`,
      );
      lines.push(`   state ${st} anim ${e.animation} cam ${cx},${cy}`);
    }
    const bosses = E.objectEntityList.filter((e) => e.type && /eggman|boss|robot|mecha/i.test(E.typeNames[e.type])).slice(0, 4);
    for (const b of bosses) lines.push(`boss ${E.typeNames[b.type]} @${b.xpos >> 16},${b.ypos >> 16} state ${b.state} v0..3 ${Array.from(b.values.slice(0, 4)).join(",")}`);
    lines.push("F1 panel  F3 hitboxes  F4 object ids  F5 restart act");
    this.devPanel.textContent = lines.join("\n");
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.pingTimer) clearInterval(this.pingTimer);
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("pointerdown", this.unlockAudio);
    document.removeEventListener("touchend", this.unlockAudio);
    document.removeEventListener("keydown", this.unlockAudio);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("touchstart", this.onFirstTouchEvent);
    this.touch?.dispose();
    this.chat?.dispose();
    this.input.enabled = true;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    if (this.touch && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.resizeObs.disconnect();
    this.audio?.dispose();
    this.net = null;
  }
}
