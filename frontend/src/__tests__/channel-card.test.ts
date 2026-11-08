import { describe, it, expect } from "vitest";
import type { GuideChannel } from "../api/tablo";
import { badgesFor } from "../lib/filters";

// ── helpers ────────────────────────────────────────────────────────────────

function makeChannel(qualifiers: unknown, program: boolean = true): GuideChannel {
  return {
    identifier: "test",
    call_sign: "TEST",
    major: 1,
    minor: 1,
    network: "Test",
    kind: "ota",
    display_name: "Test Channel",
    logo_url: null,
    current_program: program
      ? {
          title: "Test Show",
          description: null,
          start: new Date().toISOString(),
          duration: 3600,
          qualifiers: qualifiers as string[],
        }
      : null,
  };
}

// ── badgesFor ───────────────────────────────────────────────────────────────

describe("badgesFor", () => {
  it("flags live and cc from string qualifiers", () => {
    const badges = badgesFor(makeChannel(["live", "cc", "primetime"]));
    expect(badges.map(b => b.kind)).toEqual(["live", "cc"]);
  });

  it("does not crash when the API sends an int bitmask (regression)", () => {
    // Cloud airings used to leak raw ints (8, 11, 3) before backend normalization
    expect(badgesFor(makeChannel(8))).toEqual([]);
    expect(badgesFor(makeChannel(11))).toEqual([]);
  });

  it("no badges when program is absent", () => {
    expect(badgesFor(makeChannel(["live"], false))).toEqual([]);
  });
});