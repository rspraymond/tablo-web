# IPTV & HDHomeRun Emulation

## Problem Statement
Plex and Jellyfin discover Live TV tuners by speaking the HDHomeRun protocol, and they want XMLTV EPG data. The Tablo device speaks neither. This domain makes tablo-web impersonate an HDHomeRun tuner (device discovery, lineup, live streams) and generate a full XMLTV EPG, so both apps can use the Tablo as a Live TV source without Gracenote.

## Functional Requirements
1. Serve an M3U playlist for Jellyfin's M3U tuner, with `tvg-id` values that match the XMLTV channel ids (`backend/app/routes/iptv.py` GET `/api/iptv/playlist.m3u`).
2. Generate and serve a multi-day XMLTV EPG (`iptv.py` GET `/api/iptv/epg.xml`, `_build_epg`, backed by `state.get_epg_guide`).
3. Emulate HDHomeRun discovery for Plex: device identity, tuner count, base/lineup URLs (`iptv.py` GET `/api/iptv/discover.json` plus root and `playlist.m3u/discover.json` aliases).
4. Serve the HDHomeRun lineup (channel number, name, stream URL per channel) (`iptv.py` GET `/api/iptv/lineup.json` plus aliases).
5. Report lineup scan status and acknowledge scan triggers so Plex does not wait (`iptv.py` `/lineup_status.json`, POST `/lineup.json`).
6. Stream a channel as a continuous MPEG-TS for Plex/Jellyfin (`iptv.py` GET `/api/iptv/live/{identifier}`).

## Non-Functional Requirements
- The EPG is built once and cached in memory for 4 hours (`_EPG_TTL = 14400`), guarded by an `asyncio.Lock` with a double-checked refresh; the build fetches up to 15000 airings via `state.get_epg_guide`, so it is expensive enough to warrant the long TTL.
- The EPG cache is pre-warmed in the background when Plex probes `discover.json` or the lineup, so the first real `epg.xml` request is fast.
- Live streams are remuxed (FFmpeg `-c copy`), not transcoded: Tablo's HLS is piped to `mpegts` on stdout so Plex receives the MPEG-TS it expects from an HDHomeRun URL. HLS would cause a format mismatch in Plex.
- The remux process is killed and the Tablo session stopped in the streaming generator's `finally`, so a client disconnect always releases the tuner.
- Tuner count is read from the device `/server/info` (`model.tuners`), defaulting to 4 on failure.
- M3U `tvg-id` uses `major.minor` when available, else the call sign, and must equal the XMLTV `<channel id>` so Jellyfin correlates EPG entries to playlist entries.

## Core Entities
| Entity | Description |
|---|---|
| `_epg_cache` (`iptv.py`) | In-memory bytes of the generated XMLTV document plus a monotonic timestamp; 4 h TTL. |
| XMLTV `tv` / `channel` / `programme` elements | Built with `xml.etree.ElementTree`; one `channel` per Tablo channel, one `programme` per airing with start/stop/channel, title, desc, categories. |
| M3U playlist (string) | `#EXTM3U x-tvg-url=...` header plus `#EXTINF` + stream URL lines per channel, grouped Broadcast vs Streaming. |
| HDHomeRun JSON payloads | `discover.json` (identity + URLs), `lineup.json` (GuideNumber/GuideName/URL), `lineup_status.json` (scan state). |
| MPEG-TS pipe | FFmpeg process stdout carrying remuxed TS bytes streamed to the client as `video/mp2t`. |

## Core API
| Operation | File/Endpoint | Notes |
|---|---|---|
| M3U playlist | `GET /api/iptv/playlist.m3u` (`routes/iptv.py`) | Jellyfin M3U tuner source; `tvg-id` matches XMLTV ids. |
| XMLTV EPG | `GET /api/iptv/epg.xml` (`routes/iptv.py`) | 4 h in-memory cache; pre-warmed on discovery. |
| HDHR discover | `GET /api/iptv/discover.json` (+ `/`, `/playlist.m3u/discover.json`) (`routes/iptv.py`) | Fake HDTC-2US tuner identity. |
| HDHR lineup | `GET /api/iptv/lineup.json` (+ `/playlist.m3u/lineup.json`) (`routes/iptv.py`) | Pre-warms EPG cache as a side effect. |
| HDHR lineup status | `GET /api/iptv/lineup_status.json` (+ alias) (`routes/iptv.py`) | `ScanInProgress: 0`, `ScanPossible: 0`. |
| HDHR scan trigger | `POST /api/iptv/lineup.json` (+ alias) (`routes/iptv.py`) | Returns `{}` immediately. |
| Live channel stream | `GET /api/iptv/live/{identifier}` (`routes/iptv.py`) | Starts a Tablo session, remuxes HLS to MPEG-TS. |
## High-Level Architecture

