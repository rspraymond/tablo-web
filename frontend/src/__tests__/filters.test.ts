import { describe, it, expect } from "vitest";
import type { GuideChannel, GridChannel, Program, Recording } from "../api/tablo";
import {
  matchesContentFilter,
  channelMatchesFilter,
  guideRowMatchesSearch,
  gridRowMatchesSearch,
  recordingMatchesSearch,
  episodeLabel,
} from "../lib/filters";

// ── helpers ────────────────────────────────────────────────────────────────

function makeGuide(kind: string, program?: Partial<Program>): GuideChannel {
  return {
    identifier: "test",
    call_sign: "TEST",
    major: 1,
    minor: 1,
    network: "Test",
    kind,
    display_name: "Test Channel",
    logo_url: null,
    current_program: program
      ? { title: "Test Show", description: null, start: new Date().toISOString(), duration: 3600, ...program }
      : null,
  };
}

function makeGrid(kind: string, airings: Partial<Program>[] = []): GridChannel {
  return {
    identifier: "test",
    call_sign: "TEST",
    major: 1,
    minor: 1,
    network: "Test",
    kind,
    display_name: "Test Channel",
    logo_url: null,
    airings: airings.map(a => ({
      title: "Test", description: null,
      start: new Date().toISOString(), duration: 3600, ...a,
    })),
  };
}

// ── Live TV filter tests ────────────────────────────────────────────────────

describe("matchesContentFilter (Live TV)", () => {
  it("all passes everything", () => {
    expect(matchesContentFilter(makeGuide("ota"), "all")).toBe(true);
    expect(matchesContentFilter(makeGuide("ott"), "all")).toBe(true);
  });

  it("ota matches only ota channels", () => {
    expect(matchesContentFilter(makeGuide("ota"), "ota")).toBe(true);
    expect(matchesContentFilter(makeGuide("ott"), "ota")).toBe(false);
  });

  it("fast matches only ott channels", () => {
    expect(matchesContentFilter(makeGuide("ott"), "fast")).toBe(true);
    expect(matchesContentFilter(makeGuide("ota"), "fast")).toBe(false);
  });

  it("movies matches movieAiring kind", () => {
    expect(matchesContentFilter(makeGuide("ota", { kind: "movieAiring" }), "movies")).toBe(true);
    expect(matchesContentFilter(makeGuide("ota", { kind: "episode" }), "movies")).toBe(false);
  });

  it("sports matches sportEvent kind", () => {
    expect(matchesContentFilter(makeGuide("ota", { kind: "sportEvent" }), "sports")).toBe(true);
  });

  it("sports matches Sports genre", () => {
    expect(matchesContentFilter(makeGuide("ota", { genres: ["Sports"] }), "sports")).toBe(true);
  });

  it("news matches News genre", () => {
    expect(matchesContentFilter(makeGuide("ota", { genres: ["News"] }), "news")).toBe(true);
    expect(matchesContentFilter(makeGuide("ota", { genres: ["Comedy"] }), "news")).toBe(false);
  });

  it("reality matches Reality genre case-insensitively", () => {
    expect(matchesContentFilter(makeGuide("ota", { genres: ["Reality"] }), "reality")).toBe(true);
    expect(matchesContentFilter(makeGuide("ota", { genres: ["reality tv"] }), "reality")).toBe(true);
  });

  it("documentary matches Documentary genre", () => {
    expect(matchesContentFilter(makeGuide("ota", { genres: ["Documentary"] }), "documentary")).toBe(true);
  });

  it("returns false when program is null for content filters", () => {
    expect(matchesContentFilter(makeGuide("ota"), "movies")).toBe(false);
    expect(matchesContentFilter(makeGuide("ota"), "news")).toBe(false);
  });
});

// ── Guide Grid filter tests ─────────────────────────────────────────────────

