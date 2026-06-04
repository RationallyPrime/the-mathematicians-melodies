"""FastAPI application factory and routes.

The contract here *is* the frontend's source of truth: every response model is a
Pydantic domain type, every route has a stable `operation_id`, so Orval turns
this OpenAPI document into typed TanStack Query hooks + Zod schemas.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .config import Settings, get_settings
from .domain import (
    BeatGrid,
    ClipInfo,
    Cut,
    CutUpdate,
    LyricLine,
    Project,
    RecordingConfig,
    RenderInfo,
    RenderStatus,
    Take,
    TakeCreate,
    TakeMixRequest,
    TakeMixStatus,
    TakeUpdate,
)
from .logging import configure_logging, get_logger
from .render import RenderManager
from .repository import CutValidationError, ProjectRepository
from .takes import FilesystemTakeRepository, TakeMixer, TakeNotFound, TakeRepository

log = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = get_settings()
    configure_logging(json_logs=settings.log_json)
    app.state.settings = settings
    app.state.repo = ProjectRepository(settings)
    app.state.render = RenderManager(settings.project_root)

    # ---- vocal-overlay take pipeline -----------------------------------
    settings.takes_dir.mkdir(parents=True, exist_ok=True)
    app.state.takes = FilesystemTakeRepository(settings.takes_dir)
    app.state.mixer = TakeMixer()
    # Probe the backing track once; stash (sample_rate, duration, channels)
    # so routes never reshell ffprobe per request.
    app.state.backing = settings.backing_facts()

    log.info(
        "api.startup",
        project_root=str(settings.project_root),
        takes_dir=str(settings.takes_dir),
        backing=app.state.backing,
    )
    yield
    log.info("api.shutdown")


def get_repo(request: Request) -> ProjectRepository:
    return request.app.state.repo


def get_render(request: Request) -> RenderManager:
    return request.app.state.render


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_takes(request: Request) -> TakeRepository:
    return request.app.state.takes


def get_mixer(request: Request) -> TakeMixer:
    return request.app.state.mixer


Repo = Annotated[ProjectRepository, Depends(get_repo)]
Render = Annotated[RenderManager, Depends(get_render)]
Config = Annotated[Settings, Depends(get_app_settings)]
Takes = Annotated[TakeRepository, Depends(get_takes)]
Mixer = Annotated[TakeMixer, Depends(get_mixer)]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.title,
        version="0.3.0",
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

    # ---- takes (vocal-overlay recording pipeline) ----------------------
    @app.post("/api/takes", response_model=Take, tags=["takes"], operation_id="createTake")
    async def create_take(
        file: UploadFile,
        takes: Takes,
        meta: str = Form(...),
    ) -> Take:
        parsed = TakeCreate.model_validate_json(meta)
        data = await file.read()
        return takes.create(parsed, data)

    @app.get("/api/takes", response_model=list[Take], tags=["takes"], operation_id="listTakes")
    def list_takes(takes: Takes) -> list[Take]:
        return takes.list()

    @app.get(
        "/api/takes/{take_id}", response_model=Take, tags=["takes"], operation_id="getTake"
    )
    def get_take(take_id: str, takes: Takes) -> Take:
        try:
            return takes.get(take_id)
        except TakeNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    @app.patch(
        "/api/takes/{take_id}", response_model=Take, tags=["takes"], operation_id="updateTake"
    )
    def update_take(take_id: str, payload: TakeUpdate, takes: Takes) -> Take:
        try:
            return takes.update(take_id, payload)
        except TakeNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    @app.delete(
        "/api/takes/{take_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["takes"],
        operation_id="deleteTake",
    )
    def delete_take(take_id: str, takes: Takes) -> Response:
        try:
            takes.delete(take_id)
        except TakeNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post(
        "/api/takes/{take_id}/mix",
        response_model=TakeMixStatus,
        tags=["takes"],
        operation_id="mixTake",
    )
    async def mix_take(
        take_id: str,
        body: TakeMixRequest,
        takes: Takes,
        mixer: Mixer,
        cfg: Config,
        request: Request,
    ) -> TakeMixStatus:
        try:
            take = takes.get(take_id)
        except TakeNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
        sr, dur, _ = getattr(request.app.state, "backing", None) or cfg.backing_facts()
        if mixer.status(take_id).state in ("queued", "running"):
            raise HTTPException(status.HTTP_409_CONFLICT, "a mix is already running for this take")
        return mixer.start(
            take,
            body,
            audio_path=cfg.audio_path,
            render_path=cfg.render_path,
            backing_sr=sr,
            backing_duration=dur,
            repo=takes,
            autotune_uri=cfg.autotune_uri,
            lv2_path=cfg.lv2_path,
        )

    @app.get(
        "/api/takes/{take_id}/mix/status",
        response_model=TakeMixStatus,
        tags=["takes"],
        operation_id="getTakeMixStatus",
    )
    def get_take_mix_status(take_id: str, mixer: Mixer) -> TakeMixStatus:
        return mixer.status(take_id)

    # ---- recording (typed hydration so the client carries no constants) -
    @app.get(
        "/api/recording/config",
        response_model=RecordingConfig,
        tags=["recording"],
        operation_id="getRecordingConfig",
    )
    def get_recording_config(request: Request) -> RecordingConfig:
        sr, dur, _ = request.app.state.backing
        return RecordingConfig(backing_duration=dur, backing_sample_rate=sr)

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

    @app.get("/api/media/take/{take_id}/raw", include_in_schema=False)
    def media_take_raw(take_id: str, request: Request) -> FileResponse:
        takes: TakeRepository = request.app.state.takes
        try:
            raw = takes.raw_path(take_id)
        except TakeNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
        return _file_or_404(raw, "audio/wav")

    @app.get("/api/media/take/{take_id}/mix", include_in_schema=False)
    def media_take_mix(take_id: str, request: Request) -> FileResponse:
        takes: TakeRepository = request.app.state.takes
        try:
            path = takes.mix_path(take_id)
        except TakeNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
        if path is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no mix for this take yet")
        ext = path.suffix.lower()
        media_type = "video/mp4" if ext == ".mp4" else "audio/mp4"
        # Song-agnostic download name (no hardcoded song title — this leg must
        # drop onto the next project unchanged).
        return _file_or_404(path, media_type, filename=f"take-{take_id[:8]}{ext}")

    return app


app = create_app()
