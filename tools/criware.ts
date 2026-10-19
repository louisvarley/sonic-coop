// Reading Sonic Origins' CRIWARE audio packs: ACB cue sheets, AFS2 (.awb) wave banks and encrypted HCA streams.
// Format references: vgmstream (src/meta/acb.c, awb.c, src/coding/libs/clhca.c) and the RSDK Modding wiki.

const td = new TextDecoder("utf-8");

export type UtfValue = number | bigint | string | Uint8Array | null;
export interface UtfTable {
  name: string;
  rows: Record<string, UtfValue>[];
}

/** An @UTF table (ACB files and the tables nested inside them). */
export function readUtf(bytes: Uint8Array): UtfTable {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "@UTF") throw new Error("not an @UTF table");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = 8;
  const rowsOffset = dv.getUint16(0x0a) + base;
  const stringsOffset = dv.getUint32(0x0c) + base;
  const dataOffset = dv.getUint32(0x10) + base;
  const nameOffset = dv.getUint32(0x14);
  const columnCount = dv.getUint16(0x18);
  const rowWidth = dv.getUint16(0x1a);
  const rowCount = dv.getUint32(0x1c);
  const str = (offset: number) => {
    const start = stringsOffset + offset;
    let end = start;
    while (bytes[end] !== 0) end++;
    return td.decode(bytes.subarray(start, end));
  };
  // Reads one value of `type` at `pos`; returns [value, size].
  const value = (type: number, pos: number): [UtfValue, number] => {
    switch (type) {
      case 0x0: return [dv.getUint8(pos), 1];
      case 0x1: return [dv.getInt8(pos), 1];
      case 0x2: return [dv.getUint16(pos), 2];
      case 0x3: return [dv.getInt16(pos), 2];
      case 0x4: return [dv.getUint32(pos), 4];
      case 0x5: return [dv.getInt32(pos), 4];
      case 0x6: return [dv.getBigUint64(pos), 8];
      case 0x7: return [dv.getBigInt64(pos), 8];
      case 0x8: return [dv.getFloat32(pos), 4];
      case 0x9: return [dv.getFloat64(pos), 8];
      case 0xa: return [str(dv.getUint32(pos)), 4];
      case 0xb: {
        const offset = dv.getUint32(pos), size = dv.getUint32(pos + 4);
        return [size ? bytes.subarray(dataOffset + offset, dataOffset + offset + size) : null, 8];
      }
      default: throw new Error(`unknown @UTF column type ${type}`);
    }
  };
  const columns: { name: string; storage: number; type: number; constant: UtfValue }[] = [];
  let pos = 0x20;
  for (let c = 0; c < columnCount; c++) {
    const flags = bytes[pos];
    const name = str(dv.getUint32(pos + 1));
    pos += 5;
    const storage = flags & 0xf0, type = flags & 0x0f;
    let constant: UtfValue = null;
    if (storage === 0x30) {
      const [v, size] = value(type, pos);
      constant = v;
      pos += size;
    }
    columns.push({ name, storage, type, constant });
  }
  const rows: Record<string, UtfValue>[] = [];
  for (let r = 0; r < rowCount; r++) {
    let p = rowsOffset + r * rowWidth;
    const row: Record<string, UtfValue> = {};
    for (const col of columns) {
      if (col.storage === 0x50) {
        const [v, size] = value(col.type, p);
        row[col.name] = v;
        p += size;
      } else {
        row[col.name] = col.storage === 0x30 ? col.constant : null;
      }
    }
    rows.push(row);
  }
  return { name: str(nameOffset), rows };
}

export interface Afs2Entry {
  id: number;
  data: Uint8Array;
}
export interface Afs2 {
  entries: Afs2Entry[];
}

/** An AFS2 wave bank: a .awb file, or the memory bank embedded in an .acb. */
export function readAfs2(bytes: Uint8Array): Afs2 {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "AFS2") throw new Error("not an AFS2 wave bank");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsetSize = bytes[5];
  const idSize = bytes[6];
  const count = dv.getUint32(8, true);
  const alignment = dv.getUint16(0x0c, true);
  const idAt = (i: number) => (idSize === 4 ? dv.getUint32(0x10 + i * 4, true) : dv.getUint16(0x10 + i * idSize, true));
  const offsetsStart = 0x10 + count * idSize;
  const offsetAt = (i: number) => (offsetSize === 4 ? dv.getUint32(offsetsStart + i * 4, true) : dv.getUint16(offsetsStart + i * 2, true));
  const entries: Afs2Entry[] = [];
  for (let i = 0; i < count; i++) {
    let start = offsetAt(i);
    start = Math.ceil(start / alignment) * alignment;
    const end = offsetAt(i + 1);
    entries.push({ id: idAt(i), data: bytes.subarray(start, end) });
  }
  return { entries };
}

// ---- HCA ---------------------------------------------------------------------------------------------------------

