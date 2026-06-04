"""Configuration, sourced from the environment via pydantic-settings.

Every path defaults to the layout the render pipeline already uses, so the API
runs with zero config in dev; override with `ABRA_*` env vars in a container.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# web/backend/abra_api/config.py -> parents[3] == the project root.
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_AUDIO = Path.home() / "Downloads/separated/htdemucs/Aravísur/no_vocals.wav"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ABRA_", env_file=".env", extra="ignore")

    title: str = "The Mathematician's Melodies — Afhverju Abra"

    project_root: Path = _PROJECT_ROOT
    audio_path: Path = _DEFAULT_AUDIO
    render_filename: str = "Afhverju-Abra_fullblast.mp4"
    clip_prefix: str = "Afhverju-Abra_202606021704"

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

    def clip_path(self, clip_id: int) -> Path:
        return self.project_root / f"{self.clip_prefix}_{clip_id}.mp4"


@lru_cache
def get_settings() -> Settings:
    return Settings()
