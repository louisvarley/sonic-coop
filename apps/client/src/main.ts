// Sonic Coop: the browser app (home, lobby, game).

import { Client, type Room } from "colyseus.js";
import { CHARACTERS, isCharacterAvailable, type LobbyState, type StartInfo, type GameId } from "@ringlink/engine";
import { GameRunner } from "./game/runner.js";
import { Sonic3Runner } from "./game/sonic3-runner.js";
import { Input } from "./input.js";
import "@fontsource/press-start-2p/latin-400.css";
import "./style.css";

const API = `${location.origin}/api`;
const client = new Client(API);
const input = new Input();
const app = document.getElementById("app")!;

let room: Room | null = null;
let lobby: LobbyState | null = null;
let runner: GameRunner | Sonic3Runner | null = null;
let reconnectToken = "";
let leaving = false;

const GAME_NAMES: Record<GameId, string> = { sonic1: "Sonic the Hedgehog", sonic2: "Sonic the Hedgehog 2", sonic3: "Sonic the Hedgehog 3 (experimental)", soniccd: "Sonic the Hedgehog CD" };
const GAME_SHORT: Record<GameId, string> = { sonic1: "Sonic 1", sonic2: "Sonic 2", sonic3: "Sonic 3", soniccd: "Sonic CD" };

// Sprite art comes from PNGs that `npm run extract:ui` dumps out of the user's own game data; absent files just hide the art.
function spr(game: "sonic1" | "sonic2", x: number, y: number, w: number, h: number, s: number): HTMLElement {
  const e = document.createElement("span");
  e.className = "spr";
  e.style.cssText = `background-image:url(/data/ui/${game}/Title/Title.png);background-size:${512 * s}px ${512 * s}px;` +
    `background-position:-${x * s}px -${y * s}px;width:${w * s}px;height:${h * s}px`;
  return e;
}
const HEADS: Record<string, () => HTMLElement> = {
  sonic: () => spr("sonic1", 2, 2, 66, 82, 0.9),
  tails: () => spr("sonic1", 200, 150, 50, 56, 1.2),
  knuckles: () => spr("sonic1", 410, 425, 102, 87, 0.9),
};
const probe = new Image();
probe.onload = () => document.documentElement.classList.add("has-sprites");
probe.src = "/data/ui/sonic1/Title/Title.png";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function toast(msg: string, kind: "info" | "error" = "info"): void {
  const t = el("div", { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 400);
  }, 3500);
}

function playerName(): string {
  try {
    return localStorage.getItem("ringlink.name") ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem("ringlink.name", name);
  } catch {
    /* ignore */
  }
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/not found|no room|invalid|ERR_MATCHMAKE_INVALID_ROOM_ID/i.test(m)) return "There is no room with that code.";
  if (/full|locked/i.test(m)) return "That room is full.";
  if (/in progress/i.test(m)) return "That room's game has already started.";
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(m)) return "Could not reach the game server.";
  return m;
}

// ---- home ----------------------------------------------------------------------------------------------------------

function showHome(message?: string): void {
  runner?.stop();
  runner = null;
  room = null;
  lobby = null;
  const invite = new URLSearchParams(location.search).get("room") ?? "";
  history.replaceState(null, "", location.pathname + (invite && !message ? `?room=${invite}` : ""));
  const nameInput = el("input", { id: "name", maxlength: "16", placeholder: "Your name", autocomplete: "nickname" });
  nameInput.value = playerName();
  const codeInput = el("input", { id: "code", placeholder: "CODE", autocomplete: "off", spellcheck: "false" });
  codeInput.value = invite.toUpperCase();
  // Accepts a bare code or a pasted invite link
  const cleanCode = (text: string) => {
    const fromLink = /[?&]room=([A-Za-z]+)/.exec(text);
    return (fromLink ? fromLink[1] : text).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  };
  codeInput.addEventListener("input", () => (codeInput.value = cleanCode(codeInput.value)));
  const createBtn = el("button", { class: "primary" }, "Create a lobby");
  const joinBtn = el("button", {}, "Join");
  const status = el("p", { class: "status" }, message ?? "");

  const busy = (b: boolean) => {
    createBtn.disabled = joinBtn.disabled = b;
  };
  createBtn.onclick = async () => {
    busy(true);
    status.textContent = "Creating a lobby…";
    saveName(nameInput.value.trim());
    try {
      enterRoom(await client.create("coop", { name: nameInput.value.trim() }));
    } catch (e) {
      status.textContent = errorText(e);
      busy(false);
    }
  };
  const join = async () => {
    const code = cleanCode(codeInput.value);
    if (code.length !== 4) {
      status.textContent = "Room codes have four letters.";
      return;
    }
    busy(true);
    status.textContent = "Joining…";
    saveName(nameInput.value.trim());
    try {
      const info = await fetch(`${API}/rooms/${code}`);
      if (info.status === 404) throw new Error("not found");
      const r = info.ok ? ((await info.json()) as { clients: number; maxClients: number }) : null;
      if (r && r.clients >= r.maxClients) throw new Error("full");
      enterRoom(await client.joinById(code, { name: nameInput.value.trim() }));
    } catch (e) {
      status.textContent = errorText(e);
      busy(false);
    }
  };
  joinBtn.onclick = join;
  codeInput.addEventListener("keydown", (e) => e.key === "Enter" && join());

  app.replaceChildren(
    el(
      "main",
      { class: "home" },
      el("h1", { class: "logo" }, el("span", { class: "ring" }), spr("sonic1", 258, 93, 224, 136, 0.75), "Sonic Coop"),
      el("p", { class: "tagline" }, "Sonic 1, 2 and 3, together online."),
      el("label", { class: "field" }, el("span", {}, "Name"), nameInput),
      el("div", { class: "card" }, el("h2", {}, "Host"), el("p", {}, "Start a lobby and send the invite link to a friend."), createBtn),
      el("div", { class: "card" }, el("h2", {}, "Join"), el("div", { class: "row" }, codeInput, joinBtn)),
      status,
      el("footer", {}, "Uses your own Sonic game data. Fan project, not affiliated with SEGA."),
    ),
  );
  (invite ? codeInput : nameInput).focus();
}

