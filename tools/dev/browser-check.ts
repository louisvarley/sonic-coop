// Real-browser check: two Chromium windows create and join a lobby, ready up, play, and screenshot their screens.
//   tsx tools/dev/browser-check.ts http://10.25.0.166:8080 sonic2 out/browser
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://localhost:8080", game = "sonic2", outDir = "out/browser"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const cache = path.join(os.homedir(), ".cache/ms-playwright");
const shell = fs.readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop()!;
const executablePath = path.join(cache, shell, "chrome-linux64/chrome");

const browser = await chromium.launch({ executablePath, args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader"] });
const errors: string[] = [];
async function open(name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
  return page;
}

const a = await open("A");
await a.goto(base);
await a.fill("#name", "Alice");
await a.click("button:has-text('Create a lobby')");
await a.waitForSelector(".lobby .code strong");
const code = (await a.textContent(".lobby .code strong"))!.trim();
console.log("lobby code", code);
await a.click(`text=${game === "sonic1" ? "Sonic 1" : "Sonic 2"}`);

const b = await open("B");
await b.goto(`${base}/?room=${code}`);
await b.fill("#name", "Bob");
await b.click("button:has-text('Join')");
await b.waitForSelector(".lobby", { timeout: 10000 }).catch(async (e) => {
  console.log("B status:", await b.textContent(".status").catch(() => "?"), "url", b.url(), errors);
  await b.screenshot({ path: `${outDir}/join-failed.png` });
  throw e;
});
await b.click("button.char-tails");
await a.waitForTimeout(300);
await a.click("button:has-text('Ready')");
await b.click("button:has-text('Ready')");
await a.waitForSelector("button:has-text('Start'):not([disabled])");
await a.screenshot({ path: `${outDir}/lobby.png` });
await a.click("button:has-text('Start')");
await a.waitForSelector(".game-status[hidden]", { timeout: 60000, state: "attached" });
await b.waitForSelector(".game-status[hidden]", { timeout: 60000, state: "attached" });
console.log("both in game");
await a.waitForTimeout(3000);
await a.keyboard.down("ArrowRight");
await b.keyboard.down("ArrowRight");
await a.waitForTimeout(2500);
await b.keyboard.up("ArrowRight");
await b.keyboard.press("KeyZ");
await a.waitForTimeout(1500);
await a.locator(".game-stage").screenshot({ path: `${outDir}/player1.png` });
await b.locator(".game-stage").screenshot({ path: `${outDir}/player2.png` });
await a.keyboard.up("ArrowRight");
// regroup button
await b.click("button:has-text('Regroup')");
await b.waitForTimeout(800);
await b.locator(".game-stage").screenshot({ path: `${outDir}/player2-after-regroup.png` });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
