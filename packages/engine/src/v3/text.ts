// Text.cpp (RSDKv3): text menus and bitmap fonts. TextMenu itself is shared with the v4 engine.

import type { Engine3 } from "./engine.js";
import { FileReader } from "../core/reader.js";
import { TextMenu } from "../text.js";
import { TEXTDATA_COUNT } from "./consts.js";

export const FONTCHAR_COUNT = 0x400;

export interface FontCharacter { id: number; srcX: number; srcY: number; width: number; height: number; pivotX: number; pivotY: number; xAdvance: number }

export const newFontList = (): FontCharacter[] =>
  Array.from({ length: FONTCHAR_COUNT }, () => ({ id: 0, srcX: 0, srcY: 0, width: 0, height: 0, pivotX: 0, pivotY: 0, xAdvance: 0 }));

/** A signed short stored as low byte + (high byte, biased when > 0x80). */
function biased(f: FileReader): number {
  let v = f.u8();
  const hi = f.u8();
  if (hi > 0x80) v += ((hi - 0x80) << 8) - 0x8000;
  else v += hi << 8;
  return (v << 16) >> 16;
}

export function LoadFontFile(E: Engine3, filePath: string): void {
  const data = E.vfs.get(filePath);
  if (!data) {
    E.host.log(`missing font ${filePath}`);
    return;
  }
  const f = new FileReader(data);
  let cnt = 0;
  while (!f.eof() && cnt < FONTCHAR_COUNT) {
    const c = E.fontCharacterList[cnt];
    c.id = f.s32();
    c.srcX = f.u16();
    c.srcY = f.u16();
    c.width = ((f.u8() + 1) + (f.u8() << 8)) & 0xffff;
    c.height = ((f.u8() + 1) + (f.u8() << 8)) & 0xffff;
    c.pivotX = biased(f);
    c.pivotY = biased(f);
    c.xAdvance = biased(f);
    f.skip(2);
    cnt++;
  }
}

function mapChar(E: Engine3, character: number): number {
  for (let i = 0; i < FONTCHAR_COUNT; ++i) if (E.fontCharacterList[i].id === character) return i;
  return 0;
}

export function LoadTextFile(E: Engine3, menu: TextMenu, filePath: string, mapCode: boolean): void {
  const data = E.vfs.get(filePath);
  if (!data) {
    E.host.log(`missing text file ${filePath}`);
    return;
  }
  const f = new FileReader(data);
  menu.textDataPos = 0;
  menu.rowCount = 0;
  menu.entryStart[0] = 0;
  menu.entrySize[0] = 0;
  const unicode = f.u8() === 0xff;
  if (unicode) f.u8(); // byte order mark, second half
  else f.pos = 0;
  let finished = false;
  while (!finished) {
    let character = unicode ? f.u16() : f.u8();
    if (character !== 10) {
      if (character === 13) {
        menu.rowCount++;
        if (menu.rowCount > 511) finished = true;
        else {
          menu.entryStart[menu.rowCount] = menu.textDataPos;
          menu.entrySize[menu.rowCount] = 0;
        }
      } else {
        if (mapCode) character = mapChar(E, character);
        menu.textData[menu.textDataPos++] = character;
        menu.entrySize[menu.rowCount]++;
      }
    }
    if (!finished) finished = f.eof() || menu.textDataPos >= TEXTDATA_COUNT;
  }
  menu.rowCount++;
}

export function SetupTextMenu(menu: TextMenu, rowCount: number): void {
  menu.textDataPos = 0;
  menu.rowCount = rowCount & 0xffff;
}

export function AddTextMenuEntry(menu: TextMenu, text: string): void {
  menu.entryStart[menu.rowCount] = menu.textDataPos;
  menu.entrySize[menu.rowCount] = 0;
  for (let i = 0; i < text.length && menu.textDataPos < TEXTDATA_COUNT; i++) {
    menu.textData[menu.textDataPos++] = text.charCodeAt(i);
    menu.entrySize[menu.rowCount]++;
  }
  menu.rowCount = (menu.rowCount + 1) & 0xffff;
}

export function EditTextMenuEntry(menu: TextMenu, text: string, rowID: number): void {
  let entryPos = menu.entryStart[rowID];
  menu.entrySize[rowID] = 0;
  for (let i = 0; i < text.length && entryPos < TEXTDATA_COUNT; i++) {
    menu.textData[entryPos++] = text.charCodeAt(i);
    menu.entrySize[rowID]++;
  }
}
