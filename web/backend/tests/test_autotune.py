"""Tests for the per-take autotune wiring (x42 fat1 LV2).

The pieces under test are pure: ``notemask`` (key/scale -> 12 fat1 note-mask
values) and ``build_fat1_filter`` (the ``lv2=...`` ffmpeg fragment, including the
double-escaping the filtergraph parser demands). ``build_mix_argv`` is checked
for the invariant that matters most: autotune OFF must not perturb the graph.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from hypothesis import given
from hypothesis import strategies as st

from abra_api.domain import Take, TakeMixRequest
from abra_api.takes import (
    _PITCH_CLASSES,
    _SCALE_INTERVALS,
    build_fat1_filter,
    build_mix_argv,
    notemask,
)

NOTES: list[str] = list(_PITCH_CLASSES)
SCALES: list[str] = list(_SCALE_INTERVALS)


def _mask_from_named(notes: set[str]) -> tuple[int, ...]:
    """Reference mask built from explicit pitch-class names — an independent
    derivation that does NOT share the modular arithmetic under test."""
    pcs = {_PITCH_CLASSES[n] for n in notes}
    return tuple(1 if i in pcs else 0 for i in range(12))


@pytest.mark.parametrize(
    ("key", "scale", "notes"),
    [
        ("C", "chromatic", set(_PITCH_CLASSES)),
        ("C", "major", {"C", "D", "E", "F", "G", "A", "B"}),
        ("A", "minor", {"A", "B", "C", "D", "E", "F", "G"}),  # relative to C major
        ("A", "major", {"A", "B", "C#", "D", "E", "F#", "G#"}),
        ("E", "major", {"E", "F#", "G#", "A", "B", "C#", "D#"}),
        ("G", "minor", {"G", "A", "A#", "C", "D", "D#", "F"}),
    ],
)
def test_notemask_matches_named_scale_tones(
    key: str, scale: str, notes: set[str]
) -> None:
    assert notemask(key, scale) == _mask_from_named(notes)


@given(st.sampled_from(NOTES), st.sampled_from(SCALES))
def test_notemask_invariants(key: str, scale: str) -> None:
    mask = notemask(key, scale)
    assert len(mask) == 12
    assert set(mask) <= {0, 1}
    assert mask[_PITCH_CLASSES[key]] == 1  # the root is always a valid target
    # the count equals the scale's interval count (no dupes / off-by-ones)
    assert sum(mask) == len(set(_SCALE_INTERVALS[scale]))


def test_chromatic_enables_all_and_is_key_independent() -> None:
    for key in NOTES:
        assert notemask(key, "chromatic") == (1,) * 12


def test_fat1_filter_double_escapes_uri_and_orders_controls() -> None:
    req = TakeMixRequest(
        autotune=True, autotune_key="A", autotune_scale="minor", autotune_amount=0.85
    )
    frag = build_fat1_filter(req)
    # colons in the URI must arrive as \\: (survives the graph + option unescape)
    assert frag.startswith("lv2=p=http\\\\://gareus.org/oss/lv2/fat1:c=")
    assert "corr=0.85" in frag and "tuning=440.0" in frag
    # all 12 note ports present, in order
    for i in range(12):
        assert f"m{i:02d}=" in frag


def _take() -> Take:
    return Take(
        id="t",
        status="uploaded",
        kind="audio",
        created_at=datetime.now(UTC),
        latency_ms=0.0,
        record_start_song_sec=0.0,
        sample_rate=48000,
        duration=10.0,
        size_bytes=0,
        starred=False,
        label="",
    )


def _vocal_leg(req: TakeMixRequest) -> str:
    from pathlib import Path

    argv = build_mix_argv(
        take=_take(),
        req=req,
        audio_path=Path("/bk.wav"),
        render_path=Path("/r.mp4"),
        raw_wav=Path("/raw.wav"),
        out_path=Path("/out.m4a"),
        backing_sr=44100,
        backing_duration=10.0,
    )
    return argv[argv.index("-filter_complex") + 1].split(";")[0]


def test_autotune_off_leaves_graph_untouched() -> None:
    assert "lv2" not in _vocal_leg(TakeMixRequest(autotune=False))


def test_autotune_on_injects_plugin_before_stereo_upmix() -> None:
    leg = _vocal_leg(TakeMixRequest(autotune=True, autotune_key="A", autotune_scale="minor"))
    assert "lv2=p=" in leg
    # fat1 is mono in/out: the corrector must precede the stereo upmix
    assert leg.index("lv2=p=") < leg.index("channel_layouts=stereo")
    assert leg.index("channel_layouts=mono") < leg.index("lv2=p=")
