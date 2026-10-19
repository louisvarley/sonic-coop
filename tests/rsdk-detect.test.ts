import { describe, expect, it } from "vitest";
import { detectRsdkPack } from "../tools/rsdk-detect.js";

describe("rsdk detection", () => {
  it("reports unknown for non-RSDK data", () => {
    const result = detectRsdkPack(new TextEncoder().encode("not an rsdk file"), "x.rsdk");
    expect(result).toMatchObject({ format: "unknown", game: "unknown", supported: false });
  });

  it("recognises the format from the signature even when the contents are unreadable", () => {
    const result = detectRsdkPack(new TextEncoder().encode("RSDKvB\0\0"), "renamed.bin");
    expect(result).toMatchObject({ format: "v4", game: "unknown" });
  });
});
