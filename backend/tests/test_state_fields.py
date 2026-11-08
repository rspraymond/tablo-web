"""Unit tests for state.py field-extraction helpers, plus one integration test
for the enrichment wiring (request_device monkeypatched, no live device)."""

import asyncio
from datetime import datetime, timedelta, timezone

from app.state import (
    AppState,
    _episode_fields,
    _genres_for,
    _next_airing,
    _qualifiers_for,
)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ── _episode_fields ─────────────────────────────────────────────────────────


def test_episode_fields_null_episode():
    assert _episode_fields({}) == {
        "episode_title": None,
        "season_number": 0,
        "episode_number": 0,
    }


def test_episode_fields_zero_numbers():
    data = {"episode": {"title": "Pilot", "season_number": 0, "number": 0}}
    assert _episode_fields(data) == {
        "episode_title": "Pilot",
        "season_number": 0,
        "episode_number": 0,
    }


def test_episode_fields_full():
    data = {"episode": {"title": "Cairo", "season_number": 38, "number": 4}}
    assert _episode_fields(data) == {
        "episode_title": "Cairo",
        "season_number": 38,
        "episode_number": 4,
    }


# ── _genres_for ─────────────────────────────────────────────────────────────


def test_genres_device_wins():
    assert _genres_for({"genres": ["Drama"], "event_type": "movieAiring"}) == ["Drama"]


def test_genres_event_type_fallback():
    assert _genres_for({"event_type": "movieAiring"}) == ["Movies"]
    assert _genres_for({"event_type": "sportEvent"}) == ["Sports"]
    assert _genres_for({"event_type": "newsEvent"}) == ["News"]


def test_genres_unknown_type_empty():
    assert _genres_for({"event_type": "episode"}) == []
    assert _genres_for({}) == []


# ── _qualifiers_for ─────────────────────────────────────────────────────────


def test_qualifiers_cloud_tags_win_over_int_bitmask():
    a = {"qualifiers": 8, "qualifierTags": ["cc", "stereo"]}
    assert _qualifiers_for(a) == ["cc", "stereo"]


def test_qualifiers_device_top_level_list_passes_through():
    a = {"qualifiers": ["live", "cc", "primetime"]}
    assert _qualifiers_for(a) == ["live", "cc", "primetime"]


def test_qualifiers_int_only_normalizes_to_empty():
    # Cloud payloads observed in the wild: qualifiers 8, 9, 11, 3, 0 (ints)
    assert _qualifiers_for({"qualifiers": 8}) == []
    assert _qualifiers_for({"qualifiers": 0}) == []


def test_qualifiers_airing_details_fallback():
    # Device shape used by the enrichment wiring test: list inside airing_details
    assert _qualifiers_for({}, {"qualifiers": ["live"]}) == ["live"]
    assert _qualifiers_for({}, {"qualifiers": None}) == []
    assert _qualifiers_for({}, {}) == []


# ── _next_airing ────────────────────────────────────────────────────────────

_NOW = datetime(2026, 11, 11, 20, 30, tzinfo=timezone.utc)


def test_next_airing_earliest_strictly_after_now():
    airings = [
        {"title": "A", "start": _iso(_NOW + timedelta(minutes=30)), "duration": 1800},
        {"title": "B", "start": _iso(_NOW + timedelta(hours=2)), "duration": 1800},
    ]
    assert _next_airing(airings, _NOW)["title"] == "A"


def test_next_airing_none_when_last_in_window():
    airings = [
        {"title": "Current", "start": _iso(_NOW - timedelta(hours=1)), "duration": 1800},
    ]
    assert _next_airing(airings, _NOW) is None


def test_next_airing_out_of_order_selects_earliest():
    airings = [
        {"title": "Later", "start": _iso(_NOW + timedelta(hours=2)), "duration": 1800},
        {"title": "Sooner", "start": _iso(_NOW + timedelta(minutes=15)), "duration": 1800},
    ]
    assert _next_airing(airings, _NOW)["title"] == "Sooner"


def test_next_airing_starting_exactly_at_now_is_not_next():
    airings = [
        {"title": "Now", "start": _iso(_NOW), "duration": 1800},
        {"title": "Next", "start": _iso(_NOW + timedelta(hours=1)), "duration": 1800},
    ]
    assert _next_airing(airings, _NOW)["title"] == "Next"



# ── Integration: _fetch_guide_enrichment_local wiring ──────────────────────


def test_enrichment_local_extracts_new_fields(monkeypatch):
    """Captured-shaped device responses (one channel detail, two airings) flow
    through the local enrichment; reduced dicts carry the new fields and
    channel_next_map selects the correct airing."""
    now = datetime.now(timezone.utc)
    cur_start = now - timedelta(minutes=40)
    next_start = now + timedelta(minutes=20)

    def airing(start, duration, title, event_type, ep, qualifiers):
        return {
            "airing_details": {
                "show_title": title,
                "datetime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "duration": duration,
                "event_type": event_type,
                "qualifiers": qualifiers,
                "channel_path": "/guide/channels/11.1",
            },
            "episode": ep or {},
            "series": {"description": "Series description"},
        }

    cur = airing(cur_start, 5400, "NCIS", "episode",
                 {"title": "Cairo", "season_number": 38, "number": 4,
                  "description": "Episode description"},
                 ["live"])
    nxt = airing(next_start, 3600, "Game Day", "sportEvent",
                 {"title": "Broken", "season_number": 21, "number": 4},
                 [])

    async def fake_request_device(method, path, body=""):
        if path == "/guide/channels":
            return ["/guide/channels/11.1"]
        if path == "/guide/airings":
            return ["/guide/airings/cur", "/guide/airings/next"]
        if path == "/guide/channels/11.1":
            return {
                "path": path,
                "channel": {
                    "channel_identifier": "ch-11.1",
                    "logos": [{"kind": "originalLarge", "url": "http://x/logo.png"}],
                    "resolution": "hd",
                    "favourite": True,
                    "flags": ["hd"],
                },
            }
        if path == "/guide/airings/cur":
            return cur
        if path == "/guide/airings/next":
            return nxt
        raise AssertionError(f"unexpected device call: {path}")

    st = AppState()
    monkeypatch.setattr(st, "request_device", fake_request_device)

    (logo_map, path_to_ident, channel_airing_map,
     channel_next_map, channel_attrs) = asyncio.run(st._fetch_guide_enrichment_local())

    # Current airing carries the new episode/qualifier/genre fields
    cur_airing = channel_airing_map["/guide/channels/11.1"]
    assert cur_airing["title"] == "NCIS"
    assert cur_airing["episode_title"] == "Cairo"
    assert cur_airing["season_number"] == 38
    assert cur_airing["episode_number"] == 4
    assert cur_airing["qualifiers"] == ["live"]
    assert cur_airing["genres"] == []  # event_type "episode" has no fallback
    assert cur_airing["description"] == "Episode description"

    # Next airing is the correct one, with genre derived from event_type
    nxt_airing = channel_next_map["/guide/channels/11.1"]
    assert nxt_airing["title"] == "Game Day"
    assert nxt_airing["episode_title"] == "Broken"
    assert nxt_airing["genres"] == ["Sports"]
    assert nxt_airing["qualifiers"] == []

    # Channel attributes and logo/identifier maps intact
    assert channel_attrs["ch-11.1"] == {"resolution": "hd", "favourite": True, "flags": ["hd"]}
    assert path_to_ident["/guide/channels/11.1"] == "ch-11.1"
    assert logo_map["ch-11.1"] == "http://x/logo.png"
