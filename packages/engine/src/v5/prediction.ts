import type { V5Gameplay, V5GameplayState } from "./gameplay.js";

/** Speculative local world, kept separate from authoritative/rendered shared objects. */
export class V5Prediction {
  private pending: { seq: number; pad: number }[] = [];
  private sequence = -1;
  private acknowledged = -1;
  constructor(private readonly game: V5Gameplay, private readonly slot: number) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= game.capture().players.length) throw new Error("invalid v5 prediction slot");
  }

  capture(): V5GameplayState { return this.game.capture(); }

  reset(state: V5GameplayState): void {
    this.game.restore(state); this.pending = []; this.sequence = this.acknowledged = -1;
  }

  advance(seq: number, pad: number): void {
    if (!Number.isSafeInteger(seq) || seq <= this.sequence || !Number.isInteger(pad) || pad < 0 || pad > 65535) {
      throw new Error("invalid v5 predicted input");
    }
    if (this.pending.length >= 120) throw new Error("Sonic 3 server has not acknowledged inputs for two seconds. Rejoin the room.");
    this.step(pad);
    this.pending.push({ seq, pad }); this.sequence = seq;
  }

  reconcile(state: V5GameplayState, acknowledged: number): void {
    if (!Number.isSafeInteger(acknowledged) || acknowledged < -1 || acknowledged < this.acknowledged) {
      throw new Error("invalid v5 input acknowledgement");
    }
    const before = this.game.capture();
    try {
      this.game.restore(state);
      for (const input of this.pending) if (input.seq > acknowledged) this.step(input.pad);
    } catch (error) { this.game.restore(before); throw error; }
    this.pending = this.pending.filter((input) => input.seq > acknowledged);
    this.acknowledged = acknowledged;
  }

  private step(pad: number): void {
    const pads = this.game.capture().movement.players.map((player, slot) => slot === this.slot ? pad : player.pad);
    this.game.tick(pads);
  }
}
