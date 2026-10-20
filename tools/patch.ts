// Exact-text edits applied to the decompiled game scripts at extraction time.
// Each edit must match exactly once (or exactly `count` times), so an upstream change can never silently skip a patch.

export interface ScriptPatch {
  /** Script path relative to the game's Scripts folder, e.g. "Players/Player2Object.txt". */
  file: string;
  /** Why this edit exists (shown in reports). */
  reason: string;
  find: string;
  replace: string;
  /** Edit every one of exactly this many identical occurrences (for code the original repeats verbatim). */
  count?: number;
}

export function applyPatches(sources: Map<string, string>, patches: ScriptPatch[]): void {
  for (const p of patches) {
    const raw = sources.get(p.file);
    if (raw === undefined) throw new Error(`patch target missing: ${p.file} (${p.reason})`);
    // Trailing whitespace is meaningless to the script compiler; ignore it on both sides.
    const text = raw.replace(/[ \t]+(\r?\n)/g, "$1");
    // Scripts use CRLF line endings; patches are written with LF.
    const crlf = text.includes("\r\n");
    const find = (crlf ? p.find.replace(/\r?\n/g, "\r\n") : p.find).replace(/[ \t]+(\r?\n)/g, "$1");
    const replace = crlf ? p.replace.replace(/\r?\n/g, "\r\n") : p.replace;
    const first = text.indexOf(find);
    if (first < 0) throw new Error(`patch did not match in ${p.file}: ${p.reason}`);
    if (p.count !== undefined) {
      const parts = text.split(find);
      if (parts.length - 1 !== p.count) throw new Error(`patch matched ${parts.length - 1} times (expected ${p.count}) in ${p.file}: ${p.reason}`);
      sources.set(p.file, parts.join(replace));
      continue;
    }
    if (text.indexOf(find, first + 1) >= 0) throw new Error(`patch matched more than once in ${p.file}: ${p.reason}`);
    sources.set(p.file, text.slice(0, first) + replace + text.slice(first + find.length));
  }
}
