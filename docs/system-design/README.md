# System Design Documentation

One document per core domain of tablo-web, grounded in the current source tree. Each document follows the same structure: problem statement, functional requirements, non-functional requirements, core entities, core API, and a high-level architecture diagram with a requirement-by-requirement walkthrough.

| # | Domain | Document |
|---|---|---|
| 1 | Authentication & Device Management | [01-auth.md](./01-auth.md) |
| 2 | Live TV Streaming | [02-live-streaming.md](./02-live-streaming.md) |
| 3 | Channels & TV Guide | [03-channels-guide.md](./03-channels-guide.md) |
| 4 | Library (Recordings) | [04-library.md](./04-library.md) |
| 5 | IPTV & HDHomeRun Emulation | [05-iptv-hdhomerun.md](./05-iptv-hdhomerun.md) |
| 6 | Frontend UI | [06-frontend-ui.md](./06-frontend-ui.md) |

## Shared infrastructure

All domains run inside the same two containers defined in `docker-compose.yml`:

- **backend**: FastAPI (`backend/app/main.py`) on port 8000, with a `/data` volume holding `config.json`. Talks to the Tablo device (LAN, HTTP) and the Tablo cloud API (`lighthousetv.ewscloud.com`).
- **frontend**: Nginx serving the React SPA on port 7070, proxying `/api/*` to the backend (`frontend/nginx.conf`).

External actors in every diagram: the **Tablo device** (local HTTP API, HLS source) and the **Tablo cloud** (account auth, OTT channel/airing data).
