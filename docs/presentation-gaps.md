# Presentation Gaps in tablo-web

**Available data vs. what the UI actually renders**

- **Date:** 2026-11-11
- **Scope:** Every metadata field the backend can access (Tablo device :8885, Tablo cloud, local state) compared against what the React UI renders.
- **Method:** Read every frontend component and backend route; extracted `tablo_api` models from the running container; sampled live device responses (40 airing details, channel details, `/server/info`) from device `SID_5087B8610F05` (Tablo 4G DUAL 128GB, firmware 2.2.58); curled the live API through `https://tablo.dev.localhost`.

---

## The data funnel and its three seams

Every byte the user sees travels the same path:

```
Tablo device (:8885) ──┐
                        ├─► backend enrichment (state.py) ─► /api/* rows ─► React UI
Tablo cloud (Lighthouse)┘        Seam 1: fields dropped here      Seam 2: endpoints
                                                              never called by the UI
                                                                     Seam 3: data held
                                                                     but not rendered
```

The gap analysis found **15 gaps**, and they cluster cleanly at three seams. That clustering is the most useful thing in this report: each seam has a different owner, a different fix pattern, and a different risk profile.

- **Seam 1: Backend passthrough.** The Tablo device returns rich JSON (episode numbers, qualifiers, channel resolution, favorites). The enrichment code in `state.py` maps each response to a small fixed row shape and silently discards everything else. Nothing is lost *in the UI* here; the data never leaves the server.
- **Seam 2: Exposed but uncalled endpoints.** The backend exposes ~20 endpoints; the UI calls only 10 of them. Server info, transcode status, device selection, and the entire IPTV/tuner surface are live and working but invisible to the user.
- **Seam 3: UI holds data it doesn't render.** Some data reaches the browser and dies there: `handlePlay` strips `logo_url` and `current_program` off the channel object before handing it to `VideoPlayer`, and the Library play button has no click handler at all.

The scoring below rates each gap. **Score = Impact (1–5) × (6 − Effort (1–5))**, so a high-impact, low-effort gap outranks a low-impact, high-effort one. Max score is 20.

---


---

## What is actually available (verified live, 2026-11-11)

### Airing detail response from the Tablo device

Sampled 40 airing paths from `/guide/airings` and fetched each detail. The union of fields present:

| Source | Fields observed | Passed to UI today |
|--------|----------------|--------------------|
| `airing_details` | `channel`, `channel_path`, `datetime`, `duration`, `show_title` | `show_title`, `datetime`, `duration` |
| top level | `episode`, `object_id`, `path`, `qualifiers`, `schedule`, `season_path`, `series_path` | (only `episode.description`) |
| `episode` object | `description`, `number`, `orig_air_date`, `season_number`, `title`, `tms_id` | `description` |

Observed `qualifiers` values: `["cc"]`, `["live", "cc"]`.

### Channel detail response from the device

| Fields observed | Used today |
|-----------------|------------|
| `call_sign`, `call_sign_src`, `channel_identifier`, `major`, `minor`, `network`, `name`, `source` | `call_sign`, `major`, `minor`, `network`, `channel_identifier` |
| `favourite`, `flags` (e.g. `mpeg2`, `interlaced`, `canRecord`), `resolution` (e.g. `hd_1080`), `tms_station_id`, `tms_affiliate_id` | none |
| `logos` (multiple `kind` variants) | `originalLarge` / `lightLarge` only |

### `/server/info` from the device (exposed at `/api/channels/server-info`)

`server_id`, `name`, `timezone`, `version` (2.2.58), `local_address`, `setup_completed`, `build_number`, `model` (`wifi`, `tuners: 2`, `type: s4g2`, `name: "Tablo 4G DUAL 128GB"`), `availability`, `product`.

### Endpoints the UI never calls

| Endpoint | Data available |
|----------|----------------|
| `GET /api/channels/server-info` | device model, firmware, tuner count, LAN address |
| `GET /api/transcode/status/{sid}` | transcode state, return code, session files, last 20 ffmpeg log lines |
| `POST /api/auth/device/{sid}` | switch active device (multi-device accounts) |
| `GET /api/channels` | plain channel list (used internally only) |
| `GET /api/channels/local-guide`, `/airings`, `/detail` | raw device passthroughs |
| `GET /iptv/playlist.m3u`, `/epg.xml`, `/discover.json`, `/lineup.json`, `/lineup_status.json`, `/live/{id}` | full HDHomeRun-style tuner surface for Plex/Jellyfin |
| `GET /api/health` | liveness |