function crc16(data: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= data[i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function nibbleTable(key: number): Uint8Array {
  const out = new Uint8Array(16);
  const mul = ((key & 1) << 3) | 5;
  const add = (key & 0xe) | 1;
  key >>= 4;
  for (let i = 0; i < 16; i++) {
    key = (key * mul + add) & 0xf;
    out[i] = key;
  }
  return out;
}

/** The byte substitution table for HCA cipher type 56. */
export function cipher56(keycode: bigint): Uint8Array {
  if (keycode !== 0n) keycode -= 1n;
  const kc = new Uint8Array(7);
  for (let i = 0; i < 7; i++) {
    kc[i] = Number(keycode & 0xffn);
    keycode >>= 8n;
  }
  const seed = [
    kc[1], kc[1] ^ kc[6], kc[2] ^ kc[3], kc[2], kc[2] ^ kc[1], kc[3] ^ kc[4], kc[3], kc[3] ^ kc[2],
    kc[4] ^ kc[5], kc[4], kc[4] ^ kc[3], kc[5] ^ kc[6], kc[5], kc[5] ^ kc[4], kc[6] ^ kc[1], kc[6],
  ];
  const rowTable = nibbleTable(kc[0]);
  const base = new Uint8Array(256);
  for (let r = 0; r < 16; r++) {
    const col = nibbleTable(seed[r]);
    for (let c = 0; c < 16; c++) base[r * 16 + c] = (rowTable[r] << 4) | col[c];
  }
  const table = new Uint8Array(256);
  let x = 0, pos = 1;
  for (let i = 0; i < 256; i++) {
    x = (x + 17) & 0xff;
    if (base[x] !== 0 && base[x] !== 0xff) table[pos++] = base[x];
  }
  table[0] = 0;
  table[0xff] = 0xff;
  return table;
}

export interface HcaInfo {
  channels: number;
  sampleRate: number;
  frames: number;
  /** Loop start/end in samples, when the stream loops. */
  loop: { start: number; end: number } | null;
}

/**
 * Decrypts an HCA stream into a plain (cipher type 0) one that any HCA decoder can play.
 * Sonic Origins uses each pack's keycode as is: mixing in the AFS2 subkey (as some other games need) yields noise.
 * A wrong key cannot be detected here (the cipher keeps 0x00 and 0xFF, so frame sync words survive it).
 */
export function decryptHca(input: Uint8Array, keycode: bigint): { hca: Uint8Array; info: HcaInfo } {
  const hca = input.slice();
  const dv = new DataView(hca.buffer);
  // Chunk names of encrypted streams have their top bits set.
  const tag = (pos: number) => String.fromCharCode(...hca.subarray(pos, pos + 4).map((b) => b & 0x7f));
  const unmask = (pos: number) => { for (let i = 0; i < 4; i++) hca[pos + i] &= 0x7f; };
  if (tag(0) !== "HCA\0") throw new Error("not an HCA stream");
  unmask(0);
  const headerSize = dv.getUint16(6);
  let frameSize = 0, cipherType = 0, channels = 0, sampleRate = 0, frames = 0, encoderDelay = 0;
  let loop: HcaInfo["loop"] = null, ciphPos = -1;
  for (let pos = 8; pos < headerSize - 2;) {
    const name = tag(pos);
    unmask(pos);
    if (name === "fmt\0") {
      channels = hca[pos + 4];
      sampleRate = (hca[pos + 5] << 16) | (hca[pos + 6] << 8) | hca[pos + 7];
      frames = dv.getUint32(pos + 8);
      encoderDelay = dv.getUint16(pos + 12);
      pos += 16;
    } else if (name === "comp" || name === "dec\0") {
      frameSize = dv.getUint16(pos + 4);
      pos += name === "comp" ? 16 : 12;
    } else if (name === "vbr\0") {
      pos += 8;
    } else if (name === "ath\0") {
      pos += 6;
    } else if (name === "loop") {
      const startFrame = dv.getUint32(pos + 4), endFrame = dv.getUint32(pos + 8);
      const startDelay = dv.getUint16(pos + 12), endPadding = dv.getUint16(pos + 14);
      loop = { start: startFrame * 1024 + startDelay - encoderDelay, end: (endFrame + 1) * 1024 - endPadding - encoderDelay };
      pos += 16;
    } else if (name === "ciph") {
      cipherType = dv.getUint16(pos + 4);
      ciphPos = pos;
      pos += 6;
    } else if (name === "rva\0") {
      pos += 8;
    } else if (name === "comm") {
      pos += 5;
      while (hca[pos] !== 0 && pos < headerSize) pos++;
      pos++;
    } else if (name === "pad\0") {
      break;
    } else {
      throw new Error(`unknown HCA header chunk "${name}"`);
    }
  }
  if (!frameSize) throw new Error("HCA stream has no frame size");
  if (cipherType !== 0 && cipherType !== 1 && cipherType !== 56) throw new Error(`unsupported HCA cipher ${cipherType}`);
  if (cipherType === 1) throw new Error("HCA cipher type 1 is not used by Sonic Origins");
  if (ciphPos >= 0) dv.setUint16(ciphPos + 4, 0);
  dv.setUint16(headerSize - 2, crc16(hca, 0, headerSize - 2));
  if (cipherType === 56) {
    const table = cipher56(keycode);
    for (let f = 0; f < frames; f++) {
      const start = headerSize + f * frameSize;
      if (start + frameSize > hca.length) break;
      for (let i = start; i < start + frameSize - 2; i++) hca[i] = table[hca[i]];
      dv.setUint16(start + frameSize - 2, crc16(hca, start, start + frameSize - 2));
    }
  }
  return { hca, info: { channels, sampleRate, frames, loop } };
}

// ---- ACB ---------------------------------------------------------------------------------------------------------

export interface AcbWave {
  /** Wave bank entry id: the "ID" column of the RSDK Modding wiki's Origins audio tables. */
  id: number;
  streaming: boolean;
  /** Cue names that play this wave. */
  cues: string[];
}

/** The cue names and waveforms of an ACB, plus its embedded (memory) wave bank. */
export function readAcb(bytes: Uint8Array): { name: string; waves: AcbWave[]; memory: Afs2 | null } {
  const header = readUtf(bytes).rows[0];
  const table = (name: string) => (header[name] instanceof Uint8Array ? readUtf(header[name] as Uint8Array).rows : []);
  const waveforms = table("WaveformTable");
  const synths = table("SynthTable");
  const cueNames = table("CueNameTable");
  const cueTable = table("CueTable");
  const sequences = table("SequenceTable");
  const tracks = table("TrackTable");
  const events = table("TrackEventTable").length ? table("TrackEventTable") : table("CommandTable");

  const waves: AcbWave[] = waveforms.map((w) => {
    const streaming = Number(w.Streaming ?? 0) === 1;
    const id = Number(w.Id ?? (streaming ? w.StreamAwbId : w.MemoryAwbId));
    return { id, streaming, cues: [] };
  });

  // Cue -> waveform resolution (vgmstream acb.c): cues reference waveforms, synths or sequences; sequences hold
  // tracks whose event commands point at synths; synths list waveforms (or further synths).
  const u16s = (v: UtfValue) => {
    const out: number[] = [];
    if (v instanceof Uint8Array) for (let i = 0; i + 1 < v.length; i += 2) out.push((v[i] << 8) | v[i + 1]);
    return out;
  };
  const fromSynth = (index: number, out: Set<number>, depth: number) => {
    if (depth > 8 || !synths[index]) return;
    const items = u16s(synths[index].ReferenceItems);
    for (let i = 0; i + 1 < items.length; i += 2) {
      const [type, ref] = [items[i], items[i + 1]];
      if (type === 1) out.add(ref);
      else if (type === 2) fromSynth(ref, out, depth + 1);
      else if (type === 3) fromSequence(ref, out, depth + 1);
    }
  };
  const fromCommand = (command: UtfValue, out: Set<number>, depth: number) => {
    if (!(command instanceof Uint8Array)) return;
    for (let pos = 0; pos + 3 <= command.length;) {
      const code = (command[pos] << 8) | command[pos + 1];
      const size = command[pos + 2];
      pos += 3;
      // 0x07D0 (note on) and 0x07D1 carry a (type, index) reference.
      if ((code === 0x07d0 || code === 0x07d1) && size >= 4) {
        const type = (command[pos] << 8) | command[pos + 1];
        const index = (command[pos + 2] << 8) | command[pos + 3];
        if (type === 0x02) fromSynth(index, out, depth + 1);
        else if (type === 0x03) fromSequence(index, out, depth + 1);
      }
      pos += size;
    }
  };
  const fromSequence = (index: number, out: Set<number>, depth: number) => {
    if (depth > 8 || !sequences[index]) return;
    for (const t of u16s(sequences[index].TrackIndex)) {
      const track = tracks[t];
      if (!track) continue;
      const event = events[Number(track.EventIndex)];
      if (event) fromCommand(event.Command, out, depth);
    }
  };

  for (const cn of cueNames) {
    const cue = cueTable[Number(cn.CueIndex)];
    if (!cue) continue;
    const found = new Set<number>();
    const type = Number(cue.ReferenceType), index = Number(cue.ReferenceIndex);
    if (type === 1) found.add(index);
    else if (type === 2) fromSynth(index, found, 0);
    else if (type === 3) fromSequence(index, found, 0);
    for (const w of found) waves[w]?.cues.push(String(cn.CueName));
  }

  const memory = header.AwbFile instanceof Uint8Array ? readAfs2(header.AwbFile) : null;
  return { name: String(header.Name ?? ""), waves, memory };
}
