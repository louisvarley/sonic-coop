// The RetroScript v4 compiler (Script.cpp: ParseScriptFile and helpers), ported faithfully: scripts are compiled
// from the decompiled sources into scriptCode / jumpTable exactly the way the decompilation's engine does it.

import type { Engine } from "../engine.js";
import { FileReader } from "../core/reader.js";
import { StrComp, FindStringToken, ConvertStringToInteger } from "../strings.js";
import { FUNCTIONS, VARIABLE_NAMES, BUILTIN_ALIASES } from "./tables.js";
import { FUNCTION_COUNT, OBJECT_COUNT, SFX_COUNT, ENGINE_SCRIPTERROR } from "../c.js";

const ACCESS_NONE = 0, ACCESS_PUBLIC = 1, ACCESS_PRIVATE = 2;
const SCRIPT_VAR_COUNT = BUILTIN_ALIASES.length + 0x1df;
const COMMON_SCRIPT_VAR_COUNT = BUILTIN_ALIASES.length;

const SCRIPTVAR_VAR = 1, SCRIPTVAR_INTCONST = 2, SCRIPTVAR_STRCONST = 3;
const VARARR_NONE = 0, VARARR_ARRAY = 1, VARARR_ENTNOPLUS1 = 2, VARARR_ENTNOMINUS1 = 3;

const READMODE_NORMAL = 0, READMODE_STRING = 1, READMODE_COMMENTLINE = 2, READMODE_ENDLINE = 3, READMODE_EOF = 4;
const PARSEMODE_SCOPELESS = 0, PARSEMODE_PLATFORMSKIP = 1, PARSEMODE_FUNCTION = 2, PARSEMODE_SWITCHREAD = 3, PARSEMODE_TABLEREAD = 4, PARSEMODE_ERROR = 0xff;

const evalTokens = ["=", "+=", "-=", "++", "--", "*=", "/=", ">>=", "<<=", "&=", "|=", "^=", "%=", "==", ">", ">=", "<", "<=", "!="];

const FUNC_EQUAL = 1, FUNC_MOD = 13, FUNC_IFEQUAL = 19, FUNC_WEQUAL = 27, FUNC_END = 0;
const FUNC_FOREACHACTIVE = FUNCTIONS.findIndex(([n]) => n === "ForEachActive");
const FUNC_FOREACHALL = FUNCTIONS.findIndex(([n]) => n === "ForEachAll");
const FUNC_RETURN = FUNCTIONS.findIndex(([n]) => n === "return");

interface ScriptVariableInfo { access: number; name: string; value: string }

export interface CompileError { script: string; line: number; message: string }

/** Platform tokens enabled for `#platform:` blocks. */
export const PLATFORM_TOKENS = ["STANDARD", "SW_RENDERING", "NO_F_FEEDBACK", "USE_STANDALONE", "USE_DECOMP"];

export class ScriptCompiler {
  scriptValueList: ScriptVariableInfo[] = [];
  scriptValueListCount = 0;
  scriptFunctionCount = 0;
  scriptCodePos = 0;
  scriptCodeOffset = 0;
  jumpTablePos = 0;
  jumpTableOffset = 0;
  jumpTableStackPos = 0;
  lineID = 0;
  errors: CompileError[] = [];
  warnings: string[] = [];
  private currentScript = "";
  /** Extra names accepted by `AchievementName[...]` (none: achievements are not part of this game). */
  achievements: string[] = [];

  constructor(private readonly E: Engine) {
    this.reset();
  }

  /** ClearScriptData's compiler part. */
  reset(): void {
    this.scriptFunctionCount = 0;
    this.lineID = 0;
    this.scriptCodePos = 0;
    this.scriptCodeOffset = 0;
    this.jumpTablePos = 0;
    this.jumpTableOffset = 0;
    this.jumpTableStackPos = 0;
    this.scriptValueList = [];
    for (const [name, value] of BUILTIN_ALIASES) this.scriptValueList.push({ access: ACCESS_PUBLIC, name, value });
    this.scriptValueListCount = COMMON_SCRIPT_VAR_COUNT;
    for (const f of this.E.scriptFunctionList) { f.name = ""; f.access = ACCESS_NONE; }
  }

