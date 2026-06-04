"""FastAPI application factory and routes.

The contract here *is* the frontend's source of truth: every response model is a
Pydantic domain type, every route has a stable `operation_id`, so Orval turns
this OpenAPI document into typed TanStack Query hooks + Zod schemas.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import Settings, get_settings
from .domain import (
    BeatGrid,
    ClipInfo,
    Cut,
    CutUpdate,
    LyricLine,
    Project,
    RenderInfo,
    RenderStatus,
)
from .logging import configure_logging, get_logger
from .render import RenderManager
from .repository import CutValidationError, ProjectRepository

log = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = get_settings()
    configure_logging(json_logs=settings.log_json)
    app.state.settings = settings
    app.state.repo = ProjectRepository(settings)
    app.state.render = RenderManager(settings.project_root)
    log.info("api.startup", project_root=str(settings.project_root))
    yield
    log.info("api.shutdown")


def get_repo(request: Request) -> ProjectRepository:
    return request.app.state.repo


def get_render(request: Request) -> RenderManager:
    return request.app.state.render


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


Repo = Annotated[ProjectRepository, Depends(get_repo)]
Render = Annotated[RenderManager, Depends(get_render)]
Config = Annotated[Settings, Depends(get_app_settings)]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.title,
        version="0.1.0",
        summary="Karaoke cut + lyric data for the Afhverju Abra web player / editor.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ---- data ----------------------------------------------------------
    @app.get("/api/healthz", tags=["meta"], operation_id="healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/project", response_model=Project, tags=["project"], operation_id="getProject")
    def get_project(repo: Repo) -> Project:
        return repo.project()

    @app.get("/api/cut", response_model=Cut, tags=["cut"], operation_id="getCut")
    def get_cut(repo: Repo) -> Cut:
        return repo.load_cut()

    @app.put("/api/cut", response_model=Cut, tags=["cut"], operation_id="updateCut")
    def update_cut(payload: CutUpdate, repo: Repo) -> Cut:
        try:
            return repo.save_cut(payload)
        except CutValidationError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    @app.get("/api/clips", response_model=list[ClipInfo], tags=["cut"], operation_id="getClips")
    def get_clips(repo: Repo) -> list[ClipInfo]:
        return repo.load_clips()

    @app.get(
        "/api/lyrics", response_model=list[LyricLine], tags=["lyrics"], operation_id="getLyrics"
    )
    def get_lyrics(repo: Repo) -> list[LyricLine]:
        return repo.load_lyrics()

    @app.get("/api/beats", response_model=BeatGrid, tags=["lyrics"], operation_id="getBeats")
    def get_beats(repo: Repo) -> BeatGrid:
        return repo.load_beats()

    # ---- render --------------------------------------------------------
    @app.get(
        "/api/render", response_model=RenderInfo, tags=["render"], operation_id="getRenderInfo"
    )
    def get_render_info(repo: Repo) -> RenderInfo:
        return repo.render_info()

    @app.post(
        "/api/render", response_model=RenderStatus, tags=["render"], operation_id="startRender"
    )
    def start_render(render: Render) -> RenderStatus:
        if render.busy:
            raise HTTPException(status.HTTP_409_CONFLICT, "a render is already running")
        return render.start()

    @app.get(
        "/api/render/status",
        response_model=RenderStatus,
        tags=["render"],
        operation_id="getRenderStatus",
    )
    def get_render_status(render: Render) -> RenderStatus:
        return render.status()

    # ---- media (binary; not part of the generated client) --------------
    def _file_or_404(path, media_type: str, *, filename: str | None = None) -> FileResponse:
        if not path.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"{path.name} not found")
        return FileResponse(path, media_type=media_type, filename=filename)

    @app.get("/api/media/render", include_in_schema=False)
    def media_render(cfg: Config) -> FileResponse:
        return _file_or_404(cfg.render_path, "video/mp4")

    @app.get("/api/media/audio", include_in_schema=False)
    def media_audio(cfg: Config) -> FileResponse:
        return _file_or_404(cfg.audio_path, "audio/wav")

    @app.get("/api/media/clip/{clip_id}", include_in_schema=False)
    def media_clip(clip_id: int, cfg: Config) -> FileResponse:
        return _file_or_404(cfg.clip_path(clip_id), "video/mp4")

    return app


app = create_app()
