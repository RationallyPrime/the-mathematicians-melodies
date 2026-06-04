"""Configuration, sourced from the environment via pydantic-settings.

Every path defaults to the layout the render pipeline already uses, so the API
runs with zero config in dev; override with `ABRA_*` env vars in a container.
"""

from __future__ import annotations

import json
import subprocess
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .logging import get_logger

log = get_logger("config")

# web/backend/abra_api/config.py -> parents[3] == the project root.
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_AUDIO = Path.home() / "Downloads/separated/htdemucs/Aravísur/no_vocals.wav"

# Last-ditch fallback ONLY if ffprobe is genuinely unavailable. Never a hardcode
# of *this* song — the real values are always probed from the backing file.
_PROBE_FALLBACK: tuple[int, float, int] = (44100, 0.0, 2)


def probe_audio(path: Path) -> tuple[int, float, int]:
    """Probe a backing/audio file for ``(sample_rate, duration, channels)``.

    Shells ``ffprobe`` with a list argv (no shell). Returns a robust fallback
    only when ffprobe is truly unavailable or the output is unparseable, logging
    a structlog warning so the degraded state is observable.
    """
    argv = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, check=True)
        payload = json.loads(proc.stdout)
        stream = payload["streams"][0]
        sample_rate = int(stream["sample_rate"])
        channels = int(stream["channels"])
        duration = float(payload["format"]["duration"])
    except (
        FileNotFoundError,
        subprocess.CalledProcessError,
        json.JSONDecodeError,
        KeyError,
        IndexError,
        ValueError,
    ) as exc:
        log.warning(
            "ffprobe_failed_using_fallback",
            path=str(path),
            error=str(exc),
            fallback=_PROBE_FALLBACK,
        )
        return _PROBE_FALLBACK
    return (sample_rate, duration, channels)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ABRA_", env_file=".env", extra="ignore")

    title: str = "The Mathematician's Melodies — Afhverju Abra"

    project_root: Path = _PROJECT_ROOT
    audio_path: Path = _DEFAULT_AUDIO
    render_filename: str = "Afhverju-Abra_fullblast.mp4"
    clip_prefix: str = "Afhverju-Abra_202606021704"

    # Where recorded vocal takes + their mixes live. Defaults to
    # project_root/takes; override via ABRA_TAKES_DIR_OVERRIDE.
    takes_dir_override: Path | None = None
    # Manual purge horizon for stale takes (see the purge task).
    take_ttl_days: int = 30

    # CORS origins for the Vite/bun dev server.
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = True
    log_json: bool = False

    # ---- derived paths -------------------------------------------------
    @property
    def cut_path(self) -> Path:
        return self.project_root / "cut.json"

    @property
    def clips_path(self) -> Path:
        return self.project_root / "clips.json"

    @property
    def labels_path(self) -> Path:
        return self.project_root / "Abravisur_labels.txt"

    @property
    def word_times_path(self) -> Path:
        ctc = self.project_root / "word_times_ctc.json"
        return ctc if ctc.exists() else self.project_root / "word_times_onset.json"

    @property
    def beats_path(self) -> Path:
        return self.project_root / "beats.json"

    @property
    def render_path(self) -> Path:
        return self.project_root / self.render_filename

    @property
    def takes_dir(self) -> Path:
        return self.takes_dir_override or (self.project_root / "takes")

    def clip_path(self, clip_id: int) -> Path:
        return self.project_root / f"{self.clip_prefix}_{clip_id}.mp4"

    # ---- probed backing facts (song-agnostic) --------------------------
    def backing_facts(self) -> tuple[int, float, int]:
        """Probe the backing track for ``(sample_rate, duration, channels)``.

        Cheap enough to call once at lifespan and stash on ``app.state``; never
        hardcodes this song's values — everything comes from ``audio_path``.
        """
        return probe_audio(self.audio_path)


@lru_cache
def get_settings() -> Settings:
    return Settings()
