// On-screen controls for phones and tablets: a floating stick on the left half of the screen (it centres wherever the
// thumb lands), jump buttons on the right, and small regroup / menu buttons along the top. Multi-touch: run and jump
// at the same time. The result is the same pad bits the keyboard produces (see Input.touchPad).

import { BTN } from "@ringlink/engine";

/** Pixels the thumb must move from where it landed before it counts as a direction. */
const DEADZONE = 14;
/** How far the knob is drawn from the stick's centre at most. */
const KNOB_RANGE = 44;

export interface TouchActions {
  regroup(): void;
  menu(): void;
  /** Any touch (unlocks audio). */
  touched(): void;
}

/** Keep receiving a finger's moves after it slides off the control (best effort). */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* the pointer is already gone */
  }
}

/** Phones and tablets (a touchscreen laptop's main pointer is its trackpad; it gets the controls on its first touch). */
export function isTouchDevice(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

export class TouchControls {
  readonly root: HTMLElement;
  /** Current pad bits from the touch controls. */
  pad = 0;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private stickBits = 0;
  private buttons = new Map<number, number>(); // pointerId -> bit
  private stick: HTMLElement;
  private knob: HTMLElement;

  constructor(parent: HTMLElement, private actions: TouchActions) {
    this.root = document.createElement("div");
    this.root.className = "touch-controls";
    this.root.innerHTML = `
      <div class="touch-stick-zone"></div>
      <div class="touch-stick" hidden><div class="touch-knob"></div></div>
      <button class="touch-btn touch-jump" data-bit="A" aria-label="Jump">A</button>
      <button class="touch-btn touch-jump2" data-bit="B" aria-label="Jump">B</button>
      <button class="touch-small touch-regroup" aria-label="Regroup">Regroup</button>
      <button class="touch-small touch-menu" aria-label="Menu">&#9776;</button>`;
    parent.append(this.root);
    this.stick = this.root.querySelector(".touch-stick")!;
    this.knob = this.root.querySelector(".touch-knob")!;

    const zone = this.root.querySelector<HTMLElement>(".touch-stick-zone")!;
    zone.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.actions.touched();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      capture(zone, e.pointerId);
      const r = this.root.getBoundingClientRect();
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stick.style.left = `${e.clientX - r.left}px`;
      this.stick.style.top = `${e.clientY - r.top}px`;
      this.stick.hidden = false;
      this.moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickBits = 0;
      this.stick.hidden = true;
      this.update();
    };
    zone.addEventListener("pointerup", endStick);
    zone.addEventListener("pointercancel", endStick);

    this.root.querySelectorAll<HTMLButtonElement>(".touch-btn").forEach((btn) => {
      const bit = BTN[btn.dataset.bit as keyof typeof BTN];
      btn.addEventListener("pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        this.actions.touched();
        capture(btn, e.pointerId);
        this.buttons.set(e.pointerId, bit);
        btn.classList.add("held");
        navigator.vibrate?.(8);
        this.update();
      });
      const release = (e: PointerEvent) => {
        if (!this.buttons.delete(e.pointerId)) return;
        if (![...this.buttons.values()].includes(bit)) btn.classList.remove("held");
        this.update();
      };
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
    });
    const tap = (sel: string, fn: () => void) =>
      this.root.querySelector(sel)!.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.actions.touched();
        fn();
      });
    tap(".touch-regroup", () => this.actions.regroup());
    tap(".touch-menu", () => this.actions.menu());
    // no long-press menus, text selection or double-tap zoom over the game
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private moveStick(x: number, y: number): void {
    const dx = x - this.stickX, dy = y - this.stickY;
    const dist = Math.hypot(dx, dy);
    let bits = 0;
    if (dist > DEADZONE) {
      // eight directions; diagonals take a 45 degree sector each so down+right (rolling down slopes) is easy to hold
      const angle = Math.atan2(dy, dx); // 0 = right, positive = down
      const sector = Math.round(angle / (Math.PI / 4));
      const dirs = [BTN.RIGHT, BTN.RIGHT | BTN.DOWN, BTN.DOWN, BTN.DOWN | BTN.LEFT, BTN.LEFT, BTN.LEFT | BTN.UP, BTN.UP, BTN.UP | BTN.RIGHT];
      bits = dirs[(sector + 8) % 8];
    }
    const k = Math.min(1, KNOB_RANGE / Math.max(dist, 1));
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    if (bits !== this.stickBits) {
      this.stickBits = bits;
      this.update();
    }
  }

  private update(): void {
    let pad = this.stickBits;
    for (const bit of this.buttons.values()) pad |= bit;
    this.pad = pad;
  }

  /** Forget all touches (e.g. when the page loses focus). */
  reset(): void {
    this.stickId = null;
    this.stickBits = 0;
    this.buttons.clear();
    this.stick.hidden = true;
    this.root.querySelectorAll(".held").forEach((b) => b.classList.remove("held"));
    this.update();
  }

  dispose(): void {
    this.root.remove();
  }
}
