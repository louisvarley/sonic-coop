// Reproducible browser smoke check. Requires an exported pack, the client, and an opt-in experiment server.
// tsx tools/dev/check-sonic3.ts [client URL] [screenshot directory]
// BROWSER_CHANNEL may select an installed Playwright browser channel (Windows defaults to msedge).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://localhost:5173", out = path.join("data", "sonic3", "checks"), ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("usage: tsx tools/dev/check-sonic3.ts [client URL] [screenshot directory]");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined), headless: true });
const errors: string[] = [];
async function open(delay = 0): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  if (delay) await page.addInitScript((delay) => {
    const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage")!;
    Object.defineProperty(WebSocket.prototype, "onmessage", { ...descriptor,
      set(this: WebSocket, listener: ((this: WebSocket, event: MessageEvent) => void) | null) {
        const socket = this;
        descriptor.set!.call(socket, listener && socket.url.includes("/api/")
          ? (event: MessageEvent) => { setTimeout(() => { if (socket.readyState === WebSocket.OPEN) listener.call(socket, event); }, delay); }
          : listener);
      },
    });
  }, delay);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${message.location().url}: ${message.text()}`); });
  await page.goto(new URL("/sonic3.html", base).href);
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#start")!.disabled);
  return page;
}
const x = async (page: Page, slot: number) => Number(await page.locator(`#hud${slot + 1}`).getAttribute("data-x"));
async function waitFrame(page: Page, frame: number): Promise<void> {
  await page.waitForFunction((frame) => Number(document.querySelector<HTMLElement>("#status")!.dataset.frame) >= frame, frame);
}
async function spindash(page: Page, slot: number, down: string, jump: string): Promise<void> {
  const start = await x(page, slot);
  await page.keyboard.down(down); await page.keyboard.down(jump);
  await page.waitForFunction((slot) => Number(document.querySelector<HTMLElement>(`#hud${slot + 1}`)!.dataset.charge) > 0, slot);
  await page.keyboard.up(jump); await page.keyboard.up(down);
  await page.waitForFunction(({ slot, start }) => {
    const hud = document.querySelector<HTMLElement>(`#hud${slot + 1}`)!;
    return Number(hud.dataset.x) > start + 32 * 65536 && hud.dataset.rolling === "true"
      && Number(hud.dataset.charge) === 0 && Number(hud.dataset.vx) > 8 * 65536;
  }, { slot, start });
}
async function fly(page: Page, jump: string): Promise<void> {
  const initialY = Number(await page.locator("#hud2").getAttribute("data-y"));
  await page.keyboard.down(jump);
  await page.waitForFunction((start) => Number(document.querySelector<HTMLElement>("#hud2")!.dataset.y) < start - 4 * 65536, initialY);
  await page.keyboard.up(jump);
  const frame = Number(await page.locator("#status").getAttribute("data-frame"));
  await waitFrame(page, frame + 6);
  await page.keyboard.down(jump);
  await page.waitForFunction(() => document.querySelector<HTMLElement>("#hud2")!.dataset.flying === "true");
  await page.keyboard.up(jump);
}
try {
  const a = await open();
  assert.match(await a.locator("#missing-assets").textContent() ?? "", /Data\/Music\/3K\/AngelIsland1\.ogg/);
  await a.click("#start"); await waitFrame(a, 70);
  await spindash(a, 0, "ArrowDown", "KeyZ");
  await a.click("#restart"); await a.click("#start"); await waitFrame(a, 70);
  await spindash(a, 1, "KeyS", "KeyJ");
  await a.click("#pause");
  await a.locator(".views").screenshot({ path: path.join(out, "rolling.png") });
  await a.click("#restart");
  await a.click("#start"); await waitFrame(a, 70);
  await fly(a, "KeyJ"); await a.click("#pause");
  await a.locator(".views").screenshot({ path: path.join(out, "flight.png") });
  await a.click("#restart");
  await a.click("#start"); await waitFrame(a, 70);
  const initialX = await x(a, 0), initialOther = await x(a, 1);
  await a.keyboard.down("ArrowRight");
  await a.waitForFunction((start) => Number(document.querySelector<HTMLElement>("#hud1")!.dataset.x) > start + 50 * 65536, initialX);
  await a.keyboard.up("ArrowRight");
  assert.equal(await x(a, 1), initialOther, "P1 local controls must not move P2");
  await a.keyboard.down("KeyD");
  await a.waitForFunction((start) => Number(document.querySelector<HTMLElement>("#hud2")!.dataset.x) > start + 30 * 65536, initialOther);
  await a.keyboard.up("KeyD");
  await a.click("#pause");
  await a.locator(".views").screenshot({ path: path.join(out, "local.png") });

  await a.click("#create-online");
  await a.waitForFunction(() => document.querySelector("#online-status")!.textContent!.includes("You are host"));
  const code = await a.locator("#room-code").inputValue();
  const b = await open();
  await b.fill("#room-code", code); await b.click("#join-online");
  await b.waitForFunction(() => document.querySelector("#online-status")!.textContent!.includes("Player 2"));
  await b.click("#start");
  await b.waitForFunction(() => document.querySelector("#online-status")!.textContent!.includes("Only the host"));
  await a.click("#start"); await waitFrame(a, 70); await waitFrame(b, 70);
  await fly(b, "KeyZ");
  await a.waitForFunction(() => document.querySelector<HTMLElement>("#hud2")!.dataset.flying === "true");
  await a.click("#restart");
  await a.waitForFunction(() => document.querySelector<HTMLElement>("#status")!.dataset.frame === "0");
  await b.waitForFunction(() => document.querySelector<HTMLElement>("#status")!.dataset.frame === "0");
  await a.click("#start"); await waitFrame(a, 70); await waitFrame(b, 70);
  await Promise.all([spindash(a, 0, "ArrowDown", "KeyZ"), spindash(b, 1, "ArrowDown", "KeyZ")]);
  await a.click("#restart");
  await a.waitForFunction(() => document.querySelector<HTMLElement>("#status")!.dataset.frame === "0");
  await b.waitForFunction(() => document.querySelector<HTMLElement>("#status")!.dataset.frame === "0");
  await a.click("#start"); await waitFrame(a, 70); await waitFrame(b, 70);
  const remoteStart = [await x(a, 0), await x(a, 1)];
  await a.keyboard.down("ArrowRight"); await b.keyboard.down("ArrowRight");
  await a.waitForFunction((start) => Number(document.querySelector<HTMLElement>("#hud1")!.dataset.x) > start + 100 * 65536, remoteStart[0]);
  await b.waitForFunction((start) => Number(document.querySelector<HTMLElement>("#hud2")!.dataset.x) > start + 100 * 65536, remoteStart[1]);
  await a.keyboard.up("ArrowRight"); await b.keyboard.up("ArrowRight");
  await a.click("#pause");
  await a.waitForFunction(() => document.querySelector("#status")!.textContent!.includes("Online paused"));
  await b.waitForFunction(() => document.querySelector("#status")!.textContent!.includes("Online paused"));
  assert.equal(await a.locator("#status").getAttribute("data-frame"), await b.locator("#status").getAttribute("data-frame"));
  assert.equal(await x(a, 0), await x(b, 0)); assert.equal(await x(a, 1), await x(b, 1));
  await a.screenshot({ path: path.join(out, "online-host.png"), fullPage: true });
  await b.screenshot({ path: path.join(out, "online-guest.png"), fullPage: true });
  await b.click("#leave-online");
  await a.waitForFunction(() => document.querySelector("#online-status")!.textContent!.includes("1/2 connected"));
  await b.click("#join-online");
  await b.waitForFunction(() => document.querySelector("#online-status")!.textContent!.includes("Player 2"));
  await a.click("#restart");
  await a.waitForFunction(() => document.querySelector<HTMLElement>("#status")!.dataset.frame === "0");
  await b.waitForFunction(() => document.querySelector<HTMLElement>("#status")!.dataset.frame === "0");
  await b.click("#leave-online"); await a.click("#leave-online");
  const delayed = await open(120);
  await delayed.click("#create-online");
  await delayed.waitForFunction(() => document.querySelector("#online-status")!.textContent!.includes("You are host"));
  await delayed.click("#start"); await waitFrame(delayed, 70);
  await delayed.keyboard.down("ArrowRight");
  await delayed.waitForFunction(() => {
    const hud = document.querySelector<HTMLElement>("#hud1")!;
    return Number(hud.dataset.renderX) > Number(hud.dataset.x) + 4 * 65536;
  });
  await delayed.keyboard.up("ArrowRight"); await delayed.click("#pause");
  await delayed.waitForFunction(() => document.querySelector("#status")!.textContent!.includes("Online paused"));
  assert.equal(await delayed.locator("#hud1").getAttribute("data-x"), await delayed.locator("#hud1").getAttribute("data-render-x"),
    "Paused rendering must return to authoritative state after prediction");
  await delayed.click("#leave-online");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(JSON.stringify({ ok: true, localControls: true, localAndOnlineSpindash: true, localAndOnlineFlight: true,
    onlineSharedWorld: true, delayedNetworkPrediction: true, rejoin: true, restart: true, screenshots: out }, null, 2));
} finally {
  await browser.close();
}
