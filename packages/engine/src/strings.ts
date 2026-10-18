// String.cpp helpers with their exact (sometimes quirky) semantics; the script compiler depends on them.

/** Case-insensitive-ish compare: characters match when equal or differ by exactly 32 (so '0' also matches 'P'). */
export function StrComp(a: string, b: string): boolean {
  let i = 0;
  for (;;) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    if (ca === cb || ca === cb + 32 || ca === cb - 32) {
      if (ca) i++;
      else return true;
    } else return false;
  }
}

/** Index of the stopID-th occurrence of token in string, or -1. */
export function FindStringToken(str: string, token: string, stopID: number): number {
  let found = 0;
  for (let s = 0; s < str.length; s++) {
    let match = true;
    for (let t = 0; t < token.length; t++) {
      if (s + t >= str.length) return -1;
      if (str.charCodeAt(s + t) !== token.charCodeAt(t)) match = false;
    }
    if (match && ++found === stopID) return s;
  }
  return -1;
}

/** ConvertStringToInteger: decimal, 0x hex, 0b binary, 0o octal, optional sign. Returns null when not a number. */
export function ConvertStringToInteger(text: string): number | null {
  if (!text.length) return null;
  const c0 = text.charCodeAt(0);
  if (!(text[0] === "+" || text[0] === "-" || (c0 >= 48 && c0 <= 57))) return null;
  let charID = 0;
  let negative = false;
  let base = 10;
  let strLength = text.length - 1;
  if (text[0] === "-") { negative = true; charID = 1; --strLength; }
  else if (text[0] === "+") { charID = 1; --strLength; }
  if (text[charID] === "0") {
    const n = text[charID + 1];
    if (n === "x" || n === "X") base = 16;
    else if (n === "b" || n === "B") base = 2;
    else if (n === "o" || n === "O") base = 8;
    if (base !== 10) { charID += 2; strLength -= 2; }
  }
  let value = 0;
  while (strLength > -1) {
    const ch = charID < text.length ? text.charCodeAt(charID) : 0;
    let bad = ch < 48;
    if (!bad) {
      if (base === 16 && ch > 102) bad = true;
      if (base === 8 && ch > 55) bad = true;
      if (base === 2 && ch > 49) bad = true;
    }
    if (bad) return null;
    let charVal = 0;
    if (ch >= 48 && ch <= 57) charVal = ch - 48;
    else if (ch >= 97 && ch <= 102) charVal = ch - 97 + 10;
    else if (ch >= 65 && ch <= 70) charVal = ch - 65 + 10;
    if (strLength <= 0) value = (value + charVal) | 0;
    else {
      let v = charVal;
      for (let k = strLength; k > 0; k--) v = Math.imul(v, base) >>> 0; // uint arithmetic in the original
      value = (value + v) | 0;
    }
    --strLength;
    ++charID;
  }
  return negative ? -value | 0 : value;
}