  private warn(msg: string): void {
    this.warnings.push(`${this.currentScript}:${this.lineID}: ${msg}`);
  }

  private fail(msg: string): void {
    this.errors.push({ script: this.currentScript, line: this.lineID, message: msg });
    this.E.gameMode = ENGINE_SCRIPTERROR;
  }

  private newVar(): ScriptVariableInfo | null {
    if (this.scriptValueListCount >= SCRIPT_VAR_COUNT) {
      this.fail("too many aliases, static values and tables");
      return null;
    }
    const v: ScriptVariableInfo = { access: ACCESS_NONE, name: "", value: "" };
    this.scriptValueList[this.scriptValueListCount] = v;
    return v;
  }

  private checkDuplicate(name: string): void {
    for (let v = 0; v < this.scriptValueListCount; ++v) if (StrComp(this.scriptValueList[v].name, name)) this.warn(`variable name '${name}' has already been used`);
  }

  CheckAliasText(text: string): void {
    for (const [kw, access] of [["publicalias", ACCESS_PUBLIC], ["privatealias", ACCESS_PRIVATE]] as const) {
      if (FindStringToken(text, kw, 1) !== 0) continue;
      const variable = this.newVar();
      if (!variable) return;
      const body = text.slice(kw.length);
      const colon = body.indexOf(":");
      if (colon < 0) {
        variable.value = body;
        variable.name = "";
      } else {
        variable.value = body.slice(0, colon);
        variable.name = body.slice(colon + 1);
      }
      variable.access = access;
      this.checkDuplicate(variable.name);
      ++this.scriptValueListCount;
      return;
    }
  }

  CheckStaticText(text: string): void {
    const E = this.E;
    for (const [kw, access] of [["publicvalue", ACCESS_PUBLIC], ["privatevalue", ACCESS_PRIVATE]] as const) {
      if (FindStringToken(text, kw, 1) !== 0) continue;
      const variable = this.newVar();
      if (!variable) return;
      const body = text.slice(kw.length);
      const eq = body.indexOf("=");
      let value = "0";
      if (eq < 0) variable.name = body;
      else {
        variable.name = body.slice(0, eq);
        value = body.slice(eq + 1);
      }
      variable.access = access;
      const n = ConvertStringToInteger(value);
      E.scriptCode[this.scriptCodePos] = n ?? 0;
      variable.value = `local[${this.scriptCodePos++}]`;
      this.checkDuplicate(variable.name);
      ++this.scriptValueListCount;
      return;
    }
  }

  CheckTableText(text: string): boolean {
    const E = this.E;
    let hasValues = false;
    for (const [kw, access] of [["publictable", ACCESS_PUBLIC], ["privatetable", ACCESS_PRIVATE]] as const) {
      if (FindStringToken(text, kw, 1) !== 0) continue;
      const variable = this.newVar();
      if (!variable) return false;
      let pos = kw.length;
      let name = "";
      while (pos < text.length) {
        const c = text[pos];
        if (c === "[" || c === "]") { pos++; break; }
        name += c;
        pos++;
      }
      variable.name = name;
      if (FindStringToken(text, "]", 1) < 1) {
        // has default values: read them in table mode
        E.scriptCode[this.scriptCodePos] = 0;
        variable.value = String(this.scriptCodePos);
        this.scriptCodeOffset = this.scriptCodePos++;
        hasValues = true;
      } else {
        let size = "";
        while (pos < text.length) {
          const c = text[pos];
          if (c === "[" || c === "]") { pos++; break; }
          size += c;
          pos++;
        }
        for (let v = 0; v < this.scriptValueListCount; ++v) if (StrComp(size, this.scriptValueList[v].name)) size = this.scriptValueList[v].value;
        let count = ConvertStringToInteger(size);
        if (count === null) {
          count = 1;
          this.warn("unable to parse table size");
        }
        E.scriptCode[this.scriptCodePos] = count;
        variable.value = String(this.scriptCodePos);
        const valueCount = E.scriptCode[this.scriptCodePos++];
        for (let v = 0; v < valueCount; ++v) E.scriptCode[this.scriptCodePos++] = 0;
      }
      variable.access = access;
      this.scriptValueListCount++;
      return hasValues;
    }
    return hasValues;
  }

