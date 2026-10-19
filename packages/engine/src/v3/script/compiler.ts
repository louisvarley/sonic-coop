// The RetroScript v3 compiler (Script.cpp: ParseScriptFile and helpers), ported faithfully: scripts are compiled
// from the decompiled sources into scriptCode / jumpTable exactly the way the decompilation's engine does it.

import type { Engine3 } from "../engine.js";
import { FileReader } from "../../core/reader.js";
import { StrComp, FindStringToken } from "../../strings.js";
import { FUNCTIONS, VARIABLE_NAMES, COMMON_ALIASES, COMMONALIAS_COUNT, ALIAS_COUNT, SCRIPT_EVALUATION_TOKENS, PLATFORM_TOKENS } from "./tables.js";
import { FUNCTION_COUNT, OBJECT_COUNT, ENGINE_SCRIPTERROR } from "../consts.js";

const SCRIPTVAR_VAR = 1, SCRIPTVAR_INTCONST = 2, SCRIPTVAR_STRCONST = 3;
const VARARR_NONE = 0, VARARR_ARRAY = 1, VARARR_ENTNOPLUS1 = 2, VARARR_ENTNOMINUS1 = 3;
const READMODE_NORMAL = 0, READMODE_STRING = 1, READMODE_COMMENTLINE = 2, READMODE_ENDLINE = 3, READMODE_EOF = 4;
const PARSEMODE_SCOPELESS = 0, PARSEMODE_PLATFORMSKIP = 1, PARSEMODE_FUNCTION = 2, PARSEMODE_SWITCHREAD = 3, PARSEMODE_ERROR = 0xff;

const FUNC_END = 0, FUNC_EQUAL = 1, FUNC_MOD = 13, FUNC_IFEQUAL = 19, FUNC_WEQUAL = 27;
const FUNC_ENDFUNCTION = FUNCTIONS.findIndex(([n]) => n === "EndFunction");

export interface CompileError3 { script: string; line: number; message: string }

/**
 * ConvertStringToInteger (RSDKv3): decimal or 0x hex with an optional sign; digits are checked against '9' (decimal)
 * or 'F' (hex), so lower-case hex digits are rejected. Returns null when the text is not a number.
 */
export function ConvertStringToInteger3(text: string): number | null {
  if (!text.length) return null;
  const c0 = text.charCodeAt(0);
  if (text[0] !== "+" && !(c0 >= 48 && c0 <= 57) && text[0] !== "-") return null;
  let charID = 0;
  let negative = false;
  let base = 10;
  let strLength = text.length - 1;
  if (text[0] === "-") { negative = true; charID = 1; --strLength; }
  else if (text[0] === "+") { charID = 1; --strLength; }
  if (text[charID] === "0" && (text[charID + 1] === "x" || text[charID + 1] === "X")) {
    charID += 2;
    strLength -= 2;
    base = 16;
  }
  const maxChar = base === 10 ? 57 : 70; // '9' or 'F'
  let value = 0;
  while (strLength > -1) {
    const ch = charID < text.length ? text.charCodeAt(charID) : 0;
    if (ch < 48 || ch > maxChar) return null;
    let charVal = 0;
    if (ch >= 48 && ch <= 57) charVal = ch - 48;
    else if (ch >= 97 && ch <= 102) charVal = ch - 97 + 10;
    else if (ch >= 65 && ch <= 70) charVal = ch - 65 + 10;
    if (strLength <= 0) value = (value + charVal) | 0;
    else {
      let v = charVal;
      for (let k = strLength; k > 0; k--) v = Math.imul(v, base);
      value = (value + v) | 0;
    }
    --strLength;
    ++charID;
  }
  return negative ? -value | 0 : value;
}

/** CopyAliasStr: the part of an alias value outside [] (arrayIndex false) or inside it (true). */
function copyAliasStr(text: string, arrayIndex: boolean): string {
  let out = "";
  let inArray = false;
  for (const ch of text) {
    if (inArray) {
      if (ch === "]") inArray = false;
      else if (arrayIndex) out += ch;
    } else if (ch === "[") inArray = true;
    else if (!arrayIndex) out += ch;
  }
  return out;
}

