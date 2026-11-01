# Contributing

Thank you for contributing to tablo-web, a web frontend for the Tablo TV tuner with live streaming, a TV guide, recordings, and Plex/Jellyfin Live TV integration.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI app (Python 3.12): auth, streaming/transcoding, guide, library, IPTV/HDHomeRun |
| `backend/app/routes/` | One module per domain: `auth.py`, `stream.py`, `channels.py`, `iptv.py` |
| `backend/app/state.py` | `AppState` singleton: Tablo session, device calls, caches, stream sessions |
| `backend/tests/` | pytest suite (FastAPI `TestClient`) |
| `frontend/` | React 19 + Vite 8 + Tailwind CSS SPA, served by Nginx in production |
| `frontend/src/api/tablo.ts` | Typed API client for every backend endpoint |
| `frontend/nginx.conf` | Production server config (SPA + `/api` proxy) |
| `docker-compose.yml` | Two containers: backend (internal :8000), frontend (:7070) |
| `docs/` | Design system and per-domain system design docs |

## Prerequisites

- **Node 22** and npm (frontend)
- **Python 3.12** (backend)
- **Docker** (only for the full-stack or image-build workflow)
- A Tablo device on your LAN, plus a Tablo account email/password (the app logs in to the Tablo cloud on first run)

## Getting started

### Option A: Docker (full stack)

```bash
docker compose up --build
```

Open http://localhost:7070. The backend runs on port 8000 but is internal to the Compose network; Nginx in the frontend container proxies `/api/*` to it. Login credentials are persisted in the `data` volume (`/data/config.json`).

For local Dockerfile tweaks (for example, testing a build change), create a gitignored `docker-compose.override.yml` that points a service at a `Dockerfile.local` instead of the committed one. Both are in `.gitignore` so they do not leak into commits.

### Option B: Local dev servers (fastest iteration)

Backend (serves the API on :8000):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Frontend (Vite dev server on :5173, proxies `/api/*` to `http://localhost:8000` via `vite.config.ts`):

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The Vite proxy means no CORS setup is needed during development.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TABLO_TRANSCODE_ENCODER` | `auto` | Transcode encoder selection: `auto`, `cpu`, or `nvenc` (NVENC for NVIDIA GPUs; the image ships Ubuntu's FFmpeg with `h264_nvenc`) |

All other configuration (Tablo email/password, selected device) is written to `/data/config.json` by the app at login time.

## Commands

| Area | Command (run from the listed directory) | What it does |
|---|---|---|
| Frontend | `npm run dev` (`frontend/`) | Vite dev server with HMR and API proxy |
| Frontend | `npm run build` (`frontend/`) | `tsc -b` type check + production bundle to `dist/` |
| Frontend | `npm test` (`frontend/`) | Vitest run (jsdom) |
| Frontend | `npm run lint` (`frontend/`) | ESLint (flat config: recommended + react-hooks + react-refresh) |
| Backend | `python -m pytest tests/ -v` (`backend/`) | Full backend test suite |
| Backend | `ruff check .` (`backend/`) | Lint (default ruff rules; no project-level ruff config) |
| Stack | `docker compose up --build` (repo root) | Build and run both containers |

CI runs exactly: frontend `npm ci` + `npm run lint` + `npm run build` + `npm test`, and backend `pip install ruff && pip install -r requirements.txt` + `ruff check .` + `python -m pytest tests/ -v`, followed by a Docker image build. If it is not on this list, CI will not catch it.

## Code style

### Python (backend)

- FastAPI with one route module per domain under `app/routes/`; keep new endpoints in the module that owns the domain.
- All device traffic goes through `AppState.request_device()` (`app/state.py`), which uses a shared `httpx.AsyncClient` (30 s timeout). Do not create ad-hoc HTTP clients.
- Blocking calls (the `tablo-api` sync client, FFmpeg process management) run through the `_run_sync` thread-pool helper so the event loop stays responsive.
- Type hints on public functions; prefer `async def` for route handlers unless calling into blocking code.
- Caches and limits are module-level constants in `state.py` (for example `_GRID_CACHE_TTL`). Follow that pattern for new caches: a constant, an `asyncio.Lock`, and a monotonic timestamp.

### TypeScript / React (frontend)

- Functional components with hooks; no class components.
- All backend calls go through the typed client in `src/api/tablo.ts`. Add new endpoints there (interface + method) rather than calling `fetch` from components.
- One-shot data uses TanStack Query; phased NDJSON streams use the `ndjsonStream` async generator with an `AbortController`.
- Tailwind utility classes for styling; dynamic layout values (guide block positions, progress bars) use inline `style` props.
- Keep components in `src/components/` and hooks in `src/hooks/`; the player lifecycle lives in `src/hooks/usePlayer.ts`.

## Styling

The UI is React + Tailwind CSS with a minimal custom theme: a `surface` color scale, an `accent` color, and the Inter font. Use theme utilities (`bg-surface`, `bg-surface-raised`, `bg-accent`, `text-white/60`) instead of new hex values, and reuse the `.glass` / `.channel-glow` utilities from `frontend/src/index.css`. Full token reference and decision guide: [docs/design-system.md](docs/design-system.md).

## Testing conventions

- **Backend:** tests live in `backend/tests/` and use FastAPI's `TestClient` against `app.main:app`. Name files `test_<domain>.py` matching the route module. Cover the happy path plus the error mapping (device failure to HTTP status) for each endpoint you touch.
- **Frontend:** tests live in `frontend/src/__tests__/` and use Vitest + React Testing Library. Test observable behavior (rendered text, user events), not implementation details.
- Run the suite for the area you touched before opening a PR; CI runs both suites on every PR.

## Commit messages

Use Conventional Commits with a lowercase imperative summary, matching recent history:

```
fix: cache grid enrichment and add 90s timeout to prevent guide hang
feat: add IPTV playlist and XMLTV EPG for Jellyfin
docs: update README for GHCR images
```

## Pull requests

1. Fork and branch from `main`.
2. Keep changes scoped to one concern; the project prefers small, reviewable diffs.
3. Ensure CI is green: frontend lint + type check + build + tests, backend ruff + tests, and the Docker build job.
4. If you change the API surface, update both sides in the same PR: the backend route and the `src/api/tablo.ts` client (plus its TypeScript interface).
5. If you add a new domain or change architecture, add or update the matching doc in [docs/system-design/README.md](docs/system-design/README.md).
6. Include a debug report for bug fixes when possible: in the app, click the profile icon and choose **Download Debug Report** (see the README for issue guidance).

## Releases

Releases are cut by pushing a `v*` tag. The release workflow builds and pushes `ghcr.io/<repo>-backend` and `ghcr.io/<repo>-frontend` with semver, major.minor, and `latest` tags. No manual packaging steps.

## Documentation

- [README.md](README.md): user-facing setup and feature docs
- [AGENTS.md](AGENTS.md): instructions for AI coding agents
- [docs/design-system.md](docs/design-system.md): UI theme, tokens, and styling decisions
- [docs/system-design/README.md](docs/system-design/README.md): per-domain system design docs (auth, streaming, guide, library, IPTV, frontend)