```mermaid
flowchart TD
    Plex[Plex DVR\nHDHomeRun client] -->|discover.json, lineup.json| Nginx[Nginx\nfrontend :7070]
    Jellyfin[Jellyfin Live TV\nM3U + XMLTV] -->|playlist.m3u, epg.xml| Nginx
    Nginx -->|proxy /api/*| Iptv[routes/iptv.py]
    Iptv -->|channels()| State[AppState\nstate.py]
    Iptv -->|get_epg_guide\nmax 15000 airings| State
    State -->|guide fan-out\ncached 600s grid cache| Device[(Tablo device\nlocal HTTP)]
    State -->|OTT logos + airings| Cloud[(Tablo cloud\nlighthousetv.ewscloud.com)]
    Iptv -->|EPG bytes, 4h TTL| EpgCache[(_epg_cache\nin-memory XMLTV)]
    Iptv -->|state.start_stream\nthen ffmpeg -c copy mpegts| Device
    Device -->|HLS playlist + segments| Ffmpeg[FFmpeg remux\nstdout pipe]
    Ffmpeg -->|video/mp2t stream| Iptv

    style Device fill:#555,color:#fff
    style Cloud fill:#555,color:#fff
    style EpgCache fill:#d32f2f,color:#fff
```

### How the system satisfies each functional requirement

1. **M3U playlist** is `m3u_playlist()`. It lists `state.channels()` and emits an `#EXTM3U` header pointing `x-tvg-url` at `/api/iptv/epg.xml`. Per channel it computes a `tvg-id` (`major.minor`, else call sign) that exactly matches the `<channel id>` used in the EPG, sets `group-title` to Broadcast or Streaming based on `kind`, and points the stream URL at `/api/iptv/live/{identifier}` so no client-side session management is needed.
2. **XMLTV EPG** is `_build_epg()` behind `_get_epg_cached()`. The build calls `state.get_epg_guide()` (which fetches up to 15000 airings), then emits a `<channel>` element per channel (display names, icon) and a `<programme>` per airing with `start`/`stop` in XMLTV format, title, description, and genre categories. The result is cached for 4 hours under `_epg_lock` with a double-checked TTL so concurrent first requests only build once.
3. **HDHomeRun discovery** is `hdhr_discover()` (also served at `/` and the `playlist.m3u/discover.json` alias). It returns a fixed HDTC-2US identity, a real `TunerCount` from the device, and `BaseURL`/`LineupURL` built from the request's base URL so it works behind any host/port. On first probe it kicks off an EPG pre-warm task.
4. **Lineup** is `hdhr_lineup()` (plus alias), which maps each channel to `GuideNumber` (`major.minor` or call sign), `GuideName`, and a `URL` pointing at the live stream endpoint. It also pre-warms the EPG cache in the background.
5. **Lineup status/scan** are trivial HDHomeRun contracts: `lineup_status.json` reports `ScanInProgress: 0` and `ScanPossible: 0` (the lineup is always ready), and POST `lineup.json` returns `{}` immediately so Plex's scan step does not block.
6. **Live MPEG-TS stream** is `live_stream()`. It starts a Tablo watch session via `state.start_stream(identifier)`, then spawns `ffmpeg -c copy -f mpegts pipe:1` reading the Tablo playlist and writing TS to stdout. An async generator reads 64 KiB chunks from the pipe and yields them as a `video/mp2t` StreamingResponse; the `finally` block kills FFmpeg and stops the Tablo session, releasing the tuner on client disconnect.

