"""Pydantic v2 domain models — the single contract that drives the OpenAPI
schema and, through Orval, the entire typed frontend client.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, computed_field

ThemeName = Literal["gold", "cyan", "magenta"]


class Theme(BaseModel):
    """Verse colour theme, mirrored from the burned-in ASS karaoke styling."""

    name: ThemeName
    fill: str = Field(description="CSS hex of the sung-word fill")
    glow: str = Field(description="CSS hex of the pop/glow outline")


class Word(BaseModel):
    word: str
    start: float
    end: float


class LyricLine(BaseModel):
    index: int
    start: float
    end: float
    text: str
    theme: Theme
    words: list[Word]


class ClipInfo(BaseModel):
    id: int
    title: str
    description: str
    source_seconds: float = 10.0


class EditSlot(BaseModel):
    """One timeline slot: take `length` seconds of `clip` starting at `ss`."""

    index: int
    clip: int
    ss: float = Field(ge=0, description="source start (seconds into the clip)")
    length: float = Field(gt=0, description="slot length on the timeline (seconds)")
    label: str = ""


class Cut(BaseModel):
    """The full timeline — the editable single source of truth."""

    title: str
    audio_duration: float
    crossfade: float
    fps: int
    width: int
    height: int
    slots: list[EditSlot]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total_length(self) -> float:
        return round(sum(s.length for s in self.slots), 3)


class CutUpdate(BaseModel):
    """Editor payload. Slots are re-indexed server-side; crossfade optional."""

    slots: list[EditSlot]
    crossfade: float | None = Field(default=None, ge=0, le=3)


class BeatGrid(BaseModel):
    tempo: float
    beats: list[float]
    onsets: list[float]


class RenderInfo(BaseModel):
    filename: str
    exists: bool
    size_bytes: int | None = None
    duration: float
    url: str = "/api/media/render"


class RenderStatus(BaseModel):
    state: Literal["idle", "queued", "running", "done", "failed"]
    job_id: str | None = None
    returncode: int | None = None
    log_tail: str = ""


class Project(BaseModel):
    """One-shot hydration payload for the whole editor."""

    title: str
    cut: Cut
    clips: list[ClipInfo]
    lyrics: list[LyricLine]
    beats: BeatGrid
    render: RenderInfo
