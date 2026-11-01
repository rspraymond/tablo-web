import type { GuideChannel, GridChannel, Program, Recording } from "../api/tablo";

export type ContentFilter = "all" | "movies" | "sports" | "news" | "reality" | "documentary" | "ota" | "fast";

/** Live-tab filter: matches on the currently airing program only.
 *  Grid rows use channelMatchesFilter instead, which matches any airing today. */
export function matchesContentFilter(ch: GuideChannel, f: ContentFilter): boolean {
  if (f === "all") return true;
  if (f === "ota")  return ch.kind === "ota";
  if (f === "fast") return ch.kind === "ott";
  const prog = ch.current_program;
  if (!prog) return false;
  const genres = prog.genres ?? [];
  if (f === "movies")       return prog.kind === "movieAiring";
  if (f === "sports")       return prog.kind === "sportEvent" || genres.some(g => /sport/i.test(g));
  if (f === "news")         return genres.some(g => /news/i.test(g));
  if (f === "reality")      return genres.some(g => /reality/i.test(g));
  if (f === "documentary")  return genres.some(g => /documentary/i.test(g));
  return true;
}

/** Per-airing genre match used by grid rows. ota/fast are channel-level kinds,
 *  so they return false here and are checked by channelMatchesFilter. */
export function airingMatchesFilter(air: Program, f: ContentFilter): boolean {
  if (f === "all") return true;
  const genres = air.genres ?? [];
  if (f === "movies")       return air.kind === "movieAiring";
  if (f === "sports")       return air.kind === "sportEvent" || genres.some(g => /sport/i.test(g));
  if (f === "news")         return genres.some(g => /news/i.test(g));
  if (f === "reality")      return genres.some(g => /reality/i.test(g));
  if (f === "documentary")  return genres.some(g => /documentary/i.test(g));
  return false; // ota/fast handled at channel level
}

export function channelMatchesFilter(ch: GridChannel, f: ContentFilter): boolean {
  if (f === "all")  return true;
  if (f === "ota")  return ch.kind === "ota";
  if (f === "fast") return ch.kind === "ott";
  return ch.airings.some(a => airingMatchesFilter(a, f));
}

// ── Header search (shared across all tabs) ─────────────────────────────────

function includes(q: string, ...fields: (string | null | undefined)[]): boolean {
  const s = q.toLowerCase();
  return fields.some(f => (f ?? "").toLowerCase().includes(s));
}

/** Live guide row: call sign, network, display name, or current program title. */
export function guideRowMatchesSearch(ch: GuideChannel, q: string): boolean {
  if (!q) return true;
  return includes(q, ch.call_sign, ch.network, ch.display_name, ch.current_program?.title);
}

/** Grid row: call sign, network, display name, or any airing title. */
export function gridRowMatchesSearch(ch: GridChannel, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    includes(s, ch.call_sign, ch.network, ch.display_name) ||
    ch.airings.some(a => (a.title ?? "").toLowerCase().includes(s))
  );
}

/** Library recording: title or description. */
export function recordingMatchesSearch(rec: Recording, q: string): boolean {
  if (!q) return true;
  return includes(q, rec.title, rec.description);
}

/** "S38 E4 · Cairo" when season/episode are present, episode title alone
 *  otherwise, null when nothing is known (movies, sports). */
export function episodeLabel(air: Program | null | undefined): string | null {
  if (!air) return null;
  const s = air.season_number ?? 0;
  const e = air.episode_number ?? 0;
  const title = air.episode_title;
  if (s > 0 && e > 0) return title ? `S${s} E${e} · ${title}` : `S${s} E${e}`;
  if (title) return title;
  return null;
}
