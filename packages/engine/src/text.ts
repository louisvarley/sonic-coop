// Text.cpp: text menus (the credits and a few menus keep their text in these).

import type { Engine } from "./engine.js";

export const TEXTDATA_COUNT = 0x2800;
export const TEXTENTRY_COUNT = 0x200;

export class TextMenu {
  textData = new Uint16Array(TEXTDATA_COUNT);
  entryStart = new Int32Array(TEXTENTRY_COUNT);
  entrySize = new Int32Array(TEXTENTRY_COUNT);
  entryHighlight = new Uint8Array(TEXTENTRY_COUNT);
  textDataPos = 0;
  selection1 = 0;
  selection2 = 0;
  rowCount = 0;
  visibleRowCount = 0;
  visibleRowOffset = 0;
  alignment = 0;
  selectionCount = 0;
  timer = 0;
}

export function SetupTextMenu(menu: TextMenu, rowCount: number): void {
  menu.textDataPos = 0;
  menu.rowCount = rowCount & 0xffff;
}

export function AddTextMenuEntry(menu: TextMenu, text: string): void {
  if (menu.rowCount >= TEXTENTRY_COUNT) return;
  menu.entryStart[menu.rowCount] = menu.textDataPos;
  menu.entrySize[menu.rowCount] = 0;
  for (let i = 0; i < text.length && menu.textDataPos < TEXTDATA_COUNT; i++) {
    menu.textData[menu.textDataPos++] = text.charCodeAt(i);
    menu.entrySize[menu.rowCount]++;
  }
  menu.rowCount++;
}

export function EditTextMenuEntry(menu: TextMenu, text: string, rowID: number): void {
  let entryPos = menu.entryStart[rowID];
  menu.entrySize[rowID] = 0;
  for (let i = 0; i < text.length && entryPos < TEXTDATA_COUNT; i++) {
    menu.textData[entryPos++] = text.charCodeAt(i);
    menu.entrySize[rowID]++;
  }
}

/** LoadTextFile (revision 2+ form: plain 8-bit text, CR separates rows). */
export function LoadTextFile(E: Engine, menu: TextMenu, filePath: string): void {
  const data = E.vfs.get(filePath);
  if (!data) {
    E.host.log(`missing text file ${filePath}`);
    return;
  }
  menu.textDataPos = 0;
  menu.rowCount = 0;
  menu.entryStart[0] = 0;
  menu.entrySize[0] = 0;
  let p = 0;
  while (menu.textDataPos < TEXTDATA_COUNT && p < data.length) {
    const b = data[p++];
    if (b === 10) continue;
    if (b === 13) {
      menu.rowCount++;
      if (menu.rowCount >= TEXTENTRY_COUNT) break;
      menu.entryStart[menu.rowCount] = menu.textDataPos;
      menu.entrySize[menu.rowCount] = 0;
    } else {
      menu.textData[menu.textDataPos++] = b;
      menu.entrySize[menu.rowCount]++;
    }
  }
  menu.rowCount++;
}