export class ScriptCompiler3 {
  aliases: [string, string][] = [];
  aliasCount = COMMONALIAS_COUNT;
  scriptCodePos = 0;
  scriptCodeOffset = 0;
  jumpTablePos = 0;
  jumpTableOffset = 0;
  jumpTableStackPos = 0;
  lineID = 0;
  errors: CompileError3[] = [];
  private currentScript = "";

  constructor(private readonly E: Engine3) {
    this.reset();
  }

  /** ClearScriptData's compiler part. */
  reset(): void {
    this.scriptCodePos = 0;
    this.scriptCodeOffset = 0;
    this.jumpTablePos = 0;
    this.jumpTableOffset = 0;
    this.jumpTableStackPos = 0;
    this.lineID = 0;
    this.aliases = COMMON_ALIASES.map(([n, v]) => [n, v]);
    this.aliasCount = COMMONALIAS_COUNT;
    this.E.scriptFunctionCount = 0;
  }

  private fail(msg: string): void {
    if (this.E.gameMode === ENGINE_SCRIPTERROR) return;
    this.errors.push({ script: this.currentScript, line: this.lineID, message: msg });
    this.E.gameMode = ENGINE_SCRIPTERROR;
  }

  CheckAliasText(text: string): void {
    if (FindStringToken(text, "#alias", 1) !== 0) return;
    if (this.aliasCount >= ALIAS_COUNT) {
      this.fail("TOO MANY ALIASES");
      return;
    }
    const body = text.slice(6);
    const colon = body.indexOf(":");
    // value:name (a missing colon leaves the name empty)
    this.aliases[this.aliasCount++] = colon < 0 ? ["", body] : [body.slice(colon + 1), body.slice(0, colon)];
  }

  ConvertArithmaticSyntax(text: string): string {
    let token = 0;
    let offset = 0;
    for (let i = FUNC_EQUAL; i <= FUNC_MOD; ++i) {
      const findID = FindStringToken(text, SCRIPT_EVALUATION_TOKENS[i - 1], 1);
      if (findID > -1) {
        offset = findID;
        token = i;
      }
    }
    if (token <= 0) return text;
    let dest = FUNCTIONS[token][0] + "(" + text.slice(0, offset);
    if (FUNCTIONS[token][1] > 1) dest += "," + text.slice(offset + SCRIPT_EVALUATION_TOKENS[token - 1].length);
    return dest + ")";
  }

  ConvertIfWhileStatement(text: string): string {
    const E = this.E;
    for (const [kw, base, skip] of [["if", FUNC_IFEQUAL, 2], ["while", FUNC_WEQUAL, 5]] as const) {
      if (FindStringToken(text, kw, 1) !== 0) continue;
      let compareOp = -1;
      let strPos = 0;
      for (let i = 0; i < 6; ++i) {
        const p = FindStringToken(text, SCRIPT_EVALUATION_TOKENS[i + FUNC_MOD], 1);
        if (p > -1) {
          strPos = p;
          compareOp = i;
        }
      }
      if (compareOp > -1) {
        const t = text.slice(0, strPos) + "," + text.slice(strPos + 1);
        let dest = `${FUNCTIONS[compareOp + base][0]}(${this.jumpTablePos - this.jumpTableOffset},`;
        for (let i = skip; i < t.length; ++i) if (t[i] !== "=" && t[i] !== "(" && t[i] !== ")") dest += t[i];
        dest += ")";
        E.jumpTableStack[++this.jumpTableStackPos] = this.jumpTablePos;
        E.jumpTable[this.jumpTablePos++] = kw === "if" ? -1 : this.scriptCodePos - this.scriptCodeOffset;
        E.jumpTable[this.jumpTablePos++] = 0;
        return dest;
      }
      return text;
    }
    return text;
  }

  /** Returns the converted text, or null when this is not a switch statement. */
  ConvertSwitchStatement(text: string): string | null {
    const E = this.E;
    if (FindStringToken(text, "switch", 1)) return null;
    let s = `switch(${this.jumpTablePos - this.jumpTableOffset},`;
    for (let i = 6; i < text.length; ++i) if (text[i] !== "=" && text[i] !== "(" && text[i] !== ")") s += text[i];
    s += ")";
    E.jumpTableStack[++this.jumpTableStackPos] = this.jumpTablePos;
    E.jumpTable[this.jumpTablePos++] = 0x10000;
    E.jumpTable[this.jumpTablePos++] = -0x10000;
    E.jumpTable[this.jumpTablePos++] = -1;
    E.jumpTable[this.jumpTablePos++] = 0;
    return s;
  }

