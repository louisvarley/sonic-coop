import { Input } from "../input.js";
import { readV5Level, type V5Sprite } from "../../../../packages/engine/src/v5/level.js";
import { V5CollisionWorld } from "../../../../packages/engine/src/v5/collision.js";
import { V5Movement } from "../../../../packages/engine/src/v5/movement.js";
import { V5Gameplay, type V5GameplayState } from "../../../../packages/engine/src/v5/gameplay.js";
import { renderV5Tiles } from "../../../../packages/engine/src/v5/render.js";
import "./sonic3-experiment.css";

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
  const level = readV5Level(new Uint8Array(await response.arrayBuffer()));
  if (level.spawns.length !== 2 || level.sprites.length !== 2) throw new Error("This experiment requires two player spawns and sprite sets");
  const sheets = level.sprites.map(spriteCanvas);
  const world = new V5CollisionWorld(level.layers, level.collision);
  const create = () => new V5Gameplay(new V5Movement(world, level.collisionLayers, level.spawns), level.objects, level.deathY);
  let game = create(), state = game.capture(), running = false, raf = 0, last = 0, accumulator = 0;
  const facing = [1, 1];
  const animators = [{ name: "", frame: 0, timer: 0 }, { name: "", frame: 0, timer: 0 }];
  document.querySelector<HTMLElement>("#unsupported")!.textContent =
    level.unsupported.map(({ name, count }) => `${name}: ${count}`).join("\n") || "None";
  function render(state: V5GameplayState): void {
    const collected = new Set(state.collected);
    for (let slot = 0; slot < 2; slot++) {
      const player = state.movement.players[slot], context = contexts[slot], image = images[slot];
      const x = Math.max(0, Math.floor(player.x / FP) - WIDTH / 2), y = Math.max(0, Math.floor(player.y / FP) - HEIGHT / 2);
      image.data.set(renderV5Tiles(level, { x, y, width: WIDTH, height: HEIGHT }));
      context.putImageData(image, 0, 0);
      for (const object of level.objects) {
        if (object.kind === "ring" && collected.has(object.id)) continue;
        const ox = Math.floor(object.x / FP) - x, oy = Math.floor(object.y / FP) - y;
        if (ox < -64 || ox > WIDTH + 64 || oy < -64 || oy > HEIGHT + 64) continue;
        context.lineWidth = 2;
        if (object.kind === "ring") {
          context.strokeStyle = "#ffd030"; context.beginPath(); context.ellipse(ox, oy, 5, 7, 0, 0, Math.PI * 2); context.stroke();
        } else if (object.kind === "checkpoint") {
          context.fillStyle = state.players.some((p) => p.checkpoint === object.id) ? "#40f080" : "#ff5060";
          context.fillRect(ox - 2, oy - 28, 4, 32); context.fillRect(ox - 7, oy - 28, 14, 8);
        } else if (object.kind === "spring") {
          context.fillStyle = "#ffe050"; context.fillRect(ox - 12, oy - 8, 24, 6);
          context.fillStyle = "#aaa"; context.fillRect(ox - 8, oy - 2, 16, 10);
        } else {
          context.fillStyle = "#ddd";
          for (let dx = -object.halfWidth; dx < object.halfWidth; dx += 16) {
            context.beginPath(); context.moveTo(ox + dx, oy + 8); context.lineTo(ox + dx + 8, oy - 8);
            context.lineTo(ox + dx + 16, oy + 8); context.fill();
          }
        }
      }
      for (let p = 0; p < 2; p++) {
        const entity = state.movement.players[p], sprite = level.sprites[p], animator = animators[p];
        if (state.players[p].invincible && state.movement.frame % 8 < 4) continue;
        const animation = sprite.animations.find((a) => a.name === animator.name) ?? sprite.animations[0];
        const frame = animation.frames[animator.frame];
        context.save(); context.imageSmoothingEnabled = false;
        context.translate(Math.floor(entity.x / FP) - x, Math.floor(entity.y / FP) - y);
        context.scale(facing[p], 1);
        context.drawImage(sheets[p], frame.x, frame.y, frame.width, frame.height, frame.pivotX, frame.pivotY, frame.width, frame.height);
        context.restore();
      }
      const hud = document.querySelector<HTMLElement>(`#hud${slot + 1}`)!;
      const progress = state.players[slot];
      hud.textContent = `Rings ${progress.rings} · Deaths ${progress.deaths} · x ${Math.floor(player.x / FP)} · y ${Math.floor(player.y / FP)}`;
      hud.dataset.x = String(player.x); hud.dataset.y = String(player.y);
    }
    status.dataset.frame = String(state.movement.frame);
  }
  function animate(): void {
    state.movement.players.forEach((player, slot) => {
      if (player.vx) facing[slot] = Math.sign(player.vx);
      const name = !player.grounded ? "Jump" : player.vx ? "Walk" : "Idle";
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
        game.tick(inputs.map((input) => input.read())); state = game.capture(); animate(); accumulator -= STEP;
      }
      render(state);
      raf = requestAnimationFrame(frame);
    } catch (error) { stop(); fail(error); }
  }
  start.onclick = () => {
    if (running) return;
    running = true; last = performance.now(); accumulator = 0;
    status.textContent = "Running experimental local simulation. Unsupported objects are listed below.";
    raf = requestAnimationFrame(frame);
  };
  pause.onclick = stop;
  restart.onclick = () => {
    stop(); game = create(); state = game.capture();
    animators.forEach((animator) => { animator.name = ""; animator.frame = 0; animator.timer = 0; });
    facing.fill(1); render(state);
    status.textContent = "Restarted. Press Start / resume.";
  };
  window.addEventListener("blur", stop);
  window.addEventListener("pagehide", stop);
  animate(); render(state);
  start.disabled = pause.disabled = restart.disabled = false;
  status.textContent = `Loaded ${level.title}. Press Start / resume.`;
}
function fail(error: unknown): void {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : String(error); status.dataset.error = "true";
  start.disabled = pause.disabled = restart.disabled = true;
}
run().catch(fail);
