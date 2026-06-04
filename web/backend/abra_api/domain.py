"""Pydantic v2 domain models — the single contract that drives the OpenAPI
schema and, through Orval, the entire typed frontend client.
"""

from __future__ import annotations

from datetime import datetime
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


# ---- vocal-overlay recording / take pipeline ---------------------------
# These models drive the "record yourself singing over the backing" feature.
# Nothing here is song-specific: a take is just an uploaded WAV plus the
# sample-accurate metadata needed to line it up against the backing track.

TakeStatus = Literal["uploaded", "queued", "mixing", "done", "failed"]
DeliverableKind = Literal["video", "audio"]
# Mirrors RenderStatus.state so a single poll hook can drive both pipelines.
MixState = Literal["idle", "queued", "running", "done", "failed"]


class TakeCreate(BaseModel):
    """JSON `meta` part of the multipart take upload."""

    latency_ms: float = Field(
        default=0.0,
        description="measured per-device round-trip; vocal shifted earlier by this",
    )
    record_start_song_sec: float = Field(
        default=0.0,
        ge=0,
        description="song-timeline position where capture t0 landed (sample-accurate)",
    )
    sample_rate: int = Field(
        gt=0,
        description="TRUE AudioContext.sampleRate the WAV was written at; server canonicalizes",
    )
    channels: int = Field(default=1, ge=1, le=2)
    mime: str = "audio/wav"
    kind: DeliverableKind = "video"
    consent: bool = False
    label: str = ""


class Take(BaseModel):
    """A persisted recording take, with computed media URLs."""

    id: str
    status: TakeStatus
    kind: DeliverableKind
    created_at: datetime
    latency_ms: float
    record_start_song_sec: float
    sample_rate: int
    duration: float | None = None
    size_bytes: int | None = None
    starred: bool = False
    label: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def raw_url(self) -> str:
        return f"/api/media/take/{self.id}/raw"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def mix_url(self) -> str | None:
        return f"/api/media/take/{self.id}/mix" if self.status == "done" else None


class TakeUpdate(BaseModel):
    """PATCH body: re-label / star / nudge latency WITHOUT re-recording."""

    label: str | None = None
    starred: bool | None = None
    latency_ms: float | None = Field(default=None, ge=-1000, le=1000)


class TakeMixRequest(BaseModel):
    """Kick off (or re-run) the mix of a take against the backing track."""

    kind: DeliverableKind | None = None
    latency_ms: float | None = None
    backing_gain: float = Field(default=0.85, ge=0.0, le=2.0)
    vocal_gain: float = Field(default=1.0, ge=0.0, le=2.0)


class TakeMixStatus(BaseModel):
    """Structurally mirrors RenderStatus so the poll hook is identical in spirit."""

    state: MixState
    take_id: str | None = None
    job_id: str | None = None
    returncode: int | None = None
    log_tail: str = ""
    output_url: str | None = None


class RecordingConfig(BaseModel):
    """One typed hydration payload so the client carries NO magic constants."""

    backing_url: str = "/api/media/audio"
    backing_duration: float
    render_url: str = "/api/media/render"
    backing_sample_rate: int
    default_backing_gain: float = 0.85
    getusermedia_constraints: dict = Field(
        default_factory=lambda: {
            "echoCancellation": False,
            "noiseSuppression": False,
            "autoGainControl": False,
            "channelCount": 1,
        }
    )