  ConvertArithmaticSyntax(text: string): string {
    let token = 0;
    let offset = 0;
    for (let i = FUNC_EQUAL; i <= FUNC_MOD; ++i) {
      const findID = FindStringToken(text, evalTokens[i - 1], 1);
      if (findID > -1) {
        offset = findID;
        token = i;
      }
    }
    if (token > 0) {
      let dest = FUNCTIONS[token][0] + "(" + text.slice(0, offset);
      if (FUNCTIONS[token][1] > 1) {
        dest += "," + text.slice(offset + evalTokens[token - 1].length);
      }
      return dest + ")";
    }
    return text;
  }

  ConvertConditionalStatement(text: string): string {
    const E = this.E;
    let compareOp = -1;
    let strPos = 0;
    if (FindStringToken(text, "if", 1) === 0) {
      for (let i = 0; i < 6; ++i) {
        const p = FindStringToken(text, evalTokens[i + FUNC_MOD], 1);
        if (p > -1) { strPos = p; compareOp = i; }
      }
      if (compareOp > -1) {
        text = text.slice(0, strPos) + "," + text.slice(strPos + 1);
        let dest = FUNCTIONS[compareOp + FUNC_IFEQUAL][0] + "(" + (this.jumpTablePos - this.jumpTableOffset) + ",";
        for (let i = 2; i < text.length; ++i) {
          const c = text[i];
          if (c !== "=" && c !== "(" && c !== ")") dest += c;
        }
        dest += ")";
        E.jumpTableStack[++this.jumpTableStackPos] = this.jumpTablePos;
        E.jumpTable[this.jumpTablePos++] = -1;
        E.jumpTable[this.jumpTablePos++] = 0;
        return dest;
      }
    } else if (FindStringToken(text, "while", 1) === 0) {
      for (let i = 0; i < 6; ++i) {
        const p = FindStringToken(text, evalTokens[i + FUNC_MOD], 1);
        if (p > -1) { strPos = p; compareOp = i; }
      }
      if (compareOp > -1) {
        text = text.slice(0, strPos) + "," + text.slice(strPos + 1);
        let dest = FUNCTIONS[compareOp + FUNC_WEQUAL][0] + "(" + (this.jumpTablePos - this.jumpTableOffset) + ",";
        for (let i = 5; i < text.length; ++i) {
          const c = text[i];
          if (c !== "=" && c !== "(" && c !== ")") dest += c;
        }
        dest += ")";
        E.jumpTableStack[++this.jumpTableStackPos] = this.jumpTablePos;
        E.jumpTable[this.jumpTablePos++] = this.scriptCodePos - this.scriptCodeOffset;
        E.jumpTable[this.jumpTablePos++] = 0;
        return dest;
      }
    } else if (FindStringToken(text, "foreach", 1) === 0) {
      const argStrPos = FindStringToken(text, ",", 2);
      if (argStrPos > -1) {
        const fn = text[argStrPos + 2] === "C" ? FUNC_FOREACHACTIVE : FUNC_FOREACHALL;
        let dest = FUNCTIONS[fn][0] + "(" + (this.jumpTablePos - this.jumpTableOffset) + ",";
        for (let i = 7; i < text.length && i < argStrPos; ++i) {
          const c = text[i];
          if (c !== "(" && c !== ")") dest += c;
        }
        dest += ")";
        E.jumpTableStack[++this.jumpTableStackPos] = this.jumpTablePos;
        E.jumpTable[this.jumpTablePos++] = this.scriptCodePos - this.scriptCodeOffset;
        E.jumpTable[this.jumpTablePos++] = 0;
        return dest;
      }
    }
    return text;
  }

