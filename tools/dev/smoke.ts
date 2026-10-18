// Deployment smoke test: two simulated players create/join a room through the public endpoint and play.
//   tsx tools/dev/smoke.ts http://10.25.0.166:8080 [sonic1|sonic2] [seconds]
import fs from "node:fs";
import path from "node:path";
import { Client, type Room } from "colyseus.js";
import { NetGame } from "../../apps/client/src/net/netgame.js";
import { BTN, nullHost, Vfs, type LobbyState, type StartInfo } from "../../packages/engine/src/index.js";

const [base = "http://localhost:8080", game = "sonic2", secondsArg = "10"] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 30000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(20);
  }
}

async function fetchPak(): Promise<Uint8Array> {
  // download the pak through the web server, exactly like a browser
  const res = await fetch(`${base}/data/${game}/core.pak`);
  if (!res.ok) throw new Error(`data download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const t0 = Date.now();
const health = await fetch(`${base}/api/health`).then((r) => r.json());
console.log("health:", JSON.stringify(health));
const pak = await fetchPak();
console.log(`downloaded ${game} core.pak: ${(pak.length / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
const vfs = () => {
  const v = new Vfs();
  v.addPak(pak);
  return v;
};
void fs;

const ca = new Client(`${base}/api`), cb = new Client(`${base}/api`);
const ra: Room = await ca.create("coop", { name: "Smoke A" });
let lobby: LobbyState | null = null;
ra.onMessage("lobby", (l: LobbyState) => (lobby = l));
await until(() => !!lobby, "lobby");
const code = lobby!.code;
console.log("room code:", code);
const rb: Room = await cb.joinById(code, { name: "Smoke B" });
rb.onMessage("lobby", () => {});
let sa: StartInfo | null = null, sb: StartInfo | null = null;
ra.onMessage("start", (s: StartInfo) => (sa = s));
rb.onMessage("start", (s: StartInfo) => (sb = s));
ra.send("lobby", { setGame: game });
await until(() => lobby!.game === game && lobby!.players.length === 2, "second player");
ra.send("lobby", { setCharacter: 0 });
rb.send("lobby", { setCharacter: 1 });
ra.send("lobby", { ready: true });
rb.send("lobby", { ready: true });
await until(() => lobby!.players.every((p) => p.ready), "ready");
ra.send("lobby", { start: true });
await until(() => !!sa && !!sb, "start");
const ga = new NetGame(ra, vfs(), nullHost, sa!, { headless: true });
const gb = new NetGame(rb, vfs(), nullHost, sb!, { headless: true });
for (const [r, g] of [[ra, ga], [rb, gb]] as const) {
  r.onMessage("snap", (b: Uint8Array) => g.onSnapshot(b));
  r.onMessage("event", (e: unknown) => console.log("event:", JSON.stringify(e)));
  r.onMessage("pong", () => {});
  r.send("loaded");
}
await until(() => ga.started && gb.started, "first snapshot");
const frames = Number(secondsArg) * 60;
for (let f = 0; f < frames; f++) {
  ga.step(f > 150 ? BTN.RIGHT | (f % 120 < 4 ? BTN.C : 0) : 0);
  gb.step(f > 150 ? BTN.RIGHT : 0);
  await wait(1000 / 60);
}
await wait(500);
const A = ga.sim.E.objectEntityList, B = gb.sim.E.objectEntityList;
console.log(`client A sees P1 ${A[0].xpos >> 16},${A[0].ypos >> 16} P2 ${A[1].xpos >> 16},${A[1].ypos >> 16}`);
console.log(`client B sees P1 ${B[0].xpos >> 16},${B[0].ypos >> 16} P2 ${B[1].xpos >> 16},${B[1].ypos >> 16}`);
console.log(`snapshots A ${ga.stats.snapshots} (last ${ga.stats.lastSnapshotBytes} B), B ${gb.stats.snapshots}; resim ticks A ${ga.stats.resimTicks}`);
const agree = Math.abs((A[0].xpos - B[0].xpos) >> 16) < 16 && Math.abs((A[1].xpos - B[1].xpos) >> 16) < 16;
const moved = (A[0].xpos >> 16) > 300;
await ra.leave();
await rb.leave();
console.log(agree && moved ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED");
process.exit(agree && moved ? 0 : 1);
