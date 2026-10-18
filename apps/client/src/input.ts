// Keyboard and gamepad to the engine's pad bits. Remappable keyboard bindings are kept in localStorage.

import { BTN } from "@ringlink/engine";

export type Action = keyof typeof BTN;

export const DEFAULT_KEYS: Record<string, Action> = {
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
  KeyW: "UP", KeyS: "DOWN", KeyA: "LEFT", KeyD: "RIGHT",
  KeyZ: "A", KeyX: "B", KeyC: "C", Space: "A", KeyJ: "A", KeyK: "B",
  Enter: "START", KeyT: "TELEPORT",
};

export class Input {
  private down = new Set<string>();
  private keys: Record<string, Action>;
  /** Index of the gamepad in use, or -1 for any. */
  gamepad = -1;
  enabled = true;

  constructor(target: Window = window) {
    let saved: Record<string, Action> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem("ringlink.keys") ?? "null");
    } catch {
      saved = null;
    }
    this.keys = saved ?? { ...DEFAULT_KEYS };
    target.addEventListener("keydown", (e) => {
      if (!this.enabled || (e.target instanceof HTMLInputElement)) return;
      if (this.keys[e.code]) {
        this.down.add(e.code);
        e.preventDefault();
      }
    });
    target.addEventListener("keyup", (e) => this.down.delete(e.code));
    target.addEventListener("blur", () => this.down.clear());
  }

  bindings(): Record<string, Action> {
    return { ...this.keys };
  }

  rebind(code: string, action: Action): void {
    for (const k of Object.keys(this.keys)) if (this.keys[k] === action && k !== code && !(k in DEFAULT_KEYS)) delete this.keys[k];
    this.keys[code] = action;
    try {
      localStorage.setItem("ringlink.keys", JSON.stringify(this.keys));
    } catch {
      /* ignore */
    }
  }

  resetBindings(): void {
    this.keys = { ...DEFAULT_KEYS };
    try {
      localStorage.removeItem("ringlink.keys");
    } catch {
      /* ignore */
    }
  }

  /** Current pad bits (keyboard OR gamepad). */
  read(): number {
    if (!this.enabled) return 0;
    let pad = 0;
    for (const code of this.down) pad |= BTN[this.keys[code]] ?? 0;
    const pads = navigator.getGamepads?.() ?? [];
    for (let i = 0; i < pads.length; i++) {
      const g = pads[i];
      if (!g || (this.gamepad >= 0 && i !== this.gamepad)) continue;
      const b = (n: number) => !!g.buttons[n]?.pressed;
      const ax = g.axes[0] ?? 0, ay = g.axes[1] ?? 0;
      if (b(12) || ay < -0.5) pad |= BTN.UP;
      if (b(13) || ay > 0.5) pad |= BTN.DOWN;
      if (b(14) || ax < -0.5) pad |= BTN.LEFT;
      if (b(15) || ax > 0.5) pad |= BTN.RIGHT;
      if (b(0)) pad |= BTN.A;
      if (b(1)) pad |= BTN.B;
      if (b(2)) pad |= BTN.C;
      if (b(3)) pad |= BTN.TELEPORT;
      if (b(9)) pad |= BTN.START;
      if (b(8)) pad |= BTN.SELECT;
    }
    return pad;
  }
}
