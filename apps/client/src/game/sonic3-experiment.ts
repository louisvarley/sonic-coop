import { Input } from "../input.js";
import { readV5Level, type V5Sprite } from "../../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../../packages/engine/src/v5/movement.js";
import { V5Gameplay, v5SpikesAt, v5PlatformAt, type V5GameplayState } from "../../../../packages/engine/src/v5/gameplay.js";
import { renderV5Tiles } from "../../../../packages/engine/src/v5/render.js";
import "./sonic3-experiment.css";
import { Client, type Room } from "colyseus.js";
import { encodeInput } from "../../../../packages/engine/src/net/protocol.js";
import type { V5OnlineSnapshot } from "../../../../packages/engine/src/v5/net.js";
import { md5 } from "../../../../packages/engine/src/core/md5.js";
import { BTN } from "../../../../packages/engine/src/input.js";
import { V5SnapshotBuffer } from "../../../../packages/engine/src/v5/interpolation.js";
import { v5CollapseTiles } from "../../../../packages/engine/src/v5/collapse.js";
import { v5SwingRopeAt } from "../../../../packages/engine/src/v5/ropes.js";
import { V5Prediction } from "../../../../packages/engine/src/v5/prediction.js";

const WIDTH = 424, HEIGHT = 240, FP = 65536, STEP = 1000 / 60;
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