// ---- lobby -------------------------------------------------------------------------------------------------------

function enterRoom(r: Room): void {
  room = r;
  reconnectToken = r.reconnectionToken;
  leaving = false;
  r.onMessage("lobby", (l: LobbyState) => {
    lobby = l;
    history.replaceState(null, "", `?room=${l.code}`);
    if (!runner) renderLobby();
  });
  r.onMessage("start", (info: StartInfo) => startGame(info));
  r.onMessage("notice", (m: string) => toast(m));
  r.onMessage("end", (m: { message: string }) => {
    runner?.stop();
    runner = null;
    toast(m.message);
    renderLobby();
  });
  r.onMessage("event", () => {});
  r.onMessage("snap", () => {});
  r.onMessage("world", () => {});
  r.onMessage("pong", () => {});
  r.onError((code, message) => toast(`Server error ${code}: ${message}`, "error"));
  r.onLeave((code) => {
    if (leaving) return;
    if (code === 1000) {
      showHome("You left the room.");
      return;
    }
    void tryReconnect();
  });
  app.replaceChildren(el("main", { class: "lobby" }, el("p", { class: "status" }, "Connecting…")));
}

async function tryReconnect(): Promise<void> {
  toast("Connection lost, reconnecting…", "error");
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    try {
      const r = await client.reconnect(reconnectToken);
      runner?.stop();
      runner = null;
      enterRoom(r);
      toast("Reconnected");
      return;
    } catch {
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  showHome("The connection to the room was lost.");
}

function renderLobby(): void {
  if (!room || !lobby) return;
  const l = lobby;
  const me = l.players.find((p) => p.id === room!.sessionId);
  const isHost = l.hostId === room.sessionId;
  const invite = `${location.origin}${location.pathname}?room=${l.code}`;

  const copyBtn = el("button", {}, "Copy invite link");
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      toast("Invite link copied");
    } catch {
      prompt("Copy this link:", invite);
    }
  };

  const games = el("div", { class: "choices" });
  const listed: GameId[] = ["sonic1", "sonic2"];
  if (l.games?.includes("soniccd") || l.game === "soniccd") listed.push("soniccd");
  if (l.games?.includes("sonic3") || l.game === "sonic3") listed.push("sonic3");
  for (const g of listed) {
    const art = g === "sonic1" ? spr("sonic1", 258, 93, 224, 136, 0.5) : g === "sonic2" ? spr("sonic2", 258, 70, 240, 155, 0.45) : null;
    const b = el("button", { class: `choice${l.game === g ? " selected" : ""}` }, ...(art ? [art] : []), el("strong", {}, GAME_SHORT[g]), el("small", {}, GAME_NAMES[g]));
    b.disabled = !isHost || l.phase !== "lobby";
    b.onclick = () => room!.send("lobby", { setGame: g });
    games.append(b);
  }

  const chars = el("div", { class: "choices" });
  for (const c of CHARACTERS.filter((character) => isCharacterAvailable(l.game, character.id))) {
    const b = el("button", { class: `choice char-${c.name.toLowerCase()}${me?.character === c.id ? " selected" : ""}` }, ...(HEADS[c.name.toLowerCase()] ? [HEADS[c.name.toLowerCase()]()] : []), el("strong", {}, c.name));
    b.disabled = l.game === "sonic3";
    b.onclick = () => room!.send("lobby", { setCharacter: c.id });
    chars.append(b);
  }

  const list = el("ul", { class: "players" });
  for (let s = 0; s < l.maxPlayers; s++) {
    const p = l.players.find((x) => x.slot === s);
    list.append(
      p
        ? el(
            "li",
            { class: p.ready ? "ready" : "" },
            el("span", { class: "slot" }, `P${s + 1}`),
            el("span", { class: "name" }, p.name + (p.id === l.hostId ? " ★" : "") + (p.id === room.sessionId ? " (you)" : "")),
            el("span", { class: "char" }, CHARACTERS.find((character) => character.id === p.character)?.name ?? "?"),
            el("span", { class: "state" }, !p.connected ? "reconnecting…" : p.ready ? "Ready" : "Not ready"),
          )
        : el("li", { class: "empty" }, el("span", { class: "slot" }, `P${s + 1}`), el("span", { class: "name" }, "Waiting for a player…")),
    );
  }

  const readyBtn = el("button", { class: me?.ready ? "" : "primary" }, me?.ready ? "Not ready" : "Ready");
  readyBtn.onclick = () => room!.send("lobby", { ready: !me?.ready });
  const allReady = l.players.length > 0 && l.players.every((p) => p.ready);
  const startBtn = el("button", { class: "primary" }, l.players.length < 2 ? "Start (solo)" : "Start");
  startBtn.disabled = !isHost || !allReady;
  startBtn.onclick = () => room!.send("lobby", { start: true });
  const leaveBtn = el("button", { class: "danger" }, "Leave");
  leaveBtn.onclick = () => {
    leaving = true;
    void room?.leave(true);
    showHome();
  };

  const stages = l.stages ?? [];
  const current = stages[Math.min(l.startStage, stages.length - 1)];
  const stageLabel = (s: { level: string; act: string }) => `${s.level} - ${s.act}`;
  const stageSection: HTMLElement[] = [];
  if (stages.length) {
    const stage = el("select", {}, ...stages.map((s, i) => el("option", { value: String(i) }, stageLabel(s))));
    stage.value = String(Math.max(0, stages.indexOf(current)));
    stage.onchange = () => room!.send("lobby", { setStartStage: Number(stage.value) });
    stage.disabled = !isHost;
    stageSection.push(el("section", {}, el("h2", {}, "Level"), isHost || !current ? stage : el("p", {}, stageLabel(current))));
  }
  const extras: HTMLElement[] = [];

  app.replaceChildren(
    el(
      "main",
      { class: "lobby" },
      el("header", {}, el("h1", { class: "logo small" }, el("span", { class: "ring" }), "Sonic Coop"), el("div", { class: "code" }, el("small", {}, "Room code"), el("strong", {}, l.code)), copyBtn),
      l.message ? el("p", { class: "notice" }, l.message) : "",
      el("section", {}, el("h2", {}, "Game"), games),
      ...stageSection,
      el("section", {}, el("h2", {}, "Your character"), chars, l.game === "sonic3"
        ? el("p", { class: "hint" }, "Sonic 3 is experimental: player 1 is Sonic and player 2 is Tails.")
        : l.game === "soniccd"
          ? el("p", { class: "hint" }, "Sonic CD is single-player: player 1 plays and everyone else watches.")
          : ""),
      el("section", {}, el("h2", {}, "Players"), list),
      ...extras,
      el("div", { class: "row actions" }, readyBtn, startBtn, leaveBtn),
      el("p", { class: "hint" }, isHost ? (allReady ? "Everyone is ready." : "Start when everyone is ready.") : "The host starts the game when everyone is ready."),
      el("details", { class: "controls" }, el("summary", {}, "Controls"), el("p", {}, "Move: arrow keys or WASD · Jump: Z / X / C / Space · Regroup (warp the player furthest behind to the leader): T · Fullscreen: F11 · Gamepads work too (A/B/X jump, Y regroup).")),
    ),
  );
}

// ---- game ----------------------------------------------------------------------------------------------------------

function startGame(info: StartInfo): void {
  if (!room) return;
  runner?.stop();
  const root = el("main", { class: "game" });
  app.replaceChildren(root);
  const ui = {
    root,
    toast,
    onExit: () => {
      leaving = true;
      runner?.stop();
      runner = null;
      void room?.leave(true);
      showHome();
    },
  };
  runner = info.game === "sonic3" ? new Sonic3Runner(room, info, () => lobby!, input, ui) : new GameRunner(room, info, () => lobby!, input, ui);
  runner.start().catch((e) => {
    toast(errorText(e), "error");
    runner?.stop();
    runner = null;
    renderLobby();
  });
}

showHome();