describe("channelMatchesFilter (Guide Grid)", () => {
  it("all passes everything", () => {
    expect(channelMatchesFilter(makeGrid("ota"), "all")).toBe(true);
  });

  it("ota / fast filter by channel kind", () => {
    expect(channelMatchesFilter(makeGrid("ota"), "ota")).toBe(true);
    expect(channelMatchesFilter(makeGrid("ott"), "fast")).toBe(true);
    expect(channelMatchesFilter(makeGrid("ota"), "fast")).toBe(false);
  });

  it("movies matches if any airing is movieAiring", () => {
    const ch = makeGrid("ota", [{ kind: "episode" }, { kind: "movieAiring" }]);
    expect(channelMatchesFilter(ch, "movies")).toBe(true);
  });

  it("no match if no airings have the right genre", () => {
    const ch = makeGrid("ota", [{ kind: "episode", genres: ["Comedy"] }]);
    expect(channelMatchesFilter(ch, "news")).toBe(false);
  });
});

// ── Header search (shared across all tabs) ──────────────────────────────────

describe("guideRowMatchesSearch", () => {
  it("empty query matches everything", () => {
    expect(guideRowMatchesSearch(makeGuide("ota"), "")).toBe(true);
  });

  it("matches call sign, network, display name", () => {
    const ch = makeGuide("ota");
    expect(guideRowMatchesSearch(ch, "TEST")).toBe(true);
    expect(guideRowMatchesSearch(ch, "Test Channel")).toBe(true);
    expect(guideRowMatchesSearch(ch, "unrelated")).toBe(false);
  });

  it("matches current program title", () => {
    const ch = makeGuide("ota", { title: "NCIS" });
    expect(guideRowMatchesSearch(ch, "ncis")).toBe(true);
    expect(guideRowMatchesSearch(ch, "unrelated")).toBe(false);
  });
});

describe("gridRowMatchesSearch", () => {
  it("empty query matches everything", () => {
    expect(gridRowMatchesSearch(makeGrid("ota"), "")).toBe(true);
  });

  it("matches channel identity fields", () => {
    const ch = makeGrid("ota");
    expect(gridRowMatchesSearch(ch, "TEST")).toBe(true);
    expect(gridRowMatchesSearch(ch, "Test Channel")).toBe(true);
  });

  it("matches any airing title", () => {
    const ch = makeGrid("ota", [{ title: "NCIS" }, { title: "Other" }]);
    expect(gridRowMatchesSearch(ch, "ncis")).toBe(true);
    expect(gridRowMatchesSearch(ch, "unrelated")).toBe(false);
  });
});

describe("recordingMatchesSearch", () => {
  function makeRec(partial: Partial<Recording> = {}): Recording {
    return {
      identifier: 1,
      path: "/recordings/1",
      title: "NCIS",
      description: "Lucky and the team investigate a missing officer.",
      start: new Date().toISOString(),
      duration: 3600,
      thumbnail: null,
      ...partial,
    };
  }

  it("empty query matches everything", () => {
    expect(recordingMatchesSearch(makeRec(), "")).toBe(true);
  });

  it("matches title or description", () => {
    expect(recordingMatchesSearch(makeRec(), "ncis")).toBe(true);
    expect(recordingMatchesSearch(makeRec(), "missing officer")).toBe(true);
    expect(recordingMatchesSearch(makeRec(), "unrelated")).toBe(false);
  });
});

// ── Episode label ────────────────────────────────────────────────────────────

describe("episodeLabel", () => {
  it("returns null for null program", () => {
    expect(episodeLabel(null)).toBeNull();
  });

  it("returns S/E with title when both present", () => {
    const p: Program = { title: "NCIS", description: null, start: "", duration: 0,
      season_number: 38, episode_number: 4, episode_title: "Cairo" };
    expect(episodeLabel(p)).toBe("S38 E4 · Cairo");
  });

  it("returns S/E without title", () => {
    const p: Program = { title: "NCIS", description: null, start: "", duration: 0,
      season_number: 21, episode_number: 4 };
    expect(episodeLabel(p)).toBe("S21 E4");
  });

  it("returns episode title alone when S/E absent", () => {
    const p: Program = { title: "X", description: null, start: "", duration: 0,
      episode_title: "Broken" };
    expect(episodeLabel(p)).toBe("Broken");
  });

  it("returns null for movies/sports (no episode data)", () => {
    const p: Program = { title: "Movie", description: null, start: "", duration: 0, kind: "movieAiring" };
    expect(episodeLabel(p)).toBeNull();
  });
});
