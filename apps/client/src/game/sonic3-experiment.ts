import { Input } from "../input.js";
import { readV5Level } from "../../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../../packages/engine/src/v5/movement.js";
import { V5Gameplay, type V5GameplayState } from "../../../../packages/engine/src/v5/gameplay.js";
import "./sonic3-experiment.css";
import { Client, type Room } from "colyseus.js";
import { encodeInput } from "../../../../packages/engine/src/net/protocol.js";
import type { V5OnlineSnapshot } from "../../../../packages/engine/src/v5/net.js";
import { md5 } from "../../../../packages/engine/src/core/md5.js";
import { V5SnapshotBuffer } from "../../../../packages/engine/src/v5/interpolation.js";
import { V5Prediction } from "../../../../packages/engine/src/v5/prediction.js";
import { createSonic3View, SONIC3_WIDTH as WIDTH, SONIC3_HEIGHT as HEIGHT } from "./sonic3-view.js";

const FP = 65536, STEP = 1000 / 60;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const pause = document.querySelector<HTMLButtonElement>("#pause")!;
const restart = document.querySelector<HTMLButtonElement>("#restart")!;
const status = document.querySelector<HTMLElement>("#status")!;
const canvases = [document.querySelector<HTMLCanvasElement>("#p1")!, document.querySelector<HTMLCanvasElement>("#p2")!];
const contexts = canvases.map((canvas) => {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D is unavailable");
  return context;
});
const images = contexts.map((context) => context.createImageData(WIDTH, HEIGHT));
const inputs = [
  new Input(window, { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT", KeyZ: "A" }),
  new Input(window, { KeyW: "UP", KeyS: "DOWN", KeyA: "LEFT", KeyD: "RIGHT", KeyJ: "A" }),
];
inputs.forEach((input, index) => { input.gamepad = index; });

async function run(): Promise<void> {
  const response = await fetch("/data/sonic3/experimental.pak");
  if (!response.ok) throw new Error(`Experimental pack unavailable (${response.status}). Run npm run export:sonic3 first.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const level = readV5Level(bytes);
  // Asset identity only, not authentication. Shared MD5 also works on non-HTTPS LAN development hosts.
  const levelHash = [...md5(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (level.spawns.length !== 2 || level.sprites.length !== 2) throw new Error("This experiment requires two player spawns and sprite sets");
  const view = createSonic3View(level);
  const create = () => new V5Gameplay(new V5Movement(new V5CollisionWorld(level.layers, level.collision),
    level.collisionLayers, level.spawns), level.objects, level.deathY);
  let game = create(), state = game.capture(), running = false, raf = 0, last = 0, accumulator = 0;
  let room: Room | null = null, sequence = 0, connecting = false, ownSlot = 0;
  const snapshots = new V5SnapshotBuffer();
  let prediction: V5Prediction | null = null;
  const onlineStatus = document.querySelector<HTMLElement>("#online-status")!;
  const createOnline = document.querySelector<HTMLButtonElement>("#create-online")!;
  const joinOnline = document.querySelector<HTMLButtonElement>("#join-online")!;
  const leaveOnline = document.querySelector<HTMLButtonElement>("#leave-online")!;
  document.querySelector<HTMLElement>("#unsupported")!.textContent =
    level.unsupported.map(({ name, count }) => `${name}: ${count}`).join("\n") || "None";
  document.querySelector<HTMLElement>("#missing-assets")!.textContent = level.missingAssets.join("\n") || "None";
  const render = (state: V5GameplayState, authoritative = state): void => {
    for (let slot = 0; slot < 2; slot++) {
      view.renderSlot(contexts[slot], images[slot], slot, state, game.waterY);
      const player = state.movement.players[slot];
      const hud = document.querySelector<HTMLElement>(`#hud${slot + 1}`)!;
      const progress = authoritative.players[slot], actualPlayer = authoritative.movement.players[slot];
      hud.textContent = `Rings ${progress.rings} · Lives ${progress.lives} · Deaths ${progress.deaths}`
        + `${progress.shield !== "none" ? ` · ${progress.shield} shield` : ""}`
        + `${progress.powerInvincible ? " · Invincible" : ""}${player.speedTime ? " · Speed shoes" : ""}`
        + `${progress.airFrames <= 720 ? ` · Air ${Math.ceil(progress.airFrames / 60)}s` : ""}`
        + ` · x ${Math.floor(player.x / FP)} · y ${Math.floor(player.y / FP)}`;
      hud.dataset.x = String(actualPlayer.x); hud.dataset.y = String(actualPlayer.y);
      hud.dataset.renderX = String(player.x); hud.dataset.renderY = String(player.y);
      hud.dataset.rolling = String(actualPlayer.rolling); hud.dataset.charge = String(actualPlayer.spinCharge);
      hud.dataset.vx = String(actualPlayer.vx);
      hud.dataset.plane = String(actualPlayer.plane); hud.dataset.priority = String(actualPlayer.highPriority);
      hud.dataset.flying = String(actualPlayer.flying); hud.dataset.flightTime = String(actualPlayer.flightTime);
      hud.dataset.underwater = String(actualPlayer.underwater); hud.dataset.air = String(progress.airFrames);
      hud.dataset.grab = String(actualPlayer.grabObject);
    }
    status.dataset.frame = String(authoritative.movement.frame);
  };
  function stop(): void {
    running = false; cancelAnimationFrame(raf); accumulator = 0;
    status.textContent = `Paused at frame ${state.movement.frame}. Experimental local simulation only.`;
  }
  function frame(now: number): void {
    if (!running) return;
    try {
      accumulator += Math.min(100, now - last); last = now;
      while (accumulator >= STEP) {
        if (room) {
          if (!prediction) throw new Error("Online prediction is not initialized");
          const pad = inputs[0].read();
          prediction.advance(++sequence, pad);
          room.sendBytes("in", encodeInput(sequence, pad));
        }
        else { game.tick(inputs.map((input) => input.read())); state = game.capture(); }
        view.animate(prediction && room ? prediction.capture() : state); accumulator -= STEP;
      }
      const visual = room ? snapshots.sample(now) : state;
      if (room && prediction) visual.movement.players[ownSlot] = prediction.capture().movement.players[ownSlot];
      render(visual, state);
      raf = requestAnimationFrame(frame);
    } catch (error) {
      stop();
      if (room) {
        console.error(error);
        const previous = room; room = null; prediction = null; onlineButtons();
        onlineStatus.textContent = error instanceof Error ? error.message : String(error);
        void previous.leave();
      } else fail(error);
    }
  }
  start.onclick = () => {
    if (room) { room.send("run", true); return; }
    if (running) return;
    running = true; last = performance.now(); accumulator = 0;
    status.textContent = "Running experimental local simulation. Unsupported objects are listed below.";
    raf = requestAnimationFrame(frame);
  };
  pause.onclick = () => { if (room) room.send("run", false); else stop(); };
  restart.onclick = () => {
    if (room) { room.send("restart"); return; }
    stop(); game = create(); state = game.capture();
    view.resetAnimators();
    render(state);
    status.textContent = "Restarted. Press Start / resume.";
  };
  window.addEventListener("blur", () => { if (room) room.sendBytes("in", encodeInput(++sequence, 0)); else stop(); });
  window.addEventListener("pagehide", () => { stop(); if (room) void room.leave(); });
  function onlineButtons(): void {
    createOnline.disabled = joinOnline.disabled = connecting || room !== null;
    leaveOnline.disabled = !room;
  }
  async function connect(join: boolean): Promise<void> {
    if (connecting || room) return;
    stop(); connecting = true; onlineButtons();
    try {
      const client = new Client(`${location.origin}/api`);
      const id = document.querySelector<HTMLInputElement>("#room-code")!.value.trim();
      if (join && !id) throw new Error("Enter an experimental room ID");
      const connected = join
        ? await client.joinById(id, { levelHash })
        : await client.create("sonic3-experiment", { levelHash });
      room = connected; sequence = 0;
      snapshots.clear(); prediction = null;
      connected.onMessage("welcome", ({ slot }: { slot: number }) => { ownSlot = slot; prediction = new V5Prediction(create(), slot); });
      connected.onMessage("notice", (message: string) => { onlineStatus.textContent = message; });
      connected.onMessage("world", (snapshot: V5OnlineSnapshot) => {
        if (room !== connected) return;
        try {
          const oldFrame = state.movement.frame;
          game.restore(snapshot.state); state = game.capture();
          snapshots.push(state, performance.now());
          if (!prediction) throw new Error("Missing online player assignment");
          if (!snapshot.playing || state.movement.frame < oldFrame) prediction.reset(state);
          else prediction.reconcile(state, snapshot.acknowledged[ownSlot]);
          if (state.movement.frame < oldFrame) view.resetAnimators();
          onlineStatus.textContent = `Room ${connected.roomId} · Player ${ownSlot + 1} · ${snapshot.players.length}/2 connected · ${snapshot.owner === connected.sessionId ? "You are host" : "Guest"}`;
          if (snapshot.playing && !running) {
            running = true; last = performance.now(); accumulator = 0; raf = requestAnimationFrame(frame);
          } else if (!snapshot.playing) stop();
          status.textContent = `${snapshot.playing ? "Online" : "Online paused"} at server frame ${state.movement.frame}. Experimental only.`;
          if (!snapshot.playing) render(state);
        } catch (error) { stop(); fail(error); void connected.leave(); }
      });
      connected.onLeave(() => {
        if (room !== connected) return;
        stop(); room = null; prediction = null; onlineButtons();
        onlineStatus.textContent = "Disconnected. Local two-player mode; restart to reset the world.";
      });
      connected.onError((code, message) => { onlineStatus.textContent = `Connection error ${code}: ${message}`; });
      document.querySelector<HTMLInputElement>("#room-code")!.value = connected.roomId;
    } catch (error) {
      console.error(error);
      onlineStatus.textContent = error instanceof Error ? error.message : String(error);
    } finally { connecting = false; onlineButtons(); }
  }
  createOnline.onclick = () => { void connect(false); };
  joinOnline.onclick = () => { void connect(true); };
  leaveOnline.onclick = () => {
    const previous = room; room = null; prediction = null; stop(); onlineButtons();
    onlineStatus.textContent = "Local two-player mode; restart to reset the world.";
    if (previous) void previous.leave();
  };
  view.animate(state); render(state);
  start.disabled = pause.disabled = restart.disabled = false;
  document.querySelector<HTMLFieldSetElement>("#online")!.disabled = false;
  status.textContent = `Loaded ${level.title}. Press Start / resume.`;
}
function fail(error: unknown): void {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : String(error); status.dataset.error = "true";
  start.disabled = pause.disabled = restart.disabled = true;
}
run().catch(fail);