  ConvertFunctionText(text: string): void {
    const E = this.E;
    let namePos = 0;
    while (namePos < text.length && text[namePos] !== "(") namePos++;
    const funcName0 = text.slice(0, namePos);
    let opcode = 0;
    let opcodeSize = 0;
    let textPos = 0;
    for (let i = 0; i < FUNCTIONS.length; ++i) {
      if (StrComp(funcName0, FUNCTIONS[i][0])) {
        opcode = i;
        opcodeSize = FUNCTIONS[i][1];
        textPos = FUNCTIONS[i][0].length;
        break;
      }
    }
    if (opcode <= 0) {
      this.fail(`OPCODE NOT FOUND: ${funcName0}`);
      return;
    }

    E.scriptCode[this.scriptCodePos++] = opcode;
    const name = FUNCTIONS[opcode][0];
    if (StrComp("else", name)) E.jumpTable[E.jumpTableStack[this.jumpTableStackPos]] = this.scriptCodePos - this.scriptCodeOffset;
    if (StrComp("endif", name)) {
      const jPos = E.jumpTableStack[this.jumpTableStackPos];
      E.jumpTable[jPos + 1] = this.scriptCodePos - this.scriptCodeOffset;
      if (E.jumpTable[jPos] === -1) E.jumpTable[jPos] = this.scriptCodePos - this.scriptCodeOffset - 1;
      --this.jumpTableStackPos;
    }
    if (StrComp("endswitch", name)) {
      const jPos = E.jumpTableStack[this.jumpTableStackPos];
      E.jumpTable[jPos + 3] = this.scriptCodePos - this.scriptCodeOffset;
      if (E.jumpTable[jPos + 2] === -1) {
        E.jumpTable[jPos + 2] = this.scriptCodePos - this.scriptCodeOffset - 1;
        const caseCnt = Math.abs(E.jumpTable[jPos + 1] - E.jumpTable[jPos]) + 1;
        const jOffset = jPos + 4;
        for (let c = 0; c < caseCnt; ++c) if (E.jumpTable[jOffset + c] < 0) E.jumpTable[jOffset + c] = E.jumpTable[jPos + 2];
      }
      --this.jumpTableStackPos;
    }
    if (StrComp("loop", name)) E.jumpTable[E.jumpTableStack[this.jumpTableStackPos--] + 1] = this.scriptCodePos - this.scriptCodeOffset;

    for (let i = 0; i < opcodeSize; ++i) {
      ++textPos;
      let funcName = "";
      let arrayStr = "";
      let inArray = false;
      while (textPos < text.length && text[textPos] !== "," && text[textPos] !== ")") {
        const ch = text[textPos];
        if (inArray) {
          if (ch === "]") inArray = false;
          else arrayStr += ch;
        } else if (ch === "[") inArray = true;
        else funcName += ch;
        ++textPos;
      }

      // Eg: TempValue0 = FX_SCALE
      for (let a = 0; a < this.aliasCount; ++a) {
        const [aliasName, aliasValue] = this.aliases[a];
        if (StrComp(funcName, aliasName)) {
          funcName = copyAliasStr(aliasValue, false);
          if (FindStringToken(aliasValue, "[", 1) > -1) arrayStr = copyAliasStr(aliasValue, true);
        }
      }
      // Eg: TempValue0 = Game.Variable
      for (let v = 0; v < E.globalVariableNames.length; ++v) {
        if (StrComp(funcName, E.globalVariableNames[v])) {
          funcName = "Global";
          arrayStr = String(v);
        }
      }
      // Eg: TempValue0 = Function1
      for (let f = 0; f < E.scriptFunctionCount; ++f) if (StrComp(funcName, E.scriptFunctionList[f].name)) funcName = String(f);
      // Eg: TempValue0 = TypeName[PlayerObject]
      if (StrComp(funcName, "TypeName")) {
        funcName = "0";
        for (let o = 0; o < OBJECT_COUNT; ++o) if (StrComp(arrayStr, E.typeNames[o])) funcName = String(o);
      }

      const constant = ConvertStringToInteger3(funcName);
      if (constant !== null) {
        E.scriptCode[this.scriptCodePos++] = SCRIPTVAR_INTCONST;
        E.scriptCode[this.scriptCodePos++] = constant;
      } else if (funcName[0] === '"') {
        E.scriptCode[this.scriptCodePos++] = SCRIPTVAR_STRCONST;
        E.scriptCode[this.scriptCodePos++] = funcName.length - 2;
        // Four characters per int, high byte first; the closing quote is packed too.
        let p = 1;
        let k = 0;
        for (;;) {
          const ch = p < funcName.length ? funcName.charCodeAt(p) & 0xff : 0;
          switch (k) {
            case 0: E.scriptCode[this.scriptCodePos] = ch << 24; ++k; break;
            case 1: E.scriptCode[this.scriptCodePos] += ch << 16; ++k; break;
            case 2: E.scriptCode[this.scriptCodePos] += ch << 8; ++k; break;
            case 3: E.scriptCode[this.scriptCodePos++] += ch; k = 0; break;
          }
          if (funcName[p] === '"' || p >= funcName.length) {
            if (k > 0) ++this.scriptCodePos;
            break;
          }
          p++;
        }
      } else {
        E.scriptCode[this.scriptCodePos++] = SCRIPTVAR_VAR;
        if (arrayStr.length) {
          let arrType = VARARR_ARRAY;
          if (arrayStr[0] === "+") arrType = VARARR_ENTNOPLUS1;
          if (arrayStr[0] === "-") arrType = VARARR_ENTNOMINUS1;
          E.scriptCode[this.scriptCodePos++] = arrType;
          if (arrayStr[0] === "-" || arrayStr[0] === "+") arrayStr = arrayStr.slice(1);
          const idx = ConvertStringToInteger3(arrayStr);
          if (idx !== null) {
            E.scriptCode[this.scriptCodePos++] = 0;
            E.scriptCode[this.scriptCodePos++] = idx;
          } else {
            let pos = 0;
            if (StrComp(arrayStr, "ArrayPos0")) pos = 0;
            if (StrComp(arrayStr, "ArrayPos1")) pos = 1;
            if (StrComp(arrayStr, "TempObjectPos")) pos = 2;
            E.scriptCode[this.scriptCodePos++] = 1;
            E.scriptCode[this.scriptCodePos++] = pos;
          }
        } else {
          E.scriptCode[this.scriptCodePos++] = VARARR_NONE;
        }
        let varID = -1;
        for (let v = 0; v < VARIABLE_NAMES.length; ++v) if (StrComp(funcName, VARIABLE_NAMES[v])) varID = v;
        if (varID === -1) {
          this.fail(`OPERAND NOT FOUND: ${funcName}`);
          varID = 0;
        }
        E.scriptCode[this.scriptCodePos++] = varID;
      }
    }
  }

