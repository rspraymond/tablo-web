import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import log_buffer as _log_buffer
from .routes import auth, channels, iptv, stream
from .state import state, CONFIG_PATH

_log_buffer.install()


async def _restore_session_from_config() -> None:
    """Login from /data/config.json with short retries for Tablo cloud timeouts."""
    if not CONFIG_PATH.exists():
        return
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
    except Exception as e:
        print(f"[startup] config read failed: {type(e).__name__}: {e}")
        return
    email, password = cfg.get("email"), cfg.get("password")
    if not email or not password:
        return

    delays = (0, 2, 5, 10)
    last_err: Exception | None = None
    for i, delay in enumerate(delays):
        if delay:
            await asyncio.sleep(delay)
        try:
            await state.login(email, password)
            state.schedule_guide_warm()
            print(f"[startup] session restored for {email} (attempt {i + 1})")
            return
        except Exception as e:
            last_err = e
            print(f"[startup] login attempt {i + 1}/{len(delays)} failed: {type(e).__name__}: {e}")
    if last_err is not None:
        print(f"[startup] giving up session restore; open UI to log in: {type(last_err).__name__}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _restore_session_from_config()
    yield
    await state.http.aclose()

app = FastAPI(title="Tablo Web", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Explicitly include routers with the /api prefix
app.include_router(auth.router)
app.include_router(channels.router)
app.include_router(iptv.router)
app.include_router(stream.router, prefix="/api")

@app.get("/api/health")
async def health():
    return {"ok": True}
