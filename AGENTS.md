# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, Copilot, and similar) working in this repository.

## Required reading

Before making any change, read [CONTRIBUTING.md](CONTRIBUTING.md) in full. It is the single source of truth for setup, commands, code style, testing, commits, and PR rules. Also read, as relevant to the task:

- [docs/design-system.md](docs/design-system.md) when touching frontend styling
- [docs/system-design/README.md](docs/system-design/README.md) when touching a backend domain or the API surface

## Acknowledge

At the start of a task, acknowledge the contributing doc in your reply. State that you read CONTRIBUTING.md and list the specific constraints it imposes on this task: which lint/test commands must pass, which style rules apply, and whether the API client or docs need updating. Do not just say "I read the docs"; name the rules you will honor.

## Honor

- **Commands:** use the exact commands from CONTRIBUTING.md. Frontend: `npm run lint`, `npm run build`, `npm test`. Backend: `ruff check .`, `python -m pytest tests/ -v`. The CI list in CONTRIBUTING.md is the definition of done.
- **Backend style:** one route module per domain; device traffic through `AppState.request_device()`; blocking work through `_run_sync`; caches as module-level constants with an `asyncio.Lock` and monotonic timestamp.
- **Frontend style:** all backend calls through `src/api/tablo.ts` (interface + method); TanStack Query for one-shot data; NDJSON streams via `ndjsonStream` with an `AbortController`; Tailwind theme utilities over new hex values.
- **Testing:** extend the matching `backend/tests/test_<domain>.py` or `frontend/src/__tests__/` file and run it before considering the task done. Changes to flow-control bounds need a test per the Backpressure validation testing section below.
- **Commits:** Conventional Commits with a lowercase imperative summary.
- **Two-sided API changes:** update the backend route and the `tablo.ts` client (interface + method) in the same change.
- **Docs:** new domains or architecture changes update the matching doc under `docs/system-design/`.
## Backpressure validation testing

When a change touches any flow-control bound below, add or extend a test that proves the bound holds. "It worked locally" is not validation.

| Bound | Value | Location |
|---|---|---|
| Concurrent transcode sessions | `MAX_TRANSCODE_SESSIONS = 4` | `backend/app/routes/stream.py` |
| Device fan-out concurrency | `asyncio.Semaphore(30)` | `backend/app/state.py` |
| Cloud OTT fetch concurrency | `asyncio.Semaphore(20)` | `backend/app/state.py` |
| Guide enrichment cap | 90 s timeout | `backend/app/state.py` |
| Grid cache TTL | `_GRID_CACHE_TTL = 600` | `backend/app/state.py` |
| Device HTTP timeout | 30 s (`httpx.AsyncClient(timeout=30)`) | `backend/app/state.py` |
| Cloud request timeouts | 10 s / 15 s | `backend/app/state.py` |
| Log ring buffer | `deque(maxlen=200)` | `backend/app/log_buffer.py` |
| Player buffer limits | `maxBufferLength` 30, `maxMaxBufferLength` 60, `backBufferLength` 90 | `frontend/src/hooks/usePlayer.ts` |
| Guide stream refresh | 300_000 ms interval, `AbortController` per stream | `frontend/src/components/ChannelGrid.tsx` |

Assert the bound, not just the happy path:

- **Concurrency caps:** monkeypatch the downstream call (device/cloud HTTP) with an in-flight counter and a small delay; fire N concurrent requests and assert the in-flight count never exceeds the semaphore value.
- **Session cap:** start `MAX_TRANSCODE_SESSIONS` transcodes and assert the next start is rejected, not queued indefinitely.
- **Timeouts:** hang the mock past the timeout and assert the degraded result (cloud failure returns empty maps, not a 500; enrichment completes within the 90 s cap).
- **Cache TTL:** assert a second call within `_GRID_CACHE_TTL` does not reach the device and one after expiry does.
- **Release on disconnect:** assert stream generators' `finally` blocks kill FFmpeg and stop the Tablo session when the client disconnects.
- **Frontend config:** for hls.js or refresh-interval changes, assert the values in `usePlayer.ts` / `ChannelGrid.tsx` match the intended profile.

Keep these tests deterministic: mock at the HTTP boundary (`state.request_device`, cloud fetches), never the real network, Tablo device, or FFmpeg.



If AGENTS.md and CONTRIBUTING.md conflict, CONTRIBUTING.md wins. Update both in the same change.
