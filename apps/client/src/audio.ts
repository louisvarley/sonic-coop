// Browser audio for the engine: music tracks and sound effects from the game's own files, decoded with Web Audio.
// Files are fetched lazily by their RSDK path key; nothing here affects the simulation.

import { rsdkPathKey, type ScriptHost } from "@ringlink/engine";

interface Track {
  path: string;
  loop: boolean;
  loopPoint: number;
}

const MUSIC_RATE = 44100;

export class AudioHost implements ScriptHost {
  readonly ctx: AudioContext;
  private master: GainNode;
  private musicGain: GainNode;
  private musicPauseGain: GainNode;
  private sfxGain: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private tracks: Track[] = [];
  private sfxPaths: string[] = [];
  private music: { source: AudioBufferSourceNode; started: number; offset: number; track: number; buffer: AudioBuffer } | null = null;
  private requestedMusicTrack: number | null = null;
  private musicToken = 0;
  private playingSfx = new Map<number, { source: AudioBufferSourceNode; panner: StereoPannerNode }>();
  private sfxRequests = new Map<number, { loop: boolean; pan: number }>();
  private settings = { music: 0.7, sfx: 0.8, muted: false };
  private scriptMusicVolume = 1;

  constructor(
    private game: string,
    private audioIndex: Record<string, string>,
    private onLog: (m: string) => void = () => {},
    /** Loop points that come with the audio itself (Sonic Origins); they replace the scripts' loop points. */
    private audioLoops: Record<string, [number, number]> = {},
  ) {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.musicPauseGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.musicPauseGain);
    this.musicPauseGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem("ringlink.audio") ?? "{}"));
    } catch {
      /* private mode */
    }
    this.applyVolumes();
  }

  get volumes() {
    return { ...this.settings };
  }

  setVolumes(v: Partial<{ music: number; sfx: number; muted: boolean }>): void {
    Object.assign(this.settings, v);
    try {
      localStorage.setItem("ringlink.audio", JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.applyVolumes();
  }

  private applyVolumes(): void {
    this.master.gain.value = this.settings.muted ? 0 : 1;
    this.musicGain.gain.value = this.settings.music * this.scriptMusicVolume;
    this.sfxGain.gain.value = this.settings.sfx;
  }

  /** Browsers start audio suspended until a user gesture. */
  resume(): void {
    if (this.ctx.state !== "running") void this.ctx.resume();
  }

  private load(path: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(path);
    if (!p) {
      const key = rsdkPathKey(path);
      const ext = this.audioIndex[key];
      p = ext
        ? fetch(`/data/${this.game}/audio/${key}.${ext}`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
            .then((b) => this.ctx.decodeAudioData(b))
            .catch((e) => {
              if (this.buffers.get(path) === p) this.buffers.delete(path);
              this.onLog(`audio ${path}: ${e}`);
              return null;
            })
        : Promise.resolve(null).then(() => {
            this.onLog(`audio ${path}: missing from audio index`);
            return null;
          });
      this.buffers.set(path, p);
    }
    return p;
  }

  /** Start fetching every registered sound effect so the first play is instant. */
  preload(): void {
    for (const p of this.sfxPaths) if (p) void this.load(`Data/SoundFX/${p}`);
  }

  log(m: string): void {
    this.onLog(m);
  }

  // ---- sound effects ---------------------------------------------------------------------------------------------

  loadSfx(id: number, path: string): void {
    this.sfxPaths[id] = path;
    if (path) void this.load(`Data/SoundFX/${path}`);
  }

  playSfx(id: number, loop: number): void {
    this.startSfx(id, !!loop, 0);
  }

  private startSfx(id: number, loop: boolean, pan: number): void {
    const path = this.sfxPaths[id];
    if (!path) {
      this.onLog(`audio: sound effect ${id} is not registered`);
      return;
    }
    this.stopSfx(id);
    const request = { loop, pan };
    this.sfxRequests.set(id, request);
    void this.load(`Data/SoundFX/${path}`).then((buf) => {
      if (this.sfxRequests.get(id) !== request) return;
      if (!buf) {
        this.sfxRequests.delete(id);
        return;
      }
      const src = this.ctx.createBufferSource();
      const panner = this.ctx.createStereoPanner();
      src.buffer = buf;
      src.loop = request.loop;
      panner.pan.value = Math.max(-1, Math.min(1, request.pan / 100));
      src.connect(panner);
      panner.connect(this.sfxGain);
      src.start();
      this.playingSfx.set(id, { source: src, panner });
      src.onended = () => {
        src.disconnect();
        panner.disconnect();
        if (this.playingSfx.get(id)?.source === src) {
          this.playingSfx.delete(id);
          this.sfxRequests.delete(id);
        }
      };
    });
  }

  stopSfx(id: number): void {
    this.sfxRequests.delete(id);
    const s = this.playingSfx.get(id);
    if (s) {
      this.playingSfx.delete(id);
      s.source.stop();
    }
  }

  stopAllSfx(): void {
    for (const id of [...this.sfxRequests.keys()]) this.stopSfx(id);
  }

  setSfxAttributes(id: number, loopCount: number, pan: number): void {
    const loop = loopCount === -1 ? (this.sfxRequests.get(id)?.loop ?? false) : loopCount !== 0;
    this.startSfx(id, loop, pan);
  }

  // ---- music -----------------------------------------------------------------------------------------------------

  setMusicTrack(path: string, track: number, loop: boolean, loopPoint: number): void {
    const trackPath = path ? `Data/Music/${path}` : "";
    const previous = this.tracks[track];
    this.tracks[track] = { path: trackPath, loop, loopPoint };
    if (this.requestedMusicTrack === track && previous?.path !== trackPath) this.stopMusic();
    if (path) void this.load(`Data/Music/${path}`);
  }

  private musicPosition(): number {
    if (!this.music) return 0;
    const { buffer, started, offset, source } = this.music;
    let pos = offset + (this.ctx.currentTime - started);
    const loopEnd = source.loopEnd || buffer.duration;
    if (source.loop && pos > loopEnd) {
      const loopStart = source.loopStart;
      pos = loopStart + ((pos - loopStart) % (loopEnd - loopStart));
    }
    return pos;
  }

  playMusic(track: number, startPos: number, ratio = 0): void {
    const t = this.tracks[track];
    if (!t || !t.path) {
      this.stopMusic();
      return;
    }
    const resumeAt = startPos && ratio ? (this.musicPosition() * 10000) / ratio : 0;
    const token = ++this.musicToken;
    this.requestedMusicTrack = track;
    void this.load(t.path).then((buf) => {
      if (token !== this.musicToken) return;
      if (!buf) {
        this.requestedMusicTrack = null;
        return;
      }
      this.stopSource();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = t.loop;
      if (t.loop) {
        const own = this.audioLoops[rsdkPathKey(t.path)];
        src.loopStart = Math.min(own ? own[0] : t.loopPoint / MUSIC_RATE, buf.duration - 0.01);
        src.loopEnd = own ? Math.min(own[1], buf.duration) : buf.duration;
      }
      src.connect(this.musicGain);
      const offset = Math.min(resumeAt, buf.duration - 0.01);
      src.start(0, offset);
      this.music = { source: src, started: this.ctx.currentTime, offset, track, buffer: buf };
    });
  }

  private stopSource(): void {
    if (this.music) {
      try {
        this.music.source.stop();
      } catch {
        /* ignore */
      }
      this.music = null;
    }
  }

  stopMusic(): void {
    this.musicToken++;
    this.requestedMusicTrack = null;
    this.stopSource();
  }

  syncMusic(track: number, playing: boolean): void {
    if (!playing) {
      if (this.requestedMusicTrack !== null || this.music) this.stopMusic();
    } else if (this.requestedMusicTrack !== track) {
      this.playMusic(track, 0);
    }
  }

  pauseMusic(): void {
    this.musicPauseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }

  resumeMusic(): void {
    this.musicPauseGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
  }

  swapMusicTrack(path: string, track: number, loopPoint: number, ratio: number): void {
    if (!path) {
      this.stopMusic();
      return;
    }
    this.tracks[track] = { path: `Data/Music/${path}`, loop: true, loopPoint };
    this.playMusic(track, 1, ratio);
  }

  /** music.volume (0-100) from the scripts, used for fades. */
  setMusicVolume(volume: number): void {
    this.scriptMusicVolume = Math.max(0, Math.min(100, volume)) / 100;
    this.musicGain.gain.setTargetAtTime(this.scriptMusicVolume * this.settings.music, this.ctx.currentTime, 0.03);
  }

  dispose(): void {
    this.stopMusic();
    this.stopAllSfx();
    void this.ctx.close();
  }
}