  CheckCaseNumber(text: string): void {
    const E = this.E;
    if (FindStringToken(text, "case", 1) !== 0) return;
    let caseString = text.slice(4).replace(/:/g, "");
    for (let a = 0; a < this.aliasCount; ++a) {
      if (StrComp(this.aliases[a][0], caseString)) {
        caseString = this.aliases[a][1];
        break;
      }
    }
    const caseID = ConvertStringToInteger3(caseString);
    if (caseID === null) {
      this.fail(`INVALID SWITCH CASE: ${caseString}`);
      return;
    }
    const stackValue = E.jumpTableStack[this.jumpTableStackPos];
    if (caseID < E.jumpTable[stackValue]) E.jumpTable[stackValue] = caseID;
    if (caseID > E.jumpTable[stackValue + 1]) E.jumpTable[stackValue + 1] = caseID;
  }

  ReadSwitchCase(text: string): boolean {
    const E = this.E;
    if (FindStringToken(text, "case", 1) === 0) {
      let caseText = text.slice(4).replace(/:/g, "");
      for (let a = 0; a < this.aliasCount; ++a) if (StrComp(caseText, this.aliases[a][0])) caseText = this.aliases[a][1];
      const jPos = E.jumpTableStack[this.jumpTableStackPos];
      const val = ConvertStringToInteger3(caseText);
      if (val !== null) E.jumpTable[val - E.jumpTable[jPos] + jPos + 4] = this.scriptCodePos - this.scriptCodeOffset;
      return true;
    }
    if (FindStringToken(text, "default", 1) === 0) {
      const jPos = E.jumpTableStack[this.jumpTableStackPos];
      E.jumpTable[jPos + 2] = this.scriptCodePos - this.scriptCodeOffset;
      const cnt = Math.abs(E.jumpTable[jPos + 1] - E.jumpTable[jPos]) + 1;
      for (let i = 0; i < cnt; ++i) if (E.jumpTable[jPos + 4 + i] < 0) E.jumpTable[jPos + 4 + i] = this.scriptCodePos - this.scriptCodeOffset;
      return true;
    }
    return false;
  }

