"""Data access — reads the pipeline artifacts and the canonical cut.json,
validates editor writes, and exposes everything as typed domain models.

The repository is the only thing that touches the filesystem; routes depend on
it, so the storage backend can be swapped (DB, object store) without touching
the API surface.
"""

from __future__ import annotations

import json
from pathlib import Path

from .config import Settings
from .domain import (
    BeatGrid,
    ClipInfo,
    Cut,
    CutUpdate,
    EditSlot,
    LyricLine,
    Project,
    RenderInfo,
    Theme,
    Word,
)
from .logging import get_logger

log = get_logger("repository")

# Themes mirror karaoke_ass.theme_for(): gold L1–8, cyan L9–17, magenta L18–21
# (0-based line index). Hex values are the ASS &HAABBGGRR colours, RGB-flipped.
_GOLD = Theme(name="gold", fill="#FFD700", glow="#FFB030")
_CYAN = Theme(name="cyan", fill="#00E0FF", glow="#00C0FF")
_MAGENTA = Theme(name="magenta", fill="#FF50FF", glow="#E030FF")


def theme_for(line_index: int) -> Theme:
    if line_index <= 7:
        return _GOLD
    if line_index <= 16:
        return _CYAN
    return _MAGENTA


class CutValidationError(ValueError):
    """Raised when an editor payload would produce an unrenderable cut."""


class ProjectRepository:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._clip_seconds: dict[int, float] = {c.id: c.source_seconds for c in self.load_clips()}

    # ---- reads ---------------------------------------------------------
    def load_clips(self) -> list[ClipInfo]:
        raw = json.loads(self.s.clips_path.read_text(encoding="utf-8"))
        return [ClipInfo.model_validate(c) for c in raw]

    def load_cut(self) -> Cut:
        raw = json.loads(self.s.cut_path.read_text(encoding="utf-8"))
        return Cut(
            title=raw.get("title", self.s.title),
            audio_duration=float(raw["audio_duration"]),
            crossfade=float(raw["crossfade"]),
            fps=int(raw["fps"]),
            width=int(raw["width"]),
            height=int(raw["height"]),
            slots=[EditSlot.model_validate(slot) for slot in raw["slots"]],
        )

    def load_lyrics(self) -> list[LyricLine]:
        path = self.s.word_times_path
        if not path.exists():
            return []
        raw = json.loads(path.read_text(encoding="utf-8"))
        lines: list[LyricLine] = []
        for i, line in enumerate(raw):
            words = [Word.model_validate(w) for w in line.get("words", [])]
            lines.append(
                LyricLine(
                    index=i,
                    start=float(line["start"]),
                    end=float(line["end"]),
                    text=line["text"],
                    theme=theme_for(i),
                    words=words,
                )
            )
        return lines

    def load_beats(self) -> BeatGrid:
        if not self.s.beats_path.exists():
            return BeatGrid(tempo=0.0, beats=[], onsets=[])
        raw = json.loads(self.s.beats_path.read_text(encoding="utf-8"))
        return BeatGrid(
            tempo=float(raw.get("tempo", 0.0)),
            beats=[float(t) for t in raw.get("beats", [])],
            onsets=[float(t) for t in raw.get("onsets", [])],
        )

    def render_info(self) -> RenderInfo:
        p: Path = self.s.render_path
        exists = p.exists()
        cut = self.load_cut()
        return RenderInfo(
            filename=p.name,
            exists=exists,
            size_bytes=p.stat().st_size if exists else None,
            duration=cut.audio_duration,
        )

    def project(self) -> Project:
        return Project(
            title=self.s.title,
            cut=self.load_cut(),
            clips=self.load_clips(),
            lyrics=self.load_lyrics(),
            beats=self.load_beats(),
            render=self.render_info(),
        )

    # ---- writes --------------------------------------------------------
    def save_cut(self, update: CutUpdate) -> Cut:
        current = self.load_cut()
        slots = self._validate_slots(update.slots)
        crossfade = update.crossfade if update.crossfade is not None else current.crossfade

        doc = {
            "title": current.title,
            "audio_duration": current.audio_duration,
            "crossfade": round(crossfade, 3),
            "fps": current.fps,
            "width": current.width,
            "height": current.height,
            "slots": [
                {
                    "index": i,
                    "clip": s.clip,
                    "ss": round(s.ss, 3),
                    "length": round(s.length, 3),
                    "label": s.label,
                }
                for i, s in enumerate(slots)
            ],
        }
        self.s.cut_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("cut.saved", slots=len(slots), total=round(sum(s.length for s in slots), 2))
        return self.load_cut()

    def _validate_slots(self, slots: list[EditSlot]) -> list[EditSlot]:
        if not slots:
            raise CutValidationError("a cut needs at least one slot")
        cleaned: list[EditSlot] = []
        for i, s in enumerate(slots):
            src = self._clip_seconds.get(s.clip)
            if src is None:
                raise CutValidationError(f"slot {i}: unknown clip {s.clip}")
            if s.ss + s.length > src + 1e-6:
                raise CutValidationError(
                    f"slot {i}: clip {s.clip} ss+length={s.ss + s.length:.2f}s "
                    f"exceeds its {src:.1f}s source"
                )
            cleaned.append(s.model_copy(update={"index": i}))
        return cleaned
