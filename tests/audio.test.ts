import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rsdkPathKey } from "../packages/engine/src/index.js";
import { AudioHost } from "../apps/client/src/audio.js";

function bufferSource() {
  return {
    buffer: null, loop: false, loopStart: 0, loopEnd: 0,
    connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    onended: null as (() => void) | null,
  };
}

function stereoPanner() {
  return { pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
}

class AudioContextMock {
  state = "running";
  destination = {};
  currentTime = 0;
  sources: ReturnType<typeof bufferSource>[] = [];
  panners: ReturnType<typeof stereoPanner>[] = [];
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn() };
  }
  createBufferSource() {
    const source = bufferSource();
    this.sources.push(source);
    return source;
  }
  createStereoPanner() {
    const panner = stereoPanner();
    this.panners.push(panner);
    return panner;
  }
  decodeAudioData = vi.fn(async () => ({ duration: 1 }));
}

describe("browser sound effects", () => {
  let context: AudioContextMock;
  let host: AudioHost;
  const log = vi.fn();

  beforeEach(() => {
    context = new AudioContextMock();
    vi.stubGlobal("AudioContext", class { constructor() { return context; } });
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(4))));
    log.mockClear();
    host = new AudioHost("soniccd", { [rsdkPathKey("Data/SoundFX/Global/Ring.wav")]: "wav" }, log);
    host.loadSfx(1, "Global/Ring.wav");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts ring sounds through SetSfxAttributes, with the requested stereo pan", async () => {
    host.setSfxAttributes(1, -1, -100);
    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    expect(context.sources[0].start).toHaveBeenCalledOnce();
    expect(context.sources[0].loop).toBe(false);
    expect(context.panners[0].pan.value).toBe(-1);
    expect(context.sources[0].connect).toHaveBeenCalledWith(context.panners[0]);
    host.setSfxAttributes(1, -1, 100);
    await vi.waitFor(() => expect(context.sources).toHaveLength(2));
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.panners[1].pan.value).toBe(1);
  });

  it("preserves looping for -1 and applies an explicit loop change", async () => {
    host.playSfx(1, 1);
    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    host.setSfxAttributes(1, -1, 20);
    await vi.waitFor(() => expect(context.sources).toHaveLength(2));
    expect(context.sources[1].loop).toBe(true);
    host.setSfxAttributes(1, 0, 0);
    await vi.waitFor(() => expect(context.sources).toHaveLength(3));
    expect(context.sources[2].loop).toBe(false);
    context.sources[1].onended?.();
    host.stopSfx(1);
    expect(context.sources[2].stop).toHaveBeenCalledOnce();
  });

  it("cancels pending playback when stopped before decoding finishes", async () => {
    let decoded!: (buffer: { duration: number }) => void;
    context.decodeAudioData.mockImplementation(() => new Promise((resolve) => { decoded = resolve; }));
    host.playSfx(1, 0);
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce());
    host.stopAllSfx();
    decoded({ duration: 1 });
    await Promise.resolve();
    expect(context.sources).toHaveLength(0);
  });

  it("does not let an older asynchronous play override the latest attributes", async () => {
    host.playSfx(1, 1);
    host.setSfxAttributes(1, -1, 500);
    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    expect(context.sources[0].loop).toBe(true);
    expect(context.panners[0].pan.value).toBe(1);
  });

  it("reports missing registrations and audio files rather than silently ignoring them", async () => {
    host.playSfx(99, 0);
    expect(log).toHaveBeenCalledWith("audio: sound effect 99 is not registered");
    host.loadSfx(2, "Global/Missing.wav");
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("audio Data/SoundFX/Global/Missing.wav: missing from audio index"));
  });
});
