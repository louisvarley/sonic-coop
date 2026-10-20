// Sonic CD (RSDKv3): determinism, snapshot rollback / late join, and an online game through the real server.
// (Faithfulness to the original engine is checked frame by frame against the decompilation with
// tools/dev/trace-soniccd.ts; these tests cover what the netcode relies on.)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { hasData, loadVfs, root } from "./helpers.js";
import { GameSim3 } from "../packages/engine/src/v3/game.js";
import type { Engine3 } from "../packages/engine/src/v3/engine.js";
import { SoftwareRenderer3 } from "../packages/engine/src/v3/render.js";
import { captureState, stateHash, encodeDelta, applyDelta } from "../packages/engine/src/state.js";
import { NetGame } from "../apps/client/src/net/netgame.js";
import { BTN, nullHost, DEFAULT_SETTINGS, type GameSettings, type LobbyState, type StartInfo } from "../packages/engine/src/index.js";
import { INFINITE_LIVES } from "../packages/engine/src/game.js";

process.env.DATA_DIR = `${root}/data`;

const script = (f: number) => (f < 120 ? 0 : f % 90 < 10 ? BTN.RIGHT | BTN.C : BTN.RIGHT);

function newCD(headless = true, settings: GameSettings = DEFAULT_SETTINGS): GameSim3 {
  const sim = new GameSim3(loadVfs("soniccd"), nullHost, { headless, players: 1 });
  sim.configurePlayers([0], settings);
  return sim;
}