function spriteCanvas(sprite: V5Sprite): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = sprite.width; canvas.height = sprite.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  const image = context.createImageData(sprite.width, sprite.height);
  for (let i = 0; i < sprite.pixels.length; i++) {
    const color = sprite.pixels[i];
    image.data[i * 4] = sprite.palette[color * 3]; image.data[i * 4 + 1] = sprite.palette[color * 3 + 1];
    image.data[i * 4 + 2] = sprite.palette[color * 3 + 2]; image.data[i * 4 + 3] = color ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

async function run(): Promise<void> {
  const response = await fetch("/data/sonic3/experimental.pak");
  if (!response.ok) throw new Error(`Experimental pack unavailable (${response.status}). Run npm run export:sonic3 first.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const level = readV5Level(bytes);
  // Asset identity only, not authentication. Shared MD5 also works on non-HTTPS LAN development hosts.
  const levelHash = [...md5(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (level.spawns.length !== 2 || level.sprites.length !== 2) throw new Error("This experiment requires two player spawns and sprite sets");
  const sheets = level.sprites.map(spriteCanvas);
  const objectSheets = level.objectSprites.map(spriteCanvas);
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
  const animators = [{ name: "", frame: 0, timer: 0 }, { name: "", frame: 0, timer: 0 }];
  const foregroundGroup = Math.max(...level.collisionLayers.map((i) => level.layers[i].drawGroup));
  const lowLayers = level.layers.flatMap((layer, i) => layer.visible && layer.drawGroup < foregroundGroup ? [i] : []);
  const foregroundLayers = level.layers.flatMap((layer, i) => layer.visible && layer.drawGroup >= foregroundGroup ? [i] : []);
  const foreground = document.createElement("canvas");
  foreground.width = WIDTH; foreground.height = HEIGHT;
  const foregroundContext = foreground.getContext("2d");
  if (!foregroundContext) throw new Error("Canvas 2D is unavailable");
  const foregroundImage = foregroundContext.createImageData(WIDTH, HEIGHT);
  document.querySelector<HTMLElement>("#unsupported")!.textContent =
    level.unsupported.map(({ name, count }) => `${name}: ${count}`).join("\n") || "None";
  document.querySelector<HTMLElement>("#missing-assets")!.textContent = level.missingAssets.join("\n") || "None";
  const render = (state: V5GameplayState, authoritative = state): void => {
    const collected = new Set(state.collected);
    const broken = new Set(state.broken);
    const enemies = new Map(state.enemyWorld.enemies.map((enemy) => [enemy.id, enemy]));
    const fallingTiles = level.objects.flatMap((object) => object.kind === "collapse"
      ? v5CollapseTiles(object, level.layers, state.collapses.find((entry) => entry.id === object.id)!.started, state.movement.frame) : []);
    for (let slot = 0; slot < 2; slot++) {
      const player = state.movement.players[slot], context = contexts[slot], image = images[slot];
      const x = Math.max(0, Math.floor(player.x / FP) - WIDTH / 2), y = Math.max(0, Math.floor(player.y / FP) - HEIGHT / 2);
      image.data.set(renderV5Tiles(level, { x, y, width: WIDTH, height: HEIGHT, layers: lowLayers, fallingTiles }));
      context.putImageData(image, 0, 0);
      context.lineWidth = 2; context.strokeStyle = "#ffd030";
      for (const ring of state.droppedRings) {
        if (ring.age >= 192 && state.movement.frame % 8 < 4) continue;
        const rx = Math.floor(ring.x / FP) - x, ry = Math.floor(ring.y / FP) - y;
        if (rx < -8 || rx > WIDTH + 8 || ry < -8 || ry > HEIGHT + 8) continue;
        context.beginPath(); context.ellipse(rx, ry, 5, 7, 0, 0, Math.PI * 2); context.stroke();
      }
      for (const object of level.objects) {
        if ((object.kind === "ring" && collected.has(object.id)) || (object.kind === "rock" && broken.has(object.id))) continue;
        const enemy = enemies.get(object.id);
        if (enemy?.defeated) continue;
        const position = enemy ?? (object.kind === "spikes" ? v5SpikesAt(object, state.movement.frame)
          : object.kind === "platform" ? v5PlatformAt(object, state.movement.frame) : object);
        if ("active" in position && !position.active) continue;
        const ox = Math.floor(position.x / FP) - x, oy = Math.floor(position.y / FP) - y;
        const extent = object.kind === "spikes" ? Math.max(64, object.count * 8)
          : object.kind === "swing-rope" ? object.links * 16 + 32
          : object.kind === "hazard" ? Math.max(64, object.halfWidth, object.halfHeight) : 64;
        if (ox < -extent || ox > WIDTH + extent || oy < -extent || oy > HEIGHT + extent) continue;
        context.lineWidth = 2;
        if (object.kind === "ring") {
          context.strokeStyle = "#ffd030"; context.beginPath(); context.ellipse(ox, oy, 5, 7, 0, 0, Math.PI * 2); context.stroke();
        } else if (object.kind === "checkpoint") {
          context.fillStyle = state.players.some((p) => p.checkpoint === object.id) ? "#40f080" : "#ff5060";
          context.fillRect(ox - 2, oy - 28, 4, 32); context.fillRect(ox - 7, oy - 28, 14, 8);
        } else if (object.kind === "spring") {
          context.save(); context.translate(ox, oy);
          context.rotate(Math.atan2(object.vx, -object.vy));
          const red = Math.max(Math.abs(object.vx), Math.abs(object.vy)) > 10 * FP;
          context.fillStyle = red ? "#ff4050" : "#ffe050"; context.fillRect(-16, -8, 32, 6);
          context.fillStyle = "#aaa"; context.fillRect(-8, -2, 16, 10); context.restore();
        } else if (object.kind === "spikes") {
          context.save(); context.translate(ox, oy);
          context.rotate(object.direction === 0 ? 0 : object.direction === 1 ? Math.PI : object.direction === 2 ? Math.PI / 2 : -Math.PI / 2);
          context.fillStyle = "#ddd";
          for (let dx = -object.count * 8; dx < object.count * 8; dx += 16) {
            context.beginPath(); context.moveTo(dx, 16); context.lineTo(dx + 8, -16);
            context.lineTo(dx + 16, 16); context.fill();
          }
          context.restore();
        } else if (object.kind === "swing-rope") {
          const position = v5SwingRopeAt(object, state.movement.frame), sprite = level.objectSprites[object.sprite];
          const draw = (name: string, x: number, y: number, index = 0) => {
            const frame = sprite.animations.find((a) => a.name === name)!.frames[index];
            context.drawImage(objectSheets[object.sprite], frame.x, frame.y, frame.width, frame.height,
              x + frame.pivotX, y + frame.pivotY, frame.width, frame.height);
          };
          context.imageSmoothingEnabled = false;
          const dx = (position.x - object.x) / FP / object.links, dy = (position.y - object.y) / FP / object.links;
          for (let link = 0; link < object.links; link++) {
            context.save(); context.translate(Math.round(ox + dx * link), Math.round(oy + dy * link));
            context.rotate(-position.angle * Math.PI / 128); draw("Rope", 0, 0); context.restore();
          }
          draw("Pivot", ox, oy);
          draw("Handle", Math.floor(position.x / FP) - x, Math.floor(position.y / FP) - y);
        } else if (object.kind === "monitor") {
          const sprite = level.objectSprites[object.sprite];
          const draw = (name: string, index: number, offsetY = 0) => {
            const frame = sprite.animations.find((a) => a.name === name)!.frames[index];
            context.imageSmoothingEnabled = false;
            context.drawImage(objectSheets[object.sprite], frame.x, frame.y, frame.width, frame.height,
              ox + frame.pivotX, oy + frame.pivotY + offsetY, frame.width, frame.height);
          };
          draw(broken.has(object.id) ? "Broken" : "Normal", 0);
          if (!broken.has(object.id)) draw("Powerups", object.item, -5);
        } else if (object.kind === "cyclone" || object.kind === "saruder" || object.kind === "tulippon") {
          if (!enemy) throw new Error("Missing enemy render state");
          const sprite = level.objectSprites[object.sprite];
          const draw = (name: string, dx = 0, dy = 0) => {
            const animation = sprite.animations.find((a) => a.name === name)!;
            const frame = animation.frames[Math.floor(enemy.timer / 8) % animation.frames.length];
            context.drawImage(objectSheets[object.sprite], frame.x, frame.y, frame.width, frame.height,
              dx + frame.pivotX, dy + frame.pivotY, frame.width, frame.height);
          };
          context.save(); context.imageSmoothingEnabled = false;
          context.translate(ox, oy); context.scale(-enemy.facing, 1);
          if (object.kind === "saruder") {
            draw("Tail"); draw("Body"); draw("Arm", -10, -18); draw("Hand", -14, -20);
          } else draw(object.kind === "cyclone" ? "Main" : enemy.timer >= 40 && enemy.timer < 60 ? "Firing" : "Idle");
          context.restore();
        } else if (object.kind === "platform" || object.kind === "rock") {
          const sprite = level.objectSprites[object.sprite], frame = sprite.animations[0].frames[object.kind === "rock" ? object.frame : 0];
          context.imageSmoothingEnabled = false;
          context.drawImage(objectSheets[object.sprite], frame.x, frame.y, frame.width, frame.height,
            ox + frame.pivotX, oy + frame.pivotY, frame.width, frame.height);
        } else if (object.kind === "hazard") {
          context.fillStyle = "#ddd";
          for (let dx = -object.halfWidth; dx < object.halfWidth; dx += 16) {
            context.beginPath(); context.moveTo(ox + dx, oy + 8); context.lineTo(ox + dx + 8, oy - 8);
            context.lineTo(ox + dx + 16, oy + 8); context.fill();
          }
        }
      }
      for (const shot of state.enemyWorld.projectiles) {
        const source = level.objects.find((object) => object.id === shot.source);
        if (!source || (source.kind !== "saruder" && source.kind !== "tulippon")) throw new Error("Missing projectile render source");
        const frame = level.objectSprites[source.sprite].animations.find((a) => a.name === (source.kind === "saruder" ? "Coconut" : "Spike"))!.frames[0];
        context.drawImage(objectSheets[source.sprite], frame.x, frame.y, frame.width, frame.height,
          Math.floor(shot.x / FP) - x + frame.pivotX, Math.floor(shot.y / FP) - y + frame.pivotY, frame.width, frame.height);
      }
      function drawPlayers(highPriority: boolean): void {
        for (let p = 0; p < 2; p++) {
          const entity = state.movement.players[p], sprite = level.sprites[p], animator = animators[p];
          if (entity.highPriority !== highPriority || (state.players[p].invincible && state.movement.frame % 8 < 4)) continue;
          const animation = sprite.animations.find((a) => a.name === animator.name) ?? sprite.animations[0];
          const frame = animation.frames[animator.frame];
          const progress = state.players[p];
          if (progress.shield !== "none" || progress.powerInvincible) {
            const color = progress.powerInvincible ? "#fff" : progress.shield === "fire" ? "#ff8040"
              : progress.shield === "lightning" ? "#ffea40" : progress.shield === "bubble" ? "#80e8ff" : "#6090ff";
            context.strokeStyle = color; context.lineWidth = 2;
            context.beginPath(); context.arc(Math.floor(entity.x / FP) - x, Math.floor(entity.y / FP) - y, 24, 0, Math.PI * 2); context.stroke();
          }
          context.save(); context.imageSmoothingEnabled = false;
          context.translate(Math.floor(entity.x / FP) - x, Math.floor(entity.y / FP) - y);
          if (entity.grounded) context.rotate(entity.angle * Math.PI / 128);
          context.scale(entity.facing, 1);
          context.drawImage(sheets[p], frame.x, frame.y, frame.width, frame.height, frame.pivotX, frame.pivotY, frame.width, frame.height);
          context.restore();
        }
      }
      drawPlayers(false);
      foregroundImage.data.set(renderV5Tiles(level, { x, y, width: WIDTH, height: HEIGHT, layers: foregroundLayers, transparent: true, fallingTiles }));
      foregroundContext.putImageData(foregroundImage, 0, 0);
      context.drawImage(foreground, 0, 0);
      drawPlayers(true);
      if (game.waterY !== null) {
        const surface = Math.max(0, Math.floor(game.waterY / FP) - y);
        if (surface < HEIGHT) {
          context.fillStyle = "#2060b840"; context.fillRect(0, surface, WIDTH, HEIGHT - surface);
          if (surface > 0) { context.fillStyle = "#a0e8ff"; context.fillRect(0, surface, WIDTH, 1); }
        }
      }
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
  function animate(visual = state): void {
    visual.movement.players.forEach((player, slot) => {
      const name = player.grabObject !== null ? "HangGimmick" : player.flying ? (player.flightTime >= 480 ? "Fly Tired" : "Fly")
        : player.spinCharge ? "Spindash" : !player.grounded || player.rolling ? "Jump"
        : !player.vx && (player.pad & BTN.DOWN) ? "Crouch" : player.vx ? "Walk" : "Idle";
      const animator = animators[slot], animation = level.sprites[slot].animations.find((a) => a.name === name);
      if (!animation) throw new Error(`Missing experimental ${name} sprite animation`);
      if (animator.name !== name) { animator.name = name; animator.frame = 0; animator.timer = 0; }
      animator.timer += animation.speed;
      while (animator.timer >= animation.frames[animator.frame].duration) {
        animator.timer -= animation.frames[animator.frame].duration;
        animator.frame++;
        if (animator.frame >= animation.frames.length) animator.frame = animation.loopIndex;
      }
    });
  }
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
        animate(prediction && room ? prediction.capture() : state); accumulator -= STEP;
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
    animators.forEach((animator) => { animator.name = ""; animator.frame = 0; animator.timer = 0; });
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
          if (state.movement.frame < oldFrame) {
            animators.forEach((a) => { a.name = ""; a.frame = 0; a.timer = 0; });
          }
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
  animate(); render(state);
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