---

## Seam 1: fields dropped by the backend passthrough

### G1 · Episode identity (S/E, episode title) · score 16

The device returns `episode.title`, `episode.number`, and `episode.season_number` on every airing response. The enrichment code in `state.py` (lines 643–650 for the grid, 414–421 for the live guide) keeps only `description` from the `episode` object. The UI therefore cannot show "S01E03" or an episode title anywhere, even though the data is sitting in the response. This is the single highest-leverage passthrough: it unlocks card subtitles, grid cell labels, and library organization at once.

**Fix shape:** add `episode_title`, `season_number`, `episode_number` to the row dicts in `_build_grid_enrichment`, `get_guide_data`, and `get_recordings`; extend the `Program`/`Recording` TS interfaces; render in `ChannelCard` and `GuideGridView`.

### G2 · Qualifiers (LIVE / NEW / CC) · score 12

`qualifiers` is a top-level array on every airing response. Observed values include `live` and `cc`. This is the standard way Tablo marks live events, premieres, and closed-captioned content. The backend never reads it, so the UI has no way to badge a card or grid cell. A "LIVE" chip on a sports card or "CC" indicator for accessibility users is a one-field passthrough plus a small badge component.

### G3 · Channel attributes: resolution, favourite, flags · score 12

Channel details carry `resolution` (`hd_1080`), `favourite` (boolean), and `flags` (`canRecord`, `mpeg2`, `interlaced`). None reach the UI. Consequences: no HD/SD badge, no way to pin or sort favourite channels first, no "can record" hint in the library. The data requires one extra device fetch per channel (already done for logos in `_build_grid_enrichment` via `/guide/channels/{path}`), so the marginal cost is parsing, not fetching.

### G4 · Recording thumbnails and S/E · score 9

`get_recordings` (state.py lines 542–555) hardcodes `"thumbnail": None` with the comment "Could resolve series image later." The device's recording detail includes the same `episode` object, so S/E is dropped for recordings too. The Library view therefore always renders the "Tablo" placeholder art and can never show "S02E07."

### G5 · Genre filter silently broken for OTA channels · score 12

The UI offers content filters (Movies, Sports, News, Reality, Documentary) that match on `genres`. But the device's OTA `airing_details` object contains **no genres key at all** (verified across 40 samples: the key union is only `channel`, `channel_path`, `datetime`, `duration`, `show_title`). Genres arrive only for OTT channels via the cloud airing map. So on an OTA-heavy lineup the Sports or Documentary chip quietly filters out every OTA channel, and nothing tells the user why. Options: derive a genre proxy from `event_type`/`qualifiers`/title heuristics, or fetch series-level metadata, or label the chips "Streaming only" until real data exists.

## Gap matrix (ranked)

