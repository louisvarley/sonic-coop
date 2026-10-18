// What the engine needs from its surroundings. The server and client each provide one.

export interface ScriptHost {
  log(msg: string): void;
  /** Sound effects and music are events: the sim never waits for audio. `predicted` is true while re-simulating. */
  playSfx(sfx: number, loop: number): void;
  stopSfx(sfx: number): void;
  setSfxAttributes(sfx: number, loopCount: number, pan: number): void;
  setMusicTrack(path: string, track: number, loop: boolean, loopPoint: number): void;
  playMusic(track: number, startPos: number): void;
  stopMusic(): void;
  pauseMusic(): void;
  resumeMusic(): void;
  swapMusicTrack(path: string, track: number, loopPoint: number, ratio: number): void;
  setMusicVolume(volume: number): void;
  /** Sound effect slot `id` now refers to Data/SoundFX/<path>. */
  loadSfx?(id: number, path: string): void;
  stopAllSfx?(): void;
  releaseStageSfx?(): void;
  /** CallNativeFunction*; return true if handled. */
  nativeFunction?(name: string, args: Int32Array, argIndex: number, text: string): boolean;
}

export const nullHost: ScriptHost = {
  log: () => {},
  playSfx: () => {},
  stopSfx: () => {},
  setSfxAttributes: () => {},
  setMusicTrack: () => {},
  playMusic: () => {},
  stopMusic: () => {},
  pauseMusic: () => {},
  resumeMusic: () => {},
  swapMusicTrack: () => {},
  setMusicVolume: () => {},
};
