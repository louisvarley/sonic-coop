import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePak } from "../packages/engine/src/core/pak.js";
import { rsdkPathKey } from "../packages/engine/src/core/md5.js";

describe("client game data revisions", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("versions pack requests and reuses a pack only while its manifest version is current", async () => {
    let version = "2026-10-19T15:32:45.358Z";
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return Response.json({ extractedAt: version, coreBytes: 12, audio: {} });
      return new Response(writePak([{ key: rsdkPathKey("revision"), data: new TextEncoder().encode(version) }]));
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadGameData } = await import("../apps/client/src/game/data.js");
    const first = await loadGameData("soniccd", () => {});
    expect(new TextDecoder().decode(first.vfs.get("revision"))).toBe(version);
    expect(fetcher).toHaveBeenCalledWith("/data/soniccd/manifest.json", { cache: "no-cache" });
    expect(fetcher).toHaveBeenCalledWith(`/data/soniccd/core.pak?v=${encodeURIComponent(version)}`);
    await loadGameData("soniccd", () => {});
    expect(fetcher).toHaveBeenCalledTimes(3);

    version = "2026-10-19T16:00:00.000Z";
    const updated = await loadGameData("soniccd", () => {});
    expect(new TextDecoder().decode(updated.vfs.get("revision"))).toBe(version);
    expect(fetcher).toHaveBeenCalledWith(`/data/soniccd/core.pak?v=${encodeURIComponent(version)}`);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("reports a failed download and retries instead of caching the failure", async () => {
    let fail = true;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return Response.json({ extractedAt: "revision-1", coreBytes: 12, audio: {} });
      return fail ? new Response("", { status: 503 }) : new Response(writePak([]));
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadGameData } = await import("../apps/client/src/game/data.js");
    await expect(loadGameData("soniccd", () => {})).rejects.toThrow("(503)");
    fail = false;
    await expect(loadGameData("soniccd", () => {})).resolves.toHaveProperty("vfs");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rejects an unversioned manifest rather than serving an unversioned pack", async () => {
    const fetcher = vi.fn(async () => Response.json({ coreBytes: 12, audio: {} }));
    vi.stubGlobal("fetch", fetcher);
    const { loadGameData } = await import("../apps/client/src/game/data.js");
    await expect(loadGameData("soniccd", () => {})).rejects.toThrow("no extraction version");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
