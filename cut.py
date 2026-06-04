"""Canonical *cut* contract — the single source of truth for the timeline.

Both the render pipeline (`build_v3.py`) and the web API (`web/backend`) read
this file; the web editor writes it. Kept to the stdlib so it imports cleanly
from the heavy-deps render env and a lightweight API env alike.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CUT_PATH = ROOT / "cut.json"
CLIPS_PATH = ROOT / "clips.json"


def load_cut() -> dict:
    """Return the raw cut document (slots + render parameters)."""
    return json.loads(CUT_PATH.read_text(encoding="utf-8"))


def load_clips() -> list[dict]:
    """Return the clip catalog (id, title, description, source_seconds)."""
    return json.loads(CLIPS_PATH.read_text(encoding="utf-8"))


def edit_list(cut: dict | None = None) -> list[tuple[int, float, float]]:
    """The `(clip, source_start, slot_length)` rows the renderer consumes."""
    cut = cut or load_cut()
    return [(s["clip"], float(s["ss"]), float(s["length"])) for s in cut["slots"]]
