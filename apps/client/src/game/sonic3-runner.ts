// Runs a Sonic 3 (RSDKv5) game started from the lobby: authoritative server world, local prediction for the own player,
// interpolated rendering of everything else.

import type { Room } from "colyseus.js";
import { encodeInput, type LobbyState, type StartInfo } from "@ringlink/engine";
import { readV5Level } from "../../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../../packages/engine/src/v5/movement.js";
import { V5Gameplay, type V5GameplayState } from "../../../../packages/engine/src/v5/gameplay.js";
import type { V5OnlineSnapshot } from "../../../../packages/engine/src/v5/net.js";
import { V5SnapshotBuffer } from "../../../../packages/engine/src/v5/interpolation.js";
import { V5Prediction } from "../../../../packages/engine/src/v5/prediction.js";
import { md5 } from "../../../../packages/engine/src/core/md5.js";
import type { Input } from "../input.js";
import type { RunnerUI } from "./runner.js";
import { createSonic3View, SONIC3_WIDTH as WIDTH, SONIC3_HEIGHT as HEIGHT, type Sonic3View } from "./sonic3-view.js";

const STEP = 1000 / 60;

export class Sonic3Runner {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private status: HTMLElement;
  private view: Sonic3View | null = null;
  private game: V5Gameplay | null = null;
  private prediction: V5Prediction | null = null;
  private snapshots = new V5SnapshotBuffer();
  private state: V5GameplayState | null = null;
  private sequence = 0;
  private running = false;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private scaleMode: "pixel" | "fit" = "pixel";
  private resizeObs: ResizeObserver;