| # | Gap | Seam | Impact | Effort | Score |
|---|-----|------|:------:|:------:|:-----:|
| G10 | Player shows no program info (title, description, progress, logo) | 3 | 4 | 1 | **20** |
| G1 | Episode identity (S/E, episode title) dropped by backend | 1 | 4 | 2 | **16** |
| G8 | Multi-device accounts have no device selection UI | 2 | 4 | 2 | **16** |
| G7 | Transcode status never shown (user can't tell OTA is being transcoded) | 2 | 3 | 1 | **15** |
| G11 | Live cards show no "what's next" | 3 | 3 | 1 | **15** |
| G13 | Library play button is a dead button (no `onClick`) | 3 | 5 | 3 | **15** |
| G14 | No search in Guide or Library tabs | 3 | 3 | 1 | **15** |
| G2 | Qualifiers (LIVE / NEW / CC) dropped by backend | 1 | 3 | 2 | **12** |
| G3 | Channel attributes (HD resolution, favourite, flags) dropped | 1 | 3 | 2 | **12** |
| G5 | Genre filter silently broken for OTA channels | 1 | 4 | 3 | **12** |
| G12 | Guide view: fixed 6-hour window, no time navigation | 3 | 4 | 3 | **12** |
| G6 | Server/device info (model, version, tuners) never displayed | 2 | 2 | 1 | **10** |
| G9 | IPTV/tuner endpoints (playlist.m3u, epg.xml) hidden from users | 2 | 2 | 1 | **10** |
| G15 | Grid channel column hides network and call sign | 3 | 2 | 1 | **10** |
| G4 | Recording thumbnails always null; S/E dropped for recordings | 1 | 3 | 3 | **9** |

Reading the matrix: the top of the list is dominated by **Seam 3** (cheap, pure frontend) and two **Seam 1** passthroughs that unlock several UI features at once. The bottom is where the work is genuinely structural (recording playback, guide navigation).


## Priority groups

The matrix ranks gaps individually, but work should be batched by dependency profile, not by score. The 15 gaps fall into three groups of exactly five, each with a different owner, risk, and sequencing rule.

| Group | Gaps | Score sum | Character |
|-------|------|:---------:|-----------|
| 1 · Frontend quick wins | G10, G7, G11, G14, G15 | 75 | Data already in the browser; no backend change |
| 2 · Backend passthrough | G1, G2, G3, G4, G5 | 61 | One coordinated PR over the `state.py` row shapes |
| 3 · Structural | G8, G13, G12, G6, G9 | 63 | New endpoints or multi-screen flows; design first |

### Group 1 · Frontend quick wins (do first)

**G10, G7, G11, G14, G15.** Every item here renders data the browser already holds: the player's now-playing bar (G10), the transcoding chip (G7), the "what's next" line (G11), search in Guide and Library (G14), and channel identity text in the grid (G15). No API shape changes, no new endpoints, each item independent and revertible on its own. This group has the highest score sum (75) at the lowest risk, which is why it comes first rather than following the raw ranking. A 5-minute mitigation from Group 3 also belongs here: disable the dead Library play button (G13 partial) so the UI stops over-promising while the real fix waits.

### Group 2 · Backend passthrough (one PR)

**G1, G2, G3, G4, G5.** All five touch the same code: the row shapes built in `state.py` (`_build_grid_enrichment`, `get_guide_data`, `get_recordings`). Episode identity (G1), qualifiers (G2), channel attributes (G3), and recording S/E plus thumbnails (G4) are pure passthroughs that should land together, because splitting them means repeated changes to the same dicts and the same TS interfaces. G5 (the broken OTA genre filter) rides along but needs a data decision first: derive genres from available fields or label the filter chips honestly. Do Group 1 first, then this PR, then add the UI badges and chips that consume the new fields.

### Group 3 · Structural (design before code)

**G8, G13, G12, G6, G9.** Each item needs something that does not exist yet: a device selection flow (G8), a recording playback endpoint (G13 full), guide time navigation (G12), or a settings surface for device info and tuner URLs (G6, G9). These are safe to defer but need design before code. One exception to the sequencing rule: **G8 is the only true correctness bug** in the report, not just a missing feature. On a multi-device account the app silently sticks to the first device, so pull G8 forward to the front of this group (or earlier) if the account has more than one Tablo box.

### Suggested order

1. Group 1 as five small commits (plus the G13 button mitigation).
2. Group 2 as one backend PR, then the UI badges that consume the new fields.
3. Group 3 starting with G8 if multi-device, otherwise G13 playback, then G12, then the G6/G9 settings surface.


---

## Seam 2: endpoints exposed but never called

### G6 · Server/device info never displayed · score 10

`/api/channels/server-info` returns the device model ("Tablo 4G DUAL 128GB"), firmware version (2.2.58), tuner count (2), and LAN address. The UI shows none of it. A small footer line in the profile menu ("Tablo 4G DUAL 128GB · 2 tuners · fw 2.2.58") would surface hardware the user is paying for and make the debug report self-explanatory.

### G7 · Transcode status invisible · score 15

Every OTA channel is transcoded to H.264 on the fly (the player requests `transcode=true` for `kind === "ota"` because no browser MSE implementation decodes MPEG-2 video). The start response includes a `transcoded` flag and `/api/transcode/status/{sid}` reports process state plus the last 20 ffmpeg log lines, but the player polls neither. A user watching OTA content gets no signal that CPU is being spent, that buffering may be transcode-related, or that the transcoder died. A small "Transcoding" chip near the LIVE badge (with a warning color when `status` is not `active`) closes the loop.

### G8 · Multi-device accounts have no device selection UI · score 16

`/api/auth/status` returns `devices: [{sid, name}]` and `active_sid`, and `POST /api/auth/device/{sid}` switches the active device. The frontend declares both in `api/tablo.ts` (`status`, `selectDevice`) but `App.tsx` references neither. On an account with two Tablo boxes, login auto-selects the first device and the user has no UI path to switch. This is a latent correctness bug, not just a missing feature: the wrong device means the wrong channels, recordings, and streams.

### G9 · IPTV/tuner surface hidden from users · score 10

`routes/iptv.py` implements a full HDHomeRun-style tuner: `playlist.m3u`, `epg.xml` (XMLTV, 15,000-airing fetch, 4-hour cache), `discover.json`, `lineup.json`, `lineup_status.json`, and `live/{identifier}`. This is what Plex and Jellyfin consume, but a tablo-web user has no in-app way to find these URLs. A "Tuner" section in the profile menu with copyable URLs (and a QR code on mobile) would convert the most powerful integration into a discoverable one.

---

## Seam 3: data the UI holds but does not render

### G10 · Player shows no program info · score 20

`handlePlay` in `ChannelGrid.tsx` (lines 127–141) builds the player's channel prop from only `identifier`, `call_sign`, `major`, `minor`, `network`, `kind`, `display_name`. It drops `logo_url` and `current_program`, which it already has in memory. The player therefore shows the network, the channel name, and a hardcoded "LIVE" badge, while the title, description, start time, and progress of the program actually on screen sit unused one component up. This is the cheapest high-value fix in the report: pass the object through and render a now-playing bar (title, description, start/end, progress) in the player's bottom area.

### G11 · No "what's next" on live cards · score 15

The grid enrichment already fetches up to 1,000 airings per channel and sorts them by start time. `ChannelCard` renders only the current program. The next airing is one array element away; a single line under the progress bar ("Next: 9:30 PM · Show Title") would make the live grid genuinely useful for deciding what to watch.

### G12 · Guide view has no time navigation · score 12

`GuideGridView` renders a fixed 6-hour window starting at the current hour. There is no jump-to-now, no hour or day offset, and no horizontal scroll sync. With up to 1,000 airings already fetched per channel, the data for a full day exists; the view just does not let you move through it.

### G13 · Library play button is dead · score 15

The play button in `LibraryView.tsx` (lines 61–65) has no `onClick` handler. Clicking it does nothing, and there is no recording playback endpoint yet (recordings would need their own stream path through the device). The button advertises a feature the code does not provide. Either wire it to a recording stream endpoint or render it as a disabled state with a tooltip until playback lands. The library also lacks delete, sort, and search.

### G14 · No search in Guide or Library · score 15

The search box exists only in the Live tab and matches call sign, network, display name, and current program title. The Guide and Library tabs have no search at all, even though both lists are fully in memory. Client-side filtering is a few lines per view.

### G15 · Grid channel column hides identity · score 10

The grid's channel column renders the logo and `major.minor` (or "FAST"). The network name and call sign are in the row data but not displayed; `call_sign` appears only as the image `alt` text. On a wall of logos, that makes rows hard to scan. One line of text under the badge fixes it.


---

## Recommendations

**Quick wins (frontend only, each under an hour):**

1. **G10** Pass `logo_url` and `current_program` into `VideoPlayer` and render a now-playing bar. Highest score in the report, zero backend work.
2. **G7** Show a "Transcoding" chip in the player when `StreamStart.transcoded` is true; poll `/api/transcode/status/{sid}` while playing.
3. **G11** Add a "Next: HH:MM · Title" line to `ChannelCard` from the already-fetched airings list.
4. **G14 / G15** Add search inputs to Guide and Library; add network + call sign text to the grid channel column.
5. **G13 (partial)** Disable the dead Library play button until recording playback exists, so the UI stops over-promising.

**Backend passthroughs (one PR, unlocks several UI features):**

6. **G1 + G2 + G4** Extend the row shapes in `state.py` with `episode_title`, `season_number`, `episode_number`, and `qualifiers`. Every consumer (cards, grid, library) benefits from the same change.
7. **G3** Parse `resolution`, `favourite`, and `flags` from channel details already fetched for logos; add HD/favourite badges and favourite-first sorting.
8. **G5** Decide the genre strategy for OTA: derive from available fields or label the filter chips honestly.

**Structural (needs design):**

9. **G8** Device selection screen on login when `devices.length > 1`, plus a switcher in the profile menu.
10. **G12** Time navigation for the guide view (jump-to-now, hour/day offsets).
11. **G13 (full)** Recording playback endpoint through the device, then wire the Library button.
12. **G6 / G9** Profile menu footer with device info and a Tuner section with copyable IPTV URLs.

---

## Evidence URLs

1. https://github.com/trevor-viljoen/tablo-web · this repository
2. https://github.com/trevor-viljoen/tablo-api · `tablo_api` package used by the backend
3. https://pypi.org/project/tablo-api/ · published package docs
4. https://jessedp.github.io/tablo-api-docs/ · unofficial Tablo device API docs (airing detail, channel detail, server info fields)
5. https://support.tablotv.com/hc/en-us/articles/21999956472340-4th-Generation-Tablo-Free-Ad-Supported-Streaming-TV-Channels-FAST-List · Tablo 4G FAST/OTT channel list (the cloud-sourced channels)
6. https://community.tablotv.com/t/using-g4-tablo-with-plex-and-jellyfin/46497 · community discussion of G4 Tablo as a Plex/Jellyfin tuner
7. https://wiki.xmltv.org/index.php/XMLTVFormat · XMLTV format used by `/epg.xml`
8. https://raw.githubusercontent.com/XMLTV/xmltv/master/xmltv.dtd · XMLTV DTD
9. https://support.plex.tv/articles/225877347-live-tv-dvr/ · Plex Live TV/DVR setup (consumer of the tuner surface)
10. https://support.plex.tv/articles/225877427-supported-dvr-tuners-and-antennas/ · Plex supported tuners
11. https://support.plex.tv/articles/community-supported-tuners/ · community tuner integration notes
12. https://jellyfin.org/docs/general/server/live-tv/ · Jellyfin Live TV docs (HDHomeRun-style tuner consumer)
13. https://github.com/video-dev/hls.js/ · hls.js, the browser HLS player used by the frontend
14. https://github.com/video-dev/hls.js/blob/HEAD/docs/API.md · hls.js API reference
15. https://datatracker.ietf.org/doc/html/rfc8216 · HTTP Live Streaming specification
16. https://www.etsi.org/technologies/mpeg-2 · MPEG-2, the OTA video codec browsers cannot decode (why transcoding exists)
17. https://tanstack.com/query/latest · TanStack Query, used for Library data
18. https://react.dev/reference/react · React reference (component model for the UI gaps)
19. https://fastapi.tiangolo.com/ · FastAPI, the backend framework
20. https://docs.pydantic.dev/ · Pydantic models in `tablo_api`
21. https://www.python-httpx.org/ · httpx, the backend HTTP client
22. https://ffmpeg.org/documentation.html · FFmpeg, used for OTA transcoding
23. https://tailwindcss.com/docs · Tailwind CSS, the UI styling system
24. https://vitejs.dev/ · Vite, the frontend build tool
25. https://docs.docker.com/compose/ · Docker Compose, the deployment model
26. https://ndjson.org/ · NDJSON, the streaming format for guide endpoints
27. https://www.w3.org/TR/webvtt1/ · WebVTT, the caption format behind the `cc` qualifier
28. https://www.typescriptlang.org/docs/handbook/intro.html · TypeScript, used for the API type contracts
29. https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API · Fullscreen API used by the player

---

## Verification notes

- Live device sampling (40 airing details, channel detail, `/server/info`) ran inside the running backend container against `SID_5087B8610F05` on 2026-11-11.
- The OTA genres finding (G5) rests on the key union of 40 sampled `airing_details` objects containing no `genres` key; OTT channels get genres from the cloud airing map instead, so the filter works for OTT only.
- Line references point to the working tree as of this report; the backend files have uncommitted local edits.