  /** Returns the converted text, or null when the line is not a switch. */
  ConvertSwitchStatement(text: string): string | null {
    const E = this.E;
    if (FindStringToken(text, "switch", 1) !== 0) return null;
    let s = "switch(" + (this.jumpTablePos - this.jumpTableOffset) + ",";
    for (let i = 6; i < text.length; ++i) {
      const c = text[i];
      if (c !== "=" && c !== "(" && c !== ")") s += c;
    }
    s += ")";
    E.jumpTableStack[++this.jumpTableStackPos] = this.jumpTablePos;
    E.jumpTable[this.jumpTablePos++] = 0x10000;
    E.jumpTable[this.jumpTablePos++] = -0x10000;
    E.jumpTable[this.jumpTablePos++] = -1;
    E.jumpTable[this.jumpTablePos++] = 0;
    return s;
  }

  private copyAliasStr(text: string, arrayIndex: boolean): string {
    let dest = "";
    let arrayValue = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (arrayValue) {
        if (c === "]") arrayValue = false;
        else if (arrayIndex) dest += c;
      } else if (c === "[") arrayValue = true;
      else if (!arrayIndex) dest += c;
    }
    return dest;
  }

  /** Resolves TypeName[...], SfxName[...], VarName[...], AchievementName[...], PlayerName[...], StageName[...]. */
  private resolveNamedArray(kind: string, arrayStr: string, full: boolean): string | null {
    const E = this.E;
    if (StrComp(kind, "TypeName")) {
      for (let o = 0; o < OBJECT_COUNT; ++o) if (StrComp(arrayStr, E.typeNames[o])) return String(o);
      this.warn(`unknown typename "${arrayStr}"`);
      return "0";
    }
    if (StrComp(kind, "SfxName")) {
      for (let s = 0; s < SFX_COUNT; ++s) if (StrComp(arrayStr, E.sfxNames[s])) return String(s);
      this.warn(`unknown sfxName "${arrayStr}"`);
      return "0";
    }
    if (!full) return null;
    if (StrComp(kind, "VarName")) {
      for (let v = 0; v < E.globalVariableNames.length; ++v) if (StrComp(arrayStr, E.globalVariableNames[v])) return String(v);
      this.warn(`unknown varName "${arrayStr}"`);
      return "0";
    }
    if (StrComp(kind, "AchievementName")) {
      for (let a = 0; a < this.achievements.length; ++a) if (StrComp(arrayStr, this.achievements[a].replace(/ /g, ""))) return String(a);
      this.warn(`unknown AchievementName "${arrayStr}"`);
      return "0";
    }
    if (StrComp(kind, "PlayerName")) {
      for (let p = 0; p < E.playerNames.length; ++p) if (StrComp(arrayStr, E.playerNames[p].replace(/ /g, ""))) return String(p);
      this.warn(`unknown PlayerName "${arrayStr}"`);
      return "0";
    }
    if (StrComp(kind, "StageName")) {
      let s = -1;
      if (arrayStr.length >= 2) {
        const list = { P: 0, R: 1, S: 3, B: 2 }[arrayStr[0]] ?? arrayStr.charCodeAt(0);
        s = getSceneID(E, list, arrayStr.slice(2));
      }
      if (s === -1) {
        this.warn(`unknown StageName "${arrayStr}"`);
        s = 0;
      }
      return String(s);
    }
    return null;
  }

  ConvertFunctionText(text: string): void {
    const E = this.E;
    let namePos = 0;
    while (namePos < text.length && text[namePos] !== "(") namePos++;
    let funcName = text.slice(0, namePos);
    let opcode = 0;
    let opcodeSize = 0;
    let textPos = 0;
    for (let i = 0; i < FUNCTIONS.length; ++i) {
      if (StrComp(funcName, FUNCTIONS[i][0])) {
        opcode = i;
        opcodeSize = FUNCTIONS[i][1];
        textPos = FUNCTIONS[i][0].length;
        break;
      }
    }
    if (opcode <= 0) {
      this.fail(`opcode not found: ${funcName}`);
      return;
    }
    const code = E.scriptCode;
    const jt = E.jumpTable;
    const jts = E.jumpTableStack;
    code[this.scriptCodePos++] = opcode;
    const opName = FUNCTIONS[opcode][0];
    if (StrComp("else", opName)) jt[jts[this.jumpTableStackPos]] = this.scriptCodePos - this.scriptCodeOffset;
    if (StrComp("endif", opName)) {
      const jPos = jts[this.jumpTableStackPos];
      jt[jPos + 1] = this.scriptCodePos - this.scriptCodeOffset;
      if (jt[jPos] === -1) jt[jPos] = this.scriptCodePos - this.scriptCodeOffset - 1;
      --this.jumpTableStackPos;
    }
    if (StrComp("endswitch", opName)) {
      const jPos = jts[this.jumpTableStackPos];
      jt[jPos + 3] = this.scriptCodePos - this.scriptCodeOffset;
      if (jt[jPos + 2] === -1) {
        jt[jPos + 2] = this.scriptCodePos - this.scriptCodeOffset - 1;
        const caseCnt = Math.abs(jt[jPos + 1] - jt[jPos]) + 1;
        const jOffset = jPos + 4;
        for (let c = 0; c < caseCnt; ++c) if (jt[jOffset + c] < 0) jt[jOffset + c] = jt[jPos + 2];
      }
      --this.jumpTableStackPos;
    }
    if (StrComp("loop", opName) || StrComp("next", opName)) {
      jt[jts[this.jumpTableStackPos--] + 1] = this.scriptCodePos - this.scriptCodeOffset;
    }

    for (let i = 0; i < opcodeSize; ++i) {
      ++textPos;
      funcName = "";
      let arrayStr = "";
      let mode = 0;
      let prevMode = 0;
      while (textPos < text.length && ((text[textPos] !== "," && text[textPos] !== ")") || mode === 2)) {
        const c = text[textPos];
        switch (mode) {
          case 0:
            if (c === "[") mode = 1;
            else if (c === '"') { prevMode = mode; mode = 2; funcName += '"'; }
            else funcName += c;
            ++textPos;
            break;
          case 1:
            if (c === "]") mode = 0;
            else if (c === '"') { prevMode = mode; mode = 2; }
            else arrayStr += c;
            ++textPos;
            break;
          case 2:
            if (c === '"') { mode = prevMode; funcName += '"'; }
            else funcName += c;
            ++textPos;
            break;
        }
      }

      for (let v = 0; v < this.scriptValueListCount; ++v) {
        const sv = this.scriptValueList[v];
        if (StrComp(funcName, sv.name)) {
          funcName = this.copyAliasStr(sv.value, false);
          if (FindStringToken(sv.value, "[", 1) > -1) arrayStr = this.copyAliasStr(sv.value, true);
        }
      }

      if (arrayStr.length) {
        let arrPos = 0;
        if (arrayStr[0] === "+" || arrayStr[0] === "-") ++arrPos;
        const arrStrBuf = arrayStr.slice(arrPos);
        for (let v = 0; v < this.scriptValueListCount; ++v) {
          const sv = this.scriptValueList[v];
          if (StrComp(arrStrBuf, sv.name)) {
            const pref = arrayStr[0];
            arrayStr = this.copyAliasStr(sv.value, false);
            if (pref === "+" || pref === "-") arrayStr = pref + arrayStr;
          }
        }
      }

      // temp0 = game.variable
      for (let v = 0; v < E.globalVariableNames.length; ++v) {
        if (StrComp(funcName, E.globalVariableNames[v])) {
          funcName = "global";
          arrayStr = String(v);
        }
      }
      // temp0 = Function1
      for (let f = 0; f < this.scriptFunctionCount; ++f) {
        if (StrComp(funcName, E.scriptFunctionList[f].name)) funcName = String(f);
      }
      const named = this.resolveNamedArray(funcName, arrayStr, true);
      if (named !== null) funcName = named;

      const constant = ConvertStringToInteger(funcName);
      if (constant !== null) {
        code[this.scriptCodePos++] = SCRIPTVAR_INTCONST;
        code[this.scriptCodePos++] = constant;
      } else if (funcName[0] === '"') {
        code[this.scriptCodePos++] = SCRIPTVAR_STRCONST;
        code[this.scriptCodePos++] = funcName.length - 2;
        let scriptTextPos = 1;
        let k = 0;
        while (scriptTextPos > -1) {
          const ch = scriptTextPos < funcName.length ? funcName.charCodeAt(scriptTextPos) & 0xff : 0;
          switch (k) {
            case 0: code[this.scriptCodePos] = ch << 24; ++k; break;
            case 1: code[this.scriptCodePos] += ch << 16; ++k; break;
            case 2: code[this.scriptCodePos] += ch << 8; ++k; break;
            case 3: code[this.scriptCodePos++] += ch; k = 0; break;
          }
          if (funcName[scriptTextPos] === '"') {
            if (k > 0) ++this.scriptCodePos;
            scriptTextPos = -1;
          } else scriptTextPos++;
        }
      } else {
        code[this.scriptCodePos++] = SCRIPTVAR_VAR;
        if (arrayStr.length) {
          let t = VARARR_ARRAY;
          if (arrayStr[0] === "+") t = VARARR_ENTNOPLUS1;
          if (arrayStr[0] === "-") t = VARARR_ENTNOMINUS1;
          code[this.scriptCodePos++] = t;
          if (arrayStr[0] === "-" || arrayStr[0] === "+") arrayStr = arrayStr.slice(1);
          const c2 = ConvertStringToInteger(arrayStr);
          if (c2 !== null) {
            code[this.scriptCodePos++] = 0;
            code[this.scriptCodePos++] = c2;
          } else {
            let idx = 0;
            for (let a = 0; a < 8; a++) if (StrComp(arrayStr, `arrayPos${a}`)) idx = a;
            if (StrComp(arrayStr, "tempObjectPos")) idx = 8;
            code[this.scriptCodePos++] = 1;
            code[this.scriptCodePos++] = idx;
          }
        } else {
          code[this.scriptCodePos++] = VARARR_NONE;
        }
        let id = -1;
        for (let v = 0; v < VARIABLE_NAMES.length; ++v) if (StrComp(funcName, VARIABLE_NAMES[v])) id = v;
        if (id === -1 && E.gameMode !== ENGINE_SCRIPTERROR) {
          this.fail(`operand not found: ${funcName}`);
          id = 0;
        }
        code[this.scriptCodePos++] = id < 0 ? 0 : id;
      }
    }
  }

  private caseValue(text: string, full: boolean): string {
    let caseString = text;
    let found = false;
    if (FindStringToken(caseString, "[", 1) >= 0) {
      let caseValue = "";
      let arrayStr = "";
      let mode = 0;
      for (let p = 0; p < caseString.length && caseString[p] !== ":"; p++) {
        const c = caseString[p];
        if (mode) {
          if (c === "]") mode = 0;
          else arrayStr += c;
        } else if (c === "[") mode = 1;
        else caseValue += c;
      }
      const named = this.resolveNamedArray(caseValue, arrayStr, full);
      caseString = named ?? caseValue;
      found = true;
    }
    for (let a = 0; a < this.scriptValueListCount && !found; ++a) {
      if (StrComp(this.scriptValueList[a].name, caseString)) {
        caseString = this.scriptValueList[a].value;
        break;
      }
    }
    return caseString;
  }

  CheckCaseNumber(text: string): void {
    const E = this.E;
    if (FindStringToken(text, "case", 1) !== 0) return;
    const caseString = this.caseValue(text.slice(4).replace(/:/g, ""), true);
    const caseID = ConvertStringToInteger(caseString);
    if (caseID !== null) {
      let stackValue = E.jumpTableStack[this.jumpTableStackPos];
      if (caseID < E.jumpTable[stackValue]) E.jumpTable[stackValue] = caseID;
      stackValue++;
      if (caseID > E.jumpTable[stackValue]) E.jumpTable[stackValue] = caseID;
    } else this.warn(`unable to convert case string "${caseString}" to int`);
  }

  ReadSwitchCase(text: string): boolean {
    const E = this.E;
    if (FindStringToken(text, "case", 1) === 0) {
      const caseText = this.caseValue(text.slice(4).replace(/:/g, ""), true);
      const jPos = E.jumpTableStack[this.jumpTableStackPos];
      const jOffset = jPos + 4;
      const val = ConvertStringToInteger(caseText);
      if (val !== null) E.jumpTable[val - E.jumpTable[jPos] + jOffset] = this.scriptCodePos - this.scriptCodeOffset;
      else this.warn(`unable to read case string "${caseText}" as an int`);
      return true;
    } else if (FindStringToken(text, "default", 1) === 0) {
      const jp = E.jumpTableStack[this.jumpTableStackPos];
      E.jumpTable[jp + 2] = this.scriptCodePos - this.scriptCodeOffset;
      const cnt = Math.abs(E.jumpTable[jp + 1] - E.jumpTable[jp]) + 1;
      const jOffset = jp + 4;
      for (let i = 0; i < cnt; ++i) if (E.jumpTable[jOffset + i] < 0) E.jumpTable[jOffset + i] = this.scriptCodePos - this.scriptCodeOffset;
      return true;
    }
    return false;
  }

  ReadTableValues(text: string): void {
    const E = this.E;
    let value = "";
    let i = 0;
    const flush = () => {
      ++E.scriptCode[this.scriptCodeOffset];
      const n = ConvertStringToInteger(value);
      if (n === null) this.warn(`unable to parse table value "${value}" as an int`);
      E.scriptCode[this.scriptCodePos++] = n ?? 0;
      value = "";
    };
    while (i < text.length) {
      value += text[i++];
      while (text[i] === ",") {
        flush();
        i++;
      }
    }
    if (value.length) flush();
  }

  ParseScriptFile(scriptName: string, scriptID: number): void {
    const E = this.E;
    this.currentScript = scriptName;
    this.jumpTableStackPos = 0;
    this.lineID = 0;

    for (let f = 0; f < this.scriptFunctionCount; ++f) if (E.scriptFunctionList[f].access !== ACCESS_PUBLIC) E.scriptFunctionList[f].name = "";

    let newCount = COMMON_SCRIPT_VAR_COUNT;
    for (let v = COMMON_SCRIPT_VAR_COUNT; v < this.scriptValueListCount; ++v) {
      if (this.scriptValueList[v].access === ACCESS_PUBLIC) this.scriptValueList[newCount++] = this.scriptValueList[v];
    }
    this.scriptValueListCount = newCount;
    this.scriptValueList.length = newCount;

    const data = E.vfs.get("Data/Scripts/" + scriptName);
    if (!data) {
      this.fail(`script not found: ${scriptName}`);
      return;
    }
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
      let disableLineIncrement = false;
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
          if (curChar === 10 || curChar === 59) {
            readMode = READMODE_ENDLINE;
            if (curChar === 59) disableLineIncrement = true;
          }
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
          if (!disableLineIncrement) ++this.lineID;
          this.CheckAliasText(scriptText);
          this.CheckStaticText(scriptText);
          if (this.CheckTableText(scriptText)) {
            parseMode = PARSEMODE_TABLEREAD;
            scriptText = "";
          }
          const os = E.objectScriptList[scriptID];
          if (StrComp(scriptText, "eventObjectUpdate")) {
            parseMode = PARSEMODE_FUNCTION;
            os.eventUpdate.scriptCodePtr = this.scriptCodePos;
            os.eventUpdate.jumpTablePtr = this.jumpTablePos;
            this.scriptCodeOffset = this.scriptCodePos;
            this.jumpTableOffset = this.jumpTablePos;
          }
          if (StrComp(scriptText, "eventObjectDraw")) {
            parseMode = PARSEMODE_FUNCTION;
            os.eventDraw.scriptCodePtr = this.scriptCodePos;
            os.eventDraw.jumpTablePtr = this.jumpTablePos;
            this.scriptCodeOffset = this.scriptCodePos;
            this.jumpTableOffset = this.jumpTablePos;
          }
          if (StrComp(scriptText, "eventObjectStartup")) {
            parseMode = PARSEMODE_FUNCTION;
            os.eventStartup.scriptCodePtr = this.scriptCodePos;
            os.eventStartup.jumpTablePtr = this.jumpTablePos;
            this.scriptCodeOffset = this.scriptCodePos;
            this.jumpTableOffset = this.jumpTablePos;
          }
          if (FindStringToken(scriptText, "reservefunction", 1) === 0) {
            const funcName = scriptText.slice(15);
            let funcID = -1;
            for (let i = 0; i < this.scriptFunctionCount; ++i) if (StrComp(funcName, E.scriptFunctionList[i].name)) funcID = i;
            if (this.scriptFunctionCount < FUNCTION_COUNT && funcID === -1) E.scriptFunctionList[this.scriptFunctionCount++].name = funcName;
            else this.warn(`function ${funcName} has already been reserved`);
            parseMode = PARSEMODE_SCOPELESS;
          } else {
            for (const [kw, access] of [["publicfunction", ACCESS_PUBLIC], ["privatefunction", ACCESS_PRIVATE]] as const) {
              if (FindStringToken(scriptText, kw, 1) !== 0) continue;
              const funcName = scriptText.slice(kw.length);
              let funcID = -1;
              for (let i = 0; i < this.scriptFunctionCount; ++i) if (StrComp(funcName, E.scriptFunctionList[i].name)) funcID = i;
              if (funcID <= -1) {
                if (this.scriptFunctionCount >= FUNCTION_COUNT) parseMode = PARSEMODE_SCOPELESS;
                else funcID = this.scriptFunctionCount++;
              }
              if (funcID > -1) {
                const fn = E.scriptFunctionList[funcID];
                fn.name = funcName;
                fn.access = access;
                fn.ptr.scriptCodePtr = this.scriptCodePos;
                fn.ptr.jumpTablePtr = this.jumpTablePos;
                this.scriptCodeOffset = this.scriptCodePos;
                this.jumpTableOffset = this.jumpTablePos;
                parseMode = PARSEMODE_FUNCTION;
              }
              break;
            }
          }
          break;
        }
        case PARSEMODE_PLATFORMSKIP:
          if (!disableLineIncrement) ++this.lineID;
          if (FindStringToken(scriptText, "#endplatform", 1) === 0) parseMode = PARSEMODE_FUNCTION;
          break;

        case PARSEMODE_FUNCTION:
          if (!disableLineIncrement) ++this.lineID;
          if (scriptText.length) {
            if (StrComp(scriptText, "endevent")) {
              E.scriptCode[this.scriptCodePos++] = FUNC_END;
              parseMode = PARSEMODE_SCOPELESS;
            } else if (StrComp(scriptText, "endfunction")) {
              E.scriptCode[this.scriptCodePos++] = FUNC_RETURN;
              parseMode = PARSEMODE_SCOPELESS;
            } else if (FindStringToken(scriptText, "#platform:", 1) === 0) {
              if (!PLATFORM_TOKENS.some((t) => FindStringToken(scriptText, t, 1) !== -1)) parseMode = PARSEMODE_PLATFORMSKIP;
            } else if (FindStringToken(scriptText, "#endplatform", 1) === -1) {
              scriptText = this.ConvertConditionalStatement(scriptText);
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

        case PARSEMODE_TABLEREAD:
          if (!disableLineIncrement) ++this.lineID;
          if (FindStringToken(scriptText, "endtable", 1) === 0) parseMode = PARSEMODE_SCOPELESS;
          else if (scriptText.length >= 1) this.ReadTableValues(scriptText);
          break;

        default:
          break;
      }
      if (parseMode === PARSEMODE_ERROR) return;
      // a switch read rewinds the file, so EOF may have been hit only while scanning ahead
      if (readMode === READMODE_EOF && parseMode === PARSEMODE_FUNCTION && f.pos < f.size) readMode = READMODE_NORMAL;
    }
  }
}

export function getSceneID(E: Engine, listID: number, sceneName: string): number {
  if (listID >= 3) return -1;
  const name = sceneName.replace(/ /g, "");
  for (let s = 0; s < E.stageListCount[listID]; ++s) if (StrComp(name, E.stageList[listID][s].name.replace(/ /g, ""))) return s;
  return -1;
}

export const SCRIPT_CONSTS = { SCRIPTVAR_VAR, SCRIPTVAR_INTCONST, SCRIPTVAR_STRCONST, VARARR_NONE, VARARR_ARRAY, VARARR_ENTNOPLUS1, VARARR_ENTNOMINUS1 };