describe.skipIf(!hasData("soniccd"))("Sonic CD", () => {
  it("starts a new game in Palmtree Panic with the title screen's settings", () => {
    const sim = newCD();
    sim.startStage(1, sim.findStage("PALMTREE PANIC ZONE 1 A"));
    sim.tick([0]);
    const startX = sim.E.playerList[0].xpos >> 16;
    for (let f = 1; f < 300; f++) sim.tick([script(f)]);
    expect(sim.E.compiler.errors).toEqual([]);
    expect(sim.E.stageList[1][sim.E.stageListPosition].folder).toBe("R11A");
    expect(sim.global("Player.Lives")).toBe(INFINITE_LIVES); // infinite lives by default
    // the player ran right from the start position
    expect(sim.E.playerList[0].xpos >> 16).toBeGreaterThan(startX + 150);
  });

  for (const peelOut of [true, false]) {
    it(`up + jump ${peelOut ? "charges the super peel out" : "is a plain jump with the peel out turned off"}`, () => {
      const sim = newCD(true, { ...DEFAULT_SETTINGS, peelOut });
      sim.startStage(1, sim.findStage("PALMTREE PANIC ZONE 1 A"));
      for (let f = 0; f < 240; f++) sim.tick([0]);
      for (let f = 0; f < 20; f++) sim.tick([BTN.UP]);
      sim.tick([BTN.UP | BTN.C]);
      const p = sim.E.playerList[0];
      for (let f = 0; f < 5; f++) sim.tick([BTN.UP]);
      expect(p.gravity).toBe(peelOut ? 0 : 1);
      for (let f = 0; f < 35; f++) sim.tick([BTN.UP]);
      for (let f = 0; f < 3; f++) sim.tick([0]);
      // released: the peel out launches Sonic at full speed
      if (peelOut) expect(p.speed).toBeGreaterThan(8 << 16);
      else expect(Math.abs(p.speed)).toBeLessThan(1 << 16);
    });
  }

  it("starting a track restores the music volume a signpost faded out (act 2 has music)", () => {
    const calls: string[] = [];
    const host = { ...nullHost, playMusic: (t: number) => calls.push(`play ${t}`), setMusicVolume: (v: number) => calls.push(`volume ${v}`) };
    const sim = new GameSim3(loadVfs("soniccd"), host, { headless: true, players: 1 });
    sim.configurePlayers([0]);
    sim.startStage(1, sim.findStage("PALMTREE PANIC ZONE 1 A"));
    for (let f = 0; f < 10; f++) sim.tick([0]);
    sim.E.masterVolume = 0; // what the goal signpost's fade leaves behind
    calls.length = 0;
    sim.startStage(1, sim.findStage("PALMTREE PANIC ZONE 2 A"));
    for (let f = 0; f < 200; f++) sim.tick([0]);
    expect(calls).toContain("play 0");
    expect(sim.E.masterVolume).toBe(100);
    expect(calls.lastIndexOf("volume 100")).toBeGreaterThanOrEqual(0);
  });

  it("two runs with the same inputs produce identical states", () => {
    const a = newCD(), b = newCD();
    a.startStage(1, 0);
    b.startStage(1, 0);
    for (let f = 0; f < 600; f++) {
      a.tick([script(f)]);
      b.tick([script(f)]);
    }
    expect(stateHash(captureState(a.E))).toBe(stateHash(captureState(b.E)));
  });

  it("rendering does not change the simulation", () => {
    const a = newCD(), b = newCD(false);
    b.E.draw = new SoftwareRenderer3(424);
    a.startStage(1, 0);
    b.startStage(1, 0);
    for (let f = 0; f < 400; f++) {
      a.tick([script(f)]);
      b.tick([script(f)]);
    }
    expect(stateHash(captureState(b.E))).toBe(stateHash(captureState(a.E)));
  });

  it("a fresh engine joins from a snapshot (loading the stage) and continues identically", () => {
    const a = newCD();
    a.startStage(1, 0);
    for (let f = 0; f < 300; f++) a.tick([script(f)]);
    const b = newCD();
    expect(b.applyState(captureState(a.E))).toBe(true);
    for (let f = 300; f < 700; f++) {
      a.tick([script(f)]);
      b.tick([script(f)]);
    }
    expect(stateHash(captureState(b.E))).toBe(stateHash(captureState(a.E)));
  });

  it("follows the server into another stage through snapshots", () => {
    const a = newCD(), b = newCD();
    a.startStage(1, 0);
    b.startStage(1, 0);
    for (let f = 0; f < 100; f++) {
      a.tick([script(f)]);
      b.tick([script(f)]);
    }
    // the server moves on to the special stage; the client only sees its snapshot
    a.startStage(3, 0);
    for (let f = 0; f < 120; f++) a.tick([0]);
    expect(b.applyState(captureState(a.E))).toBe(true);
    for (let f = 0; f < 200; f++) {
      a.tick([f % 30 < 5 ? BTN.C : BTN.UP]);
      b.tick([f % 30 < 5 ? BTN.C : BTN.UP]);
    }
    expect(stateHash(captureState(b.E))).toBe(stateHash(captureState(a.E)));
  });

  it("deltas reconstruct the state exactly", () => {
    const a = newCD();
    a.startStage(1, 0);
    for (let f = 0; f < 200; f++) a.tick([script(f)]);
    const base = captureState(a.E);
    for (let f = 200; f < 260; f++) a.tick([script(f)]);
    const next = captureState(a.E);
    const rebuilt = base.slice();
    applyDelta(rebuilt, encodeDelta(base, next));
    expect(rebuilt).toEqual(next);
  });

  const newCD2 = (chars: number[]) => {
    const sim = new GameSim3(loadVfs("soniccd"), nullHost, { headless: true, players: 2 });
    sim.configurePlayers(chars);
    sim.startStage(1, 0);
    return sim;
  };

  for (const [name, chars] of [["Sonic and Tails", [0, 1]], ["Tails and Sonic", [1, 0]]] as const) {
    it(`two players (${name}) are driven by their own pads`, () => {
      const sim = newCD2([...chars]);
      for (let f = 0; f < 60; f++) sim.tick([0, 0]);
      expect(sim.E.compiler.errors).toEqual([]);
      const [x0, x1] = [sim.E.playerList[0].xpos, sim.E.playerList[1].xpos];
      for (let f = 0; f < 200; f++) sim.tick([BTN.RIGHT, 0]);
      expect(sim.E.playerList[0].xpos).toBeGreaterThan(x0 + (100 << 16));
      expect(sim.E.playerList[1].xpos).toBe(x1);
      for (let f = 0; f < 200; f++) sim.tick([0, BTN.RIGHT]);
      expect(sim.E.playerList[1].xpos).toBeGreaterThan(x1 + (100 << 16));
      expect(Array.from(sim.E.playerChars.slice(0, 2))).toEqual(chars.map((c) => c));
      expect(sim.E.playerList[0].animationFile).not.toBe(sim.E.playerList[1].animationFile);
      expect(sim.E.typeNames[sim.E.objectEntityList[sim.E.playerList[1].boundEntity].type]).toBe("PlayerObject");
      expect(sim.E.playerList[1].visible).toBe(1);
      sim.E.setCamera(0);
      const player1CameraX = sim.E.xScrollOffset;
      sim.E.setCamera(1);
      expect(sim.E.cameraTarget).toBe(1);
      expect(sim.E.xScrollOffset).toBeGreaterThan(player1CameraX);
      sim.E.setCamera(0);
    });
  }

  it("regroups the player furthest behind with the leader, camera included", () => {
    const sim = newCD2([0, 1]);
    const E = sim.E;
    for (let f = 0; f < 60; f++) sim.tick([0, 0]);
    expect(sim.emergencyTeleport()).toEqual({ reason: "Everyone is already together" });
    for (let f = 0; f < 400; f++) sim.tick([BTN.RIGHT, 0]);
    expect(sim.emergencyTeleport()).toEqual({ from: [1], to: 0 });
    const [p1, p2] = [E.playerList[0], E.playerList[1]];
    expect(p2.xpos).toBe(p1.xpos);
    expect(Math.abs((p1.ypos - p2.ypos) >> 16)).toBeLessThan(32);
    for (let f = 0; f < 10; f++) sim.tick([0, 0]);
    E.setCamera(1);
    expect(Math.abs(E.xScrollOffset + E.SCREEN_CENTERX - (p2.xpos >> 16))).toBeLessThan(32);
    E.setCamera(0);
  });

  it("the boss arena's boundaries hold every player's camera, and a player outside it is brought in", () => {
    const sim = newCD2([0, 1]);
    const E = sim.E;
    sim.startStage(1, sim.findStage("PALMTREE PANIC ZONE 3 C"));
    for (let f = 0; f < 200; f++) sim.tick([0, 0]);
    const boss = E.objectEntityList.find((e) => e.type && E.bossType[e.type] === 1)!;
    expect(E.typeNames[boss.type]).toBe("BossFace");
    const put = (p: number, x: number, y: number) => {
      const plr = E.playerList[p];
      plr.xpos = x << 16;
      plr.ypos = y << 16;
      plr.xvel = plr.yvel = plr.speed = 0;
    };
    // player 2 waits far past the boss; player 1 walks in and starts it
    put(1, (boss.xpos >> 16) + 1200, (boss.ypos >> 16) - 32);
    put(0, (boss.xpos >> 16) - 3000, (boss.ypos >> 16) - 32);
    for (let f = 0; f < 120; f++) sim.tick([0, 0]);
    put(0, (boss.xpos >> 16) - 500, (boss.ypos >> 16) - 32);
    let captured = false;
    for (let f = 0; f < 600 && !captured; f++) captured = sim.tick([BTN.RIGHT, BTN.RIGHT]).some((e) => e.type === "arena");
    expect(captured).toBe(true);
    for (let f = 0; f < 600; f++) {
      sim.tick([BTN.RIGHT, BTN.RIGHT | (f % 40 < 3 ? BTN.C : 0)]);
      const x = E.playerList[1].xpos >> 16;
      expect(x).toBeGreaterThanOrEqual(E.arenaX1 - 64);
      expect(x).toBeLessThanOrEqual(E.arenaX2 + 64);
    }
    for (let c = 0; c < 2; c++) {
      E.setCamera(c);
      expect([E.newXBoundary1, E.newXBoundary2]).toEqual([E.arenaX1, E.arenaX2]);
    }
    E.setCamera(0);
  });

  it("draws player 2's character in player 2's view", () => {
    const sim = new GameSim3(loadVfs("soniccd"), nullHost, { headless: false, players: 2 });
    sim.configurePlayers([0, 1]);
    sim.startStage(1, 0);
    const renderer = new SoftwareRenderer3(424);
    const playerDraws: { slot: number; x: number; y: number }[] = [];
    const drawAnimation = renderer.DrawObjectAnimation.bind(renderer);
    renderer.DrawObjectAnimation = (E, script, entity, x, y) => {
      if (entity.slot === 5) playerDraws.push({ slot: entity.slot, x, y });
      drawAnimation(E, script, entity, x, y);
    };
    sim.E.draw = renderer;
    sim.viewCamera = 1;
    for (let f = 0; f < 260; f++) sim.tick([0, f < 60 ? 0 : BTN.RIGHT]);
    const player2 = sim.E.playerList[1];
    expect(sim.E.typeNames[sim.E.objectEntityList[player2.boundEntity].type]).toBe("PlayerObject");
    expect(playerDraws.length).toBeGreaterThan(0);
    expect(playerDraws[playerDraws.length - 1]).toMatchObject({ slot: 5, x: player2.screenXPos, y: player2.screenYPos });
  });

  for (const view of [0, 1]) {
    it(`draws both characters with their own animations in view ${view}`, () => {
      const sim = new GameSim3(loadVfs("soniccd"), nullHost, { headless: false, players: 2 });
      sim.configurePlayers([0, 1]);
      sim.startStage(1, 0);
      sim.viewCamera = view;
      const renderer = new SoftwareRenderer3(424);
      const draws = new Set<number>();
      const drawAnimation = renderer.DrawObjectAnimation.bind(renderer);
      renderer.DrawObjectAnimation = (E, info, entity, x, y) => {
        if (entity.slot === 0 || entity.slot === 5) {
          const slot = entity.slot === 0 ? 0 : 1;
          expect(E.activePlayer).toBe(slot);
          expect(info.animFile.fileName).toBe(slot === 0 ? "Sonic.Ani" : "Tails.Ani");
          expect(info.animFile.index).toBe(E.playerList[slot].animationFile);
          const animation = E.animationList[info.animFile.aniListOffset + entity.animation];
          const frame = E.animFrames[animation.frameListOffset + entity.frame];
          expect(E.gfxSurface[frame.sheetID].fileName).toContain(slot === 0 ? "Sonic" : "Tails");
          draws.add(slot);
        }
        drawAnimation(E, info, entity, x, y);
      };
      sim.E.draw = renderer;
      const server = newCD2([0, 1]);
      for (let f = 0; f < 90; f++) server.tick([0, 0]);
      sim.applyState(captureState(server.E));
      for (let f = 0; f < 150; f++) sim.tick([0, f < 60 ? 0 : BTN.RIGHT]);
      expect(draws).toEqual(new Set([0, 1]));
    });

    it(`draws the viewing character's HUD in view ${view}`, () => {
      const sim = new GameSim3(loadVfs("soniccd"), nullHost, { headless: false, players: 2 });
      sim.configurePlayers([0, 1]);
      sim.startStage(1, 0);
      sim.viewCamera = view;
      const renderer = new SoftwareRenderer3(424);
      const sheets = new Set<string>();
      const drawSprite = renderer.DrawSprite.bind(renderer);
      renderer.DrawSprite = (E, x, y, w, h, sx, sy, sheet) => {
        if (E.typeNames[E.objectEntityList[E.objectLoop].type] === "HUD") sheets.add(E.gfxSurface[sheet].fileName);
        drawSprite(E, x, y, w, h, sx, sy, sheet);
      };
      sim.E.draw = renderer;
      for (let f = 0; f < 100; f++) sim.tick([0, 0]);
      expect(sim.E.compiler.errors).toEqual([]);
      expect(sheets).toEqual(new Set([view === 0 ? "Data/Sprites/Global/Display.gif" : "Data/Sprites/Global/Display_t.gif"]));
    });
  }

  for (const slot of [0, 1]) {
    for (const death of ["Death", "Drown"]) {
      for (const checkpoint of [false, true]) {
        it(`respawns player ${slot + 1} after ${death} at ${checkpoint ? "the checkpoint" : "the start"} with a working camera`, () => {
          const sim = newCD2([0, 1]);
          for (let f = 0; f < 100; f++) sim.tick([0, 0]);
          const E = sim.E;
          const player = E.playerList[slot], entity = E.boundEntity(player);
          let x = entity.xpos, y = entity.ypos;
          if (checkpoint) {
            const post = E.objectEntityList.find((e) => E.typeNames[e.type] === "LampPost");
            expect(post).toBeDefined();
            sim.setGlobal("LampPost.Check", post!.slot);
            sim.setGlobal("LampPost.Side", 0x180000);
            x = post!.xpos + 0x180000;
            y = post!.ypos;
          }
          entity.state = E.scriptFunctionList.findIndex((fn) => fn.name === `Player_State_${death}`);
          player.tileCollisions = 0;
          player.objectInteractions = 0;
          player.yvel = 0x110000;
          player.ypos = 4000 << 16;
          E.setCamera(slot);
          E.yScrollOffset = E.yScrollA = 3800;
          E.yScrollB = 4040;
          E.setCamera(0);
          sim.tick([0, 0]);
          expect(player.xpos).toBe(x);
          expect(Math.abs(player.ypos - y)).toBeLessThan(2 << 16);
          expect(E.typeNames[entity.type]).toBe("PlayerObject");
          expect(player.controlMode).toBe(0);
          expect(player.tileCollisions).toBe(1);
          E.setCamera(slot);
          expect((player.ypos >> 16) - E.yScrollOffset).toBeGreaterThan(0);
          expect((player.ypos >> 16) - E.yScrollOffset).toBeLessThan(240);
          E.setCamera(0);
          const respawnX = player.xpos;
          for (let f = 0; f < 40; f++) sim.tick(slot === 0 ? [BTN.RIGHT, 0] : [0, BTN.RIGHT]);
          expect(player.xpos).toBeGreaterThan(respawnX + (10 << 16));
        });
      }
    }
  }

  it("two players are deterministic and rejoin from a snapshot", () => {
    const a = newCD2([0, 1]);
    const pad = (f: number) => [script(f), f % 120 < 60 ? BTN.RIGHT : BTN.LEFT];
    for (let f = 0; f < 300; f++) a.tick(pad(f));
    const b = new GameSim3(loadVfs("soniccd"), nullHost, { headless: true, players: 2 });
    b.configurePlayers([0, 1]);
    expect(b.applyState(captureState(a.E))).toBe(true);
    for (let f = 300; f < 600; f++) {
      a.tick(pad(f));
      b.tick(pad(f));
    }
    expect(stateHash(captureState(b.E))).toBe(stateHash(captureState(a.E)));
  });

  it("respawns both players even when neither partner is alive", () => {
    const sim = newCD2([0, 1]);
    for (let f = 0; f < 100; f++) sim.tick([0, 0]);
    const death = sim.E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_Death");
    for (const player of sim.E.playerList.slice(0, 2)) {
      sim.E.boundEntity(player).state = death;
      player.yvel = 0x110000;
      player.tileCollisions = 0;
      player.objectInteractions = 0;
    }
    sim.tick([0, 0]);
    for (const player of sim.E.playerList.slice(0, 2)) {
      expect(sim.E.boundEntity(player).state).not.toBe(death);
      expect(player.controlMode).toBe(0);
      expect(player.tileCollisions).toBe(1);
    }
    const rejoined = newCD2([0, 1]);
    rejoined.applyState(captureState(sim.E));
    for (let f = 0; f < 60; f++) {
      sim.tick([BTN.RIGHT, BTN.RIGHT]);
      rejoined.tick([BTN.RIGHT, BTN.RIGHT]);
    }
    expect(stateHash(captureState(rejoined.E))).toBe(stateHash(captureState(sim.E)));
  });

  it("preserves the original single-player death and life deduction with classic lives", () => {
    const sim = newCD(true, { ...DEFAULT_SETTINGS, infiniteLives: false });
    sim.startStage(1, 0);
    for (let f = 0; f < 100; f++) sim.tick([0]);
    const player = sim.E.playerList[0];
    sim.E.boundEntity(player).state = sim.E.scriptFunctionList.findIndex((fn) => fn.name === "Player_State_Death");
    player.yvel = 0x110000;
    player.tileCollisions = 0;
    sim.tick([0]);
    expect(sim.E.typeNames[sim.E.boundEntity(player).type]).toBe("DeathEvent");
    expect(sim.global("Player.Lives")).toBe(2);
  });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 20000): Promise<void> {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await wait(10);
  }
}

