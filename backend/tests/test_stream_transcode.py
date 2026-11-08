"""Tests for transcoder encoder selection and the CPU fallback."""

import asyncio
import shutil
import subprocess
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.responses import Response

from app.routes import stream


def _cleanup_session(sid: str):
    stream.transcode_procs.pop(sid, None)
    stream.cpu_retry_sessions.discard(sid)
    shutil.rmtree(stream.TRANSCODE_DIR / sid, ignore_errors=True)


def _run(coro):
    """Run a coroutine on a fresh loop (the suite has no pytest-asyncio)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    """Keep the playlist wait loops instant."""

    async def _nowait(_delay=None):
        pass

    monkeypatch.setattr("asyncio.sleep", _nowait)


def test_probe_uses_worst_case_resolution(monkeypatch):
    """The NVENC probe must encode at 1080p, the worst case we actually serve."""
    monkeypatch.setattr(stream, "_video_encoder", None)
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if "-encoders" in cmd:
            return subprocess.CompletedProcess(cmd, 0, stdout=" V..... h264_nvenc\n")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    class FakePath:
        def __init__(self, p):
            self.p = p

        def exists(self):
            return self.p == "/dev/nvidia0"

    monkeypatch.setattr(stream.subprocess, "run", fake_run)
    monkeypatch.setattr(stream, "Path", FakePath)

    encoder = stream._resolve_video_encoder()

    assert encoder == "h264_nvenc"
    probe_cmd = next(c for c in calls if "testsrc" in " ".join(c))
    assert "testsrc=size=1920x1080:rate=30" in probe_cmd


def test_start_transcoder_encoder_override(monkeypatch):
    """An explicit encoder override must land in the ffmpeg command."""
    sid = "aa" * 16
    captured: dict = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        return SimpleNamespace(poll=lambda: None)

    monkeypatch.setattr(stream.subprocess, "Popen", fake_popen)
    try:
        _run(
            stream.start_transcoder(sid, "http://dev/playlist.m3u8", encoder="libx264")
        )
    finally:
        _cleanup_session(sid)

    cmd = captured["cmd"]
    assert cmd[cmd.index("-c:v") + 1] == "libx264"


def test_dead_transcoder_retries_with_cpu(monkeypatch):
    """A transcoder that dies before writing the playlist restarts with libx264."""
    sid = "ab" * 16
    session_dir = stream.TRANSCODE_DIR / sid
    session_dir.mkdir(exist_ok=True)
    stream.transcode_procs[sid] = SimpleNamespace(poll=lambda: 187, returncode=187)

    sess = SimpleNamespace(
        stream=SimpleNamespace(playlist_url="http://dev/playlist.m3u8")
    )
    monkeypatch.setattr(stream.state, "get_session", lambda s: sess)

    retry: dict = {}

    async def fake_start_transcoder(session_id, url, encoder=None):
        retry["encoder"] = encoder
        retry["armed"] = session_id in stream.cpu_retry_sessions
        (session_dir / "playlist.m3u8").write_text("#EXTM3U\n")
        stream.transcode_procs[session_id] = SimpleNamespace(poll=lambda: None)

    monkeypatch.setattr(stream, "start_transcoder", fake_start_transcoder)
    try:
        resp = _run(stream.transcoded_stream(sid, "playlist.m3u8", request=None))
    finally:
        _cleanup_session(sid)

    assert retry.get("encoder") == "libx264"
    assert retry.get("armed") is True
    assert isinstance(resp, Response)
    assert resp.status_code == 200


def test_dead_transcoder_retries_only_once(monkeypatch):
    """The CPU fallback must not fire again for the same session."""
    sid = "ac" * 16
    session_dir = stream.TRANSCODE_DIR / sid
    session_dir.mkdir(exist_ok=True)
    stream.transcode_procs[sid] = SimpleNamespace(poll=lambda: 187, returncode=187)
    stream.cpu_retry_sessions.add(sid)

    monkeypatch.setattr(stream.state, "get_session", lambda s: None)
    calls: dict = {}

    async def fake_start_transcoder(session_id, url, encoder=None):
        calls["yes"] = True

    monkeypatch.setattr(stream, "start_transcoder", fake_start_transcoder)
    try:
        with pytest.raises(HTTPException) as exc:
            _run(stream.transcoded_stream(sid, "playlist.m3u8", request=None))
    finally:
        _cleanup_session(sid)

    assert "exited with 187" in str(exc.value.detail)
    assert "yes" not in calls


def test_live_transcoder_does_not_retry(monkeypatch):
    """A still-running transcoder must not be restarted mid-startup."""
    sid = "cd" * 16
    session_dir = stream.TRANSCODE_DIR / sid
    session_dir.mkdir(exist_ok=True)
    stream.transcode_procs[sid] = SimpleNamespace(poll=lambda: None)

    calls: dict = {}

    async def fake_start_transcoder(session_id, url, encoder=None):
        calls["yes"] = True

    monkeypatch.setattr(stream, "start_transcoder", fake_start_transcoder)
    try:
        with pytest.raises(HTTPException) as exc:
            _run(stream.transcoded_stream(sid, "playlist.m3u8", request=None))
    finally:
        _cleanup_session(sid)

    assert "alive" in str(exc.value.detail)
    assert "yes" not in calls
