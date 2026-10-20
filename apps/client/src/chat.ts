// Text chat between the players of a room. The server relays and rate-limits messages and keeps a short history,
// which it sends to whoever joins or reconnects. The lobby panel and the in-game overlay share one Chat per room.
// Messages are always shown as plain text (textContent), never as HTML.

import type { Room } from "colyseus.js";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@ringlink/engine";

/** How long a message stays over the game before it fades (the history stays in the lobby panel). */
const OVERLAY_MS = 8000;
const OVERLAY_LINES = 6;

export class Chat {
  messages: ChatMessage[] = [];
  /** Called with each new message, or null when the whole history was replaced. */
  private listeners = new Set<(m: ChatMessage | null) => void>();

  constructor(private room: Room) {
    room.onMessage("chat", (m: ChatMessage) => {
      this.messages.push(m);
      if (this.messages.length > 100) this.messages.shift();
      for (const fn of this.listeners) fn(m);
    });
    room.onMessage("chatHistory", (list: ChatMessage[]) => {
      this.messages = Array.isArray(list) ? list : [];
      for (const fn of this.listeners) fn(null);
    });
  }

  send(text: string): void {
    const t = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (t) this.room.send("chat", t);
  }

  subscribe(fn: (m: ChatMessage | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function line(m: ChatMessage, mySlot: number): HTMLElement {
  const li = document.createElement("li");
  li.className = `chat-line p${m.slot + 1}${m.slot === mySlot ? " me" : ""}`;
  const who = document.createElement("strong");
  who.textContent = `${m.name}:`;
  li.append(who, " ", m.text);
  return li;
}

function chatInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "chat-input";
  input.maxLength = CHAT_MAX_LENGTH;
  input.placeholder = "Say something…";
  input.autocomplete = "off";
  input.enterKeyHint = "send";
  return input;
}

/** The lobby's chat: the whole history and a message box. Kept across lobby re-renders so a half-typed message stays. */
export class ChatPanel {
  readonly root = document.createElement("section");
  private log = document.createElement("ul");
  private input = chatInput();
  private unsubscribe: () => void;
  mySlot = -1;

  constructor(private chat: Chat) {
    this.root.className = "chat-panel";
    const title = document.createElement("h2");
    title.textContent = "Chat";
    this.log.className = "chat-log";
    const form = document.createElement("form");
    form.className = "row chat-form";
    const send = document.createElement("button");
    send.textContent = "Send";
    form.append(this.input, send);
    form.onsubmit = (e) => {
      e.preventDefault();
      this.chat.send(this.input.value);
      this.input.value = "";
    };
    this.root.append(title, this.log, form);
    this.unsubscribe = chat.subscribe((m) => (m ? this.append(m) : this.redraw()));
    this.redraw();
  }

  /** Whether the message box has the focus (re-rendering the lobby moves the panel, which drops it). */
  focused(): boolean {
    return document.activeElement === this.input;
  }

  restoreFocus(): void {
    this.input.focus();
  }

  redraw(): void {
    this.log.replaceChildren(...this.chat.messages.map((m) => line(m, this.mySlot)));
    if (!this.chat.messages.length) {
      const empty = document.createElement("li");
      empty.className = "chat-empty";
      empty.textContent = "No messages yet.";
      this.log.append(empty);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private append(m: ChatMessage): void {
    this.log.querySelector(".chat-empty")?.remove();
    this.log.append(line(m, this.mySlot));
    this.log.scrollTop = this.log.scrollHeight;
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }
}

/** Chat over the game: recent messages fade out after a few seconds; Y (or the Chat button) opens the message box. */
export class ChatOverlay {
  readonly root = document.createElement("div");
  private lines = document.createElement("ul");
  private form = document.createElement("form");
  private input = chatInput();
  private unsubscribe: () => void;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  isOpen = false;

  constructor(private chat: Chat, parent: HTMLElement, private mySlot: number, private onOpenChange: (open: boolean) => void) {
    this.root.className = "chat-overlay";
    this.lines.className = "chat-lines";
    this.form.className = "chat-form";
    this.form.hidden = true;
    this.form.append(this.input);
    this.root.append(this.lines, this.form);
    parent.append(this.root);
    this.form.onsubmit = (e) => {
      e.preventDefault();
      this.chat.send(this.input.value);
      this.close();
    };
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.close();
    });
    this.input.addEventListener("blur", () => this.close());
    this.unsubscribe = chat.subscribe((m) => m && this.show(m));
  }

  private show(m: ChatMessage): void {
    const li = line(m, this.mySlot);
    this.lines.append(li);
    while (this.lines.children.length > OVERLAY_LINES) this.lines.firstElementChild!.remove();
    const t = setTimeout(() => {
      this.timers.delete(t);
      li.classList.add("faded");
    }, OVERLAY_MS);
    this.timers.add(t);
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add("open");
    this.form.hidden = false;
    this.input.value = "";
    this.input.focus();
    this.onOpenChange(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove("open");
    this.form.hidden = true;
    this.input.blur();
    this.onOpenChange(false);
  }

  dispose(): void {
    this.close();
    this.unsubscribe();
    for (const t of this.timers) clearTimeout(t);
    this.root.remove();
  }
}