describe.skipIf(!hasData("soniccd"))("Sonic CD online", () => {
  let server: Server;
  let endpoint = "";

  beforeAll(async () => {
    const { CoopRoom } = await import("../apps/server/src/room.js");
    const httpServer = http.createServer();
    server = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
    server.define("coop", CoopRoom);
    await server.listen(0);
    endpoint = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it("player 1 and player 2 both play in the same world", async () => {
    const roomA: Room = await new Client(endpoint).create("coop", { name: "Host" });
    let lobby: LobbyState | null = null;
    roomA.onMessage("lobby", (l: LobbyState) => (lobby = l));
    await until(() => !!lobby);
    const roomB: Room = await new Client(endpoint).joinById(lobby!.code, { name: "Guest" });
    roomB.onMessage("lobby", () => {});
    roomA.send("lobby", { setGame: "soniccd" });
    await until(() => lobby!.game === "soniccd" && lobby!.players.length === 2);
    roomA.send("lobby", { setCharacter: 1 });
    let startA: StartInfo | null = null, startB: StartInfo | null = null;
    roomA.onMessage("start", (s: StartInfo) => (startA = s));
    roomB.onMessage("start", (s: StartInfo) => (startB = s));
    roomA.send("lobby", { ready: true });
    roomB.send("lobby", { ready: true });
    await until(() => lobby!.players.every((p) => p.ready));
    roomA.send("lobby", { start: true });
    await until(() => !!startA && !!startB);
    expect(startA!.characters[0]).toBe(1);

    const soundsA: [number, number][] = [], soundsB: [number, number][] = [];
    const gameA = new NetGame(roomA, loadVfs("soniccd"), {
      ...nullHost, playSfx: (id) => {
        if (!(gameA.sim instanceof GameSim3)) throw new Error("expected Sonic CD");
        soundsA.push([id, gameA.sim.E.activePlayer]);
      },
    }, startA!, { headless: true });
    const gameB = new NetGame(roomB, loadVfs("soniccd"), {
      ...nullHost, playSfx: (id) => {
        if (!(gameB.sim instanceof GameSim3)) throw new Error("expected Sonic CD");
        soundsB.push([id, gameB.sim.E.activePlayer]);
      },
    }, startB!, { headless: false });
    expect(gameB.sim.viewCamera).toBe(1);
    const simB = gameB.sim;
    if (!(simB instanceof GameSim3)) throw new Error("Sonic CD did not create an RSDKv3 game");
    const rendererB = new SoftwareRenderer3(424);
    let player2Draws = 0;
    const drawAnimation = rendererB.DrawObjectAnimation.bind(rendererB);
    rendererB.DrawObjectAnimation = (E, scriptInfo, entity, x, y) => {
      if (entity.slot === simB.E.playerList[1].boundEntity) player2Draws++;
      drawAnimation(E, scriptInfo, entity, x, y);
    };
    simB.E.draw = rendererB;
    for (const [room, game] of [[roomA, gameA], [roomB, gameB]] as const) {
      room.onMessage("snap", (bytes: Uint8Array) => game.onSnapshot(bytes));
      room.onMessage("event", () => {});
      room.send("loaded");
    }
    await until(() => gameA.started && gameB.started);

    for (let f = 0; f < 360; f++) {
      gameA.step(script(f));
      gameB.step(f < 120 ? 0 : f === 300 ? BTN.RIGHT | BTN.C : BTN.RIGHT);
      await wait(1000 / 60);
    }
    for (let f = 0; f < 30; f++) {
      gameA.step(0);
      gameB.step(0);
      await wait(1000 / 60);
    }
    await wait(300);

    expect(gameA.sim.E.playerListPos).toBe(gameA.sim.global("PLAYER_TAILS"));
    expect(soundsA).toContainEqual([0, 0]);
    expect(soundsB).toContainEqual([0, 1]);
    const Ea = gameA.sim.E as Engine3, Eb = gameB.sim.E as Engine3;
    expect(Eb.typeNames[Eb.objectEntityList[Eb.playerList[1].boundEntity].type]).toBe("PlayerObject");
    expect(player2Draws).toBeGreaterThan(0);
    expect(Array.from(Ea.playerChars.slice(0, 2))).toEqual(startA!.characters.map((c) => (gameA.sim as GameSim3).playerListPosOf(c)));
    for (const p of [0, 1]) {
      const xa = Ea.playerList[p].xpos >> 16, xb = Eb.playerList[p].xpos >> 16;
      expect(xa).toBeGreaterThan(100);
      expect(Math.abs(xa - xb)).toBeLessThan(8);
    }
    for (const E of [Ea, Eb]) {
      for (const c of [0, 1]) {
        E.setCamera(c);
        const sx = (E.playerList[c].xpos >> 16) - E.xScrollOffset, sy = (E.playerList[c].ypos >> 16) - E.yScrollOffset;
        expect(sx).toBeGreaterThan(0);
        expect(sx).toBeLessThan(424);
        expect(sy).toBeGreaterThan(0);
        expect(sy).toBeLessThan(240);
      }
      E.setCamera(0);
      const player1CameraX = E.xScrollOffset;
      E.setCamera(1);
      expect(E.cameraTarget).toBe(1);
      expect(E.xScrollOffset).not.toBe(player1CameraX);
      E.setCamera(0);
    }
    await roomB.leave();
    await roomA.leave();
  });
});
