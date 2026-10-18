// Runs one online game in the page: the predicted simulation, the 60 Hz loop, rendering and the overlays.

import type { Room } from "colyseus.js";
import { SoftwareRenderer, BTN, CAM_INDEX, CAM_STRIDE, type GameEvent, type LobbyState, type StartInfo } from "@ringlink/engine";
import { NetGame } from "../net/netgame.js";
import { AudioHost } from "../audio.js";
import { Input } from "../input.js";
import { loadGameData } from "./data.js";

const SCREEN_W = 424;
const SCREEN_H = 240;
const FRAME_MS = 1000 / 60;

export interface RunnerUI {
  root: HTMLElement;
  toast(msg: string): void;
  onExit(): void;
}

export class GameRunner {
  private net: NetGame | null = null;
  private audio: AudioHost | null = null;
  private renderer = new SoftwareRenderer(SCREEN_W);
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

  constructor(
    private room: Room,
    private info: StartInfo,
    private lobby: () => LobbyState,
    private input: Input,
    private ui: RunnerUI,
  ) {
    const root = ui.root;
    root.innerHTML = `
      <div class="game-stage">
        <canvas class="game-canvas" width="${SCREEN_W}" height="${SCREEN_H}"></canvas>
        <canvas class="game-overlay" width="${SCREEN_W * 2}" height="${SCREEN_H * 2}"></canvas>
        <div class="game-status">Loading…</div>
        <pre class="dev-panel" hidden></pre>
      </div>
      <div class="game-bar">
        <span class="game-bar-title"></span>
        <span class="spacer"></span>
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
    root.querySelector<HTMLElement>(".game-bar-title")!.textContent = `${info.game === "sonic1" ? "Sonic 1" : "Sonic 2"} · Room ${lobby().code} · Player ${info.slot + 1}`;
    root.querySelector<HTMLButtonElement>('[data-act="dev"]')!.hidden = !lobby().devTools;
    root.querySelector(".game-bar")!.addEventListener("click", (e) => this.onBar((e.target as HTMLElement).closest("button")?.dataset.act));
    this.updateScaleButton();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(root.querySelector(".game-stage")!);
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "F11") {
      e.preventDefault();
      this.toggleFullscreen();
    } else if (e.code === "F1" && this.lobby().devTools) {
      e.preventDefault();
      this.toggleDev();
    } else if (e.code === "F3" && this.lobby().devTools && this.net) {
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
      case "teleport":
        this.pendingTeleport = true;
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

  private pendingTeleport = false;

  private updateScaleButton(): void {
    this.ui.root.querySelector<HTMLButtonElement>('[data-act="scale"]')!.textContent = this.scaleMode === "pixel" ? "Pixel perfect" : "Fit window";
  }

  private toggleDev(): void {
    this.showDev = !this.showDev;
    this.devPanel.hidden = !this.showDev;
  }

  private toggleFullscreen(): void {
    const el = this.ui.root.querySelector<HTMLElement>(".game-stage")!;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
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
    this.audio = new AudioHost(info.game, data.audioIndex, (m) => console.debug(`[game] ${m}`));
    this.status.textContent = "Starting…";
    // one frame of yield so the status paints before the (synchronous) stage load
    await new Promise((r) => setTimeout(r, 0));
    this.net = new NetGame(this.room, data.vfs, this.audio, info, { headless: false });
    this.net.sim.E.draw = this.renderer;
    this.renderer.overlay = (E, r) => this.drawHitboxes(E, r);
    this.net.onEvent = (e) => this.onGameEvent(e);
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
    document.addEventListener("keydown", this.unlockAudio);
  }

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unlockAudio = () => this.audio?.resume();

  private onGameEvent(e: GameEvent): void {
    if (e.type === "teleport") this.ui.toast(`Player ${e.from + 1} warped to player ${e.to + 1}`);
  }

  private onServerEvent(e: GameEvent): void {
    if (e.type === "gameOver") this.ui.toast("Game over");
    if (e.type === "stageLoaded") this.ui.toast(e.name);
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
      let pad = this.input.read();
      if (this.pendingTeleport) {
        pad |= BTN.TELEPORT;
        this.pendingTeleport = false;
      }
      net.sim.E.draw = i === steps - 1 ? this.renderer : null;
      net.step(pad);
    }
    net.sim.E.draw = this.renderer;
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
    const xo = E.cams[this.info.slot * CAM_STRIDE + CAM_INDEX.xScrollOffset];
    const yo = E.cams[this.info.slot * CAM_STRIDE + CAM_INDEX.yScrollOffset];
    o.font = "10px monospace";
    o.textAlign = "center";
    for (let i = 0; i < 0x4a0; i++) {
      const e = E.objectEntityList[i];
      if (!e.type || !E.processObjectFlag[i]) continue;
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
      const e = E.objectEntityList[p];
      const st = E.scriptFunctionList[e.state]?.name ?? e.state;
      const cam = p * CAM_STRIDE;
      lines.push(
        `P${p + 1} ${E.typeNames[e.type]} pos ${e.xpos >> 16},${e.ypos >> 16} vel ${(e.xvel / 65536).toFixed(2)},${(e.yvel / 65536).toFixed(2)} speed ${(e.speed / 65536).toFixed(2)} rings ${e.values[0]}`,
      );
      lines.push(`   state ${st} anim ${e.animation} cam ${E.cams[cam + CAM_INDEX.xScrollOffset]},${E.cams[cam + CAM_INDEX.yScrollOffset]}`);
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
    document.removeEventListener("keydown", this.unlockAudio);
    this.resizeObs.disconnect();
    this.audio?.dispose();
    this.net = null;
  }
}