  ParseScriptFile(scriptName: string, scriptID: number): void {
    const E = this.E;
    this.currentScript = scriptName;
    this.jumpTableStackPos = 0;
    this.lineID = 0;
    this.aliasCount = COMMONALIAS_COUNT;
    this.aliases.length = COMMONALIAS_COUNT;

    const data = E.vfs.get("Data/Scripts/" + scriptName);
    if (!data) {
      E.host.log(`script not found: ${scriptName}`);
      return;
    }
    E.objectScriptList[scriptID].mobile = true;
    const f = new FileReader(data);
    let readMode = READMODE_NORMAL;
    let parseMode = PARSEMODE_SCOPELESS;
    let prevChar = 0;
    let curChar = 0;
    let switchDeep = 0;
    let switchReadPos = 0;
    const chars: number[] = [];

    while (readMode < READMODE_EOF) {
      chars.length = 0;
      readMode = READMODE_NORMAL;
      while (readMode < READMODE_ENDLINE) {
        prevChar = curChar;
        curChar = f.u8();
        if (readMode === READMODE_STRING) {
          if (curChar === 9 || curChar === 13 || curChar === 10 || curChar === 59) {
            if (curChar === 10) readMode = READMODE_ENDLINE;
          } else if (curChar !== 47 || chars.length <= 0) {
            chars.push(curChar);
            if (curChar === 34) readMode = READMODE_NORMAL;
          } else if (curChar === 47 && prevChar === 47) {
            readMode = READMODE_COMMENTLINE;
            chars.pop();
          } else chars.push(curChar);
        } else if (curChar === 32 || curChar === 9 || curChar === 13 || curChar === 10 || curChar === 59 || readMode >= READMODE_COMMENTLINE) {
          if (curChar === 10) readMode = READMODE_ENDLINE;
        } else if (curChar !== 47 || chars.length <= 0) {
          chars.push(curChar);
          if (curChar === 34 && !readMode) readMode = READMODE_STRING;
        } else if (curChar === 47 && prevChar === 47) {
          readMode = READMODE_COMMENTLINE;
          chars.pop();
        } else chars.push(curChar);
        if (f.eof()) readMode = READMODE_EOF;
      }
      let scriptText = String.fromCharCode(...chars);

      switch (parseMode) {
        case PARSEMODE_SCOPELESS: {
          ++this.lineID;
          this.CheckAliasText(scriptText);
          const os = E.objectScriptList[scriptID];
          for (const [label, sub] of [
            ["subObjectMain", os.subMain], ["subObjectPlayerInteraction", os.subPlayerInteraction],
            ["subObjectDraw", os.subDraw], ["subObjectStartup", os.subStartup],
          ] as const) {
            if (StrComp(scriptText, label)) {
              parseMode = PARSEMODE_FUNCTION;
              sub.scriptCodePtr = this.scriptCodePos;
              sub.jumpTablePtr = this.jumpTablePos;
              this.scriptCodeOffset = this.scriptCodePos;
              this.jumpTableOffset = this.jumpTablePos;
            }
          }
          const fnPos = FindStringToken(scriptText, "function", 1);
          if (fnPos === 0) {
            // regular declaration
            const funcName = scriptText.slice(8);
            let funcID = -1;
            for (let i = 0; i < E.scriptFunctionCount; ++i) if (StrComp(funcName, E.scriptFunctionList[i].name)) funcID = i;
            if (funcID <= -1) {
              if (E.scriptFunctionCount >= FUNCTION_COUNT) parseMode = PARSEMODE_SCOPELESS;
              else funcID = E.scriptFunctionCount++;
            }
            if (funcID > -1) {
              const fn = E.scriptFunctionList[funcID];
              fn.name = funcName;
              fn.ptr.scriptCodePtr = this.scriptCodePos;
              fn.ptr.jumpTablePtr = this.jumpTablePos;
              this.scriptCodeOffset = this.scriptCodePos;
              this.jumpTableOffset = this.jumpTablePos;
              parseMode = PARSEMODE_FUNCTION;
            }
          } else if (fnPos === 1) {
            // forward declaration (#function Name)
            const funcName = scriptText.slice(9);
            let funcID = -1;
            for (let i = 0; i < E.scriptFunctionCount; ++i) if (StrComp(funcName, E.scriptFunctionList[i].name)) funcID = i;
            if (E.scriptFunctionCount < FUNCTION_COUNT && funcID === -1) E.scriptFunctionList[E.scriptFunctionCount++].name = funcName;
            parseMode = PARSEMODE_SCOPELESS;
          }
          break;
        }
        case PARSEMODE_PLATFORMSKIP:
          ++this.lineID;
          if (FindStringToken(scriptText, "#endplatform", 1) === 0) parseMode = PARSEMODE_FUNCTION;
          break;

        case PARSEMODE_FUNCTION:
          ++this.lineID;
          if (scriptText.length) {
            if (StrComp(scriptText, "endsub")) {
              E.scriptCode[this.scriptCodePos++] = FUNC_END;
              parseMode = PARSEMODE_SCOPELESS;
            } else if (StrComp(scriptText, "endfunction")) {
              E.scriptCode[this.scriptCodePos++] = FUNC_ENDFUNCTION;
              parseMode = PARSEMODE_SCOPELESS;
            } else if (FindStringToken(scriptText, "#platform:", 1) === 0) {
              if (!PLATFORM_TOKENS.some((t) => FindStringToken(scriptText, t, 1) !== -1)) parseMode = PARSEMODE_PLATFORMSKIP;
            } else if (FindStringToken(scriptText, "#endplatform", 1) === -1) {
              scriptText = this.ConvertIfWhileStatement(scriptText);
              const sw = this.ConvertSwitchStatement(scriptText);
              if (sw !== null) {
                scriptText = sw;
                parseMode = PARSEMODE_SWITCHREAD;
                switchReadPos = f.pos;
                switchDeep = 0;
              }
              scriptText = this.ConvertArithmaticSyntax(scriptText);
              if (!this.ReadSwitchCase(scriptText)) {
                this.ConvertFunctionText(scriptText);
                if (E.gameMode === ENGINE_SCRIPTERROR) parseMode = PARSEMODE_ERROR;
              }
            }
          }
          break;

        case PARSEMODE_SWITCHREAD:
          if (FindStringToken(scriptText, "switch", 1) === 0) ++switchDeep;
          if (switchDeep) {
            if (FindStringToken(scriptText, "endswitch", 1) === 0) --switchDeep;
          } else if (FindStringToken(scriptText, "endswitch", 1) === 0) {
            f.pos = switchReadPos;
            parseMode = PARSEMODE_FUNCTION;
            const jPos = E.jumpTableStack[this.jumpTableStackPos];
            const cnt = Math.abs(E.jumpTable[jPos + 1] - E.jumpTable[jPos]) + 1;
            for (let t = 0; t < cnt; ++t) E.jumpTable[this.jumpTablePos++] = -1;
          } else {
            this.CheckCaseNumber(scriptText);
          }
          break;

        default:
          break;
      }
      if (parseMode === PARSEMODE_ERROR) {
        this.errors[this.errors.length - 1].message += ` (in ${scriptName})`;
        return;
      }
      // a switch read rewinds the file, so EOF may have been hit only while scanning ahead
      if (readMode === READMODE_EOF && parseMode === PARSEMODE_FUNCTION && f.pos < f.size) readMode = READMODE_NORMAL;
    }
  }
}