  constructor(
    private room: Room,
    private info: StartInfo,
    lobby: () => LobbyState,
    private input: Input,
    private ui: RunnerUI,
  ) {
    const root = ui.root;
    root.innerHTML = `
      <div class="game-stage">
        <canvas class="game-canvas" width="${WIDTH}" height="${HEIGHT}"></canvas>
        <div class="game-status">Loading…</div>
      </div>
      <div class="game-bar">
        <span class="game-bar-title"></span>
        <span class="spacer"></span>
        <button data-act="scale" title="Pixel-perfect or fit-to-window scaling">Pixel perfect</button>
        <button data-act="fullscreen" title="Fullscreen (F11)">Fullscreen</button>
        <button data-act="leave" class="danger">Leave</button>
      </div>`;
    this.canvas = root.querySelector(".game-canvas")!;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
    this.status = root.querySelector(".game-status")!;
    try {
      this.scaleMode = (localStorage.getItem("ringlink.scale") as "pixel" | "fit") ?? "pixel";
    } catch {
      /* ignore */
    }
    root.querySelector<HTMLElement>(".game-bar-title")!.textContent = `Sonic 3 · Room ${lobby().code} · Player ${info.slot + 1}`;
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
    }
  };

  private onBar(act?: string): void {
    if (act === "scale") {
      this.scaleMode = this.scaleMode === "pixel" ? "fit" : "pixel";
      try {
        localStorage.setItem("ringlink.scale", this.scaleMode);
      } catch {
        /* ignore */
      }
      this.updateScaleButton();
      this.layout();
    } else if (act === "fullscreen") this.toggleFullscreen();
    else if (act === "leave") this.ui.onExit();
  }

  private updateScaleButton(): void {
    this.ui.root.querySelector<HTMLButtonElement>('[data-act="scale"]')!.textContent = this.scaleMode === "pixel" ? "Pixel perfect" : "Fit window";
  }

  private toggleFullscreen(): void {
    const el = this.ui.root.querySelector<HTMLElement>(".game-stage")!;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  private layout(): void {
    const stage = this.ui.root.querySelector<HTMLElement>(".game-stage")!;
    let scale = Math.min(stage.clientWidth / WIDTH, stage.clientHeight / HEIGHT);
    if (this.scaleMode === "pixel" && scale >= 1) scale = Math.floor(scale);
    this.canvas.style.width = `${Math.floor(WIDTH * scale)}px`;
    this.canvas.style.height = `${Math.floor(HEIGHT * scale)}px`;
  }

  async start(): Promise<void> {
    this.status.textContent = "Downloading Sonic 3 data…";
    const response = await fetch("/data/sonic3/experimental.pak");
    if (!response.ok) throw new Error(`Sonic 3 data is unavailable (${response.status}). Run npm run export:sonic3.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = [...md5(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (this.info.levelHash && this.info.levelHash !== hash) throw new Error("Sonic 3 data does not match the server. Re-export and reload.");
    const level = readV5Level(bytes);
    if (level.spawns.length !== 2 || level.sprites.length !== 2) throw new Error("Sonic 3 data needs two player spawns and sprite sets");
    const view = createSonic3View(level);
    const create = () => new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
      level.collisionLayers, level.spawns), level.objects, level.deathY);
    const game = create();
    this.view = view;
    this.game = game;
    this.prediction = new V5Prediction(create(), this.info.slot);
    this.room.onMessage("world", (snapshot: V5OnlineSnapshot) => this.onWorld(snapshot));
    this.room.send("loaded");
    this.status.textContent = "Waiting for the other players…";
    this.layout();
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private onWorld(snapshot: V5OnlineSnapshot): void {
    const { game, prediction, view } = this;
    if (!this.running || !game || !prediction || !view) return;
    try {
      const oldFrame = this.state?.movement.frame ?? 0;
      game.restore(snapshot.state);
      const state = game.capture();
      this.state = state;
      this.snapshots.push(state, performance.now());
      if (!snapshot.playing || state.movement.frame < oldFrame) prediction.reset(state);
      else prediction.reconcile(state, snapshot.acknowledged[this.info.slot]);
      if (state.movement.frame < oldFrame) view.resetAnimators();
      this.status.hidden = true;
    } catch (error) {
      this.fail(error);
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const { game, prediction, view, state } = this;
    if (!game || !prediction || !view || !state) return;
    try {
      this.accumulator += Math.min(100, now - this.last);
      this.last = now;
      while (this.accumulator >= STEP) {
        const pad = this.input.read();
        prediction.advance(++this.sequence, pad);
        this.room.sendBytes("in", encodeInput(this.sequence, pad));
        view.animate(prediction.capture());
        this.accumulator -= STEP;
      }
      const visual = this.snapshots.sample(now);
      const own = prediction.capture();
      visual.movement.players[this.info.slot] = own.movement.players[this.info.slot];
      view.renderSlot(this.ctx, this.image, this.info.slot, visual, game.waterY);
      this.drawHud(state, own);
    } catch (error) {
      this.fail(error);
    }
  };

  private drawHud(authoritative: V5GameplayState, own: V5GameplayState): void {
    const progress = authoritative.players[this.info.slot], player = own.movement.players[this.info.slot];
    const parts = [`RINGS ${progress.rings}`, `LIVES ${progress.lives}`];
    if (progress.shield !== "none") parts.push(`${progress.shield.toUpperCase()} SHIELD`);
    if (progress.airFrames <= 720) parts.push(`AIR ${Math.ceil(progress.airFrames / 60)}`);
    if (player.speedTime) parts.push("SPEED SHOES");
    this.ctx.font = "bold 10px monospace";
    this.ctx.textBaseline = "top";
    const text = parts.join("   ");
    this.ctx.fillStyle = "rgba(0,0,0,0.55)";
    this.ctx.fillRect(4, 4, this.ctx.measureText(text).width + 8, 14);
    this.ctx.fillStyle = "#ffd030";
    this.ctx.fillText(text, 8, 7);
  }

  private fail(error: unknown): void {
    console.error(error);
    this.stop();
    this.ui.toast(error instanceof Error ? error.message : String(error));
    this.ui.onExit();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    window.removeEventListener("keydown", this.onKey);
  }
}
