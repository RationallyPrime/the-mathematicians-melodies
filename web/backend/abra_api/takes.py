"""Vocal-overlay take pipeline — persistence + ffmpeg mixing.

A "take" is a recorded vocal WAV the user sang over the backing track, plus the
sample-accurate metadata needed to line it up. This module owns three concerns:

* ``FilesystemTakeRepository`` — the ONLY thing that touches the ``takes/`` tree
  (one dir per take: ``raw.wav`` + ``meta.json``), behind a ``TakeRepository``
  Protocol so the storage backend can be swapped without touching the routes.
* ``TakeMixer`` — a bounded (semaphore-gated) pool of single-take ffmpeg jobs,
  mirroring ``RenderManager``'s state-machine + log-tail idiom but keyed per take.
* ``build_mix_argv`` — a pure, importable ffmpeg argv builder (no I/O) so the
  placement math is unit-testable.

Nothing here is song-specific: the mix depends only on the backing track
(``audio_path``), the optional render (``render_path``) and the take's own probed
metadata. Repoint config at the next song and it all still holds.
"""

from __future__ import annotations

import asyncio
import shutil
import wave
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, runtime_checkable
from uuid import uuid4

from .domain import (
    Take,
    TakeCreate,
    TakeMixRequest,
    TakeMixStatus,
    TakeStatus,
    TakeUpdate,
)
from .logging import get_logger

log = get_logger("takes")

_TAIL_LINES = 40
_MAX_CONCURRENT_MIXES = 2
_RAW_NAME = "raw.wav"
_META_NAME = "meta.json"


class TakeNotFound(ValueError):
    """Raised when a take id has no backing directory; routes map this to 404."""


# ---- ffmpeg argv builder (pure, importable, unit-tested) -------------------
def build_mix_argv(
    *,
    take: Take,
    req: TakeMixRequest,
    audio_path: Path,
    render_path: Path,
    raw_wav: Path,
    out_path: Path,
    backing_sr: int,
    backing_duration: float,
) -> list[str]:
    """Build the full ffmpeg argv (exec form) that mixes a vocal take over the
    backing track.

    Pure: depends only on its arguments, performs no I/O. The vocal WAV is MONO;
    the backing is STEREO, so the vocal leg upmixes via
    ``aformat=...channel_layouts=stereo`` before ``amix`` so both legs match.

    Placement math (sample-accurate against the song timeline):

    * ``net_delay = record_start_song_sec - latency/1000`` — where the vocal
      should sit. Positive -> delay the vocal into the song; negative -> the
      vocal must advance, so we trim its head with ``-ss`` on the raw input.
    """
    kind = req.kind if req.kind is not None else take.kind
    latency = req.latency_ms if req.latency_ms is not None else take.latency_ms

    net_delay = take.record_start_song_sec - latency / 1000.0
    delay_ms = max(0, round(net_delay * 1000))
    head_trim = max(0.0, -net_delay)

    # Input order depends on the deliverable kind; the raw-wav input index
    # (``vidx``) and the backing input index (``bidx``) differ accordingly.
    argv: list[str] = ["ffmpeg", "-y"]

    if kind == "video":
        # 0: render (video source) | 1: backing (no_vocals) | 2: raw vocal wav.
        argv += ["-i", str(render_path)]
        argv += ["-i", str(audio_path)]
        if head_trim > 0:
            argv += ["-ss", f"{head_trim:.3f}"]
        argv += ["-i", str(raw_wav)]
        vidx, bidx = 2, 1
    else:
        # 0: backing (no_vocals) | 1: raw vocal wav.
        argv += ["-i", str(audio_path)]
        if head_trim > 0:
            argv += ["-ss", f"{head_trim:.3f}"]
        argv += ["-i", str(raw_wav)]
        vidx, bidx = 1, 0

    vocal = (
        f"[{vidx}:a]aresample={backing_sr},"
        f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"volume={req.vocal_gain}"
    )
    if net_delay >= 0:
        vocal += f",adelay={delay_ms}|{delay_ms},apad[v]"
    else:
        # Head already advanced by the ``-ss head_trim`` on the raw INPUT.
        vocal += ",apad[v]"

    backing = f"[{bidx}:a]volume={req.backing_gain}[b]"

    mix = (
        "[v][b]amix=inputs=2:duration=longest:normalize=0:dropout_transition=0,"
        "loudnorm=I=-16:TP=-1.5:LRA=11,"
        "alimiter=limit=0.95[mix]"
    )

    argv += ["-filter_complex", ";".join((vocal, backing, mix))]

    if kind == "video":
        # Copy ONLY the render's video; its [0:a] is the fullblast mix WITH the
        # original artist vocals — never touch it or we get double vocals.
        argv += [
            "-map",
            "0:v",
            "-map",
            "[mix]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(backing_sr),
            "-shortest",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    else:
        argv += [
            "-map",
            "[mix]",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(backing_sr),
            "-t",
            f"{backing_duration:.3f}",
            "-movflags",
            "+faststart",
            str(out_path),
        ]

    return argv


# ---- repository ------------------------------------------------------------
@runtime_checkable
class TakeRepository(Protocol):
    """Storage contract for takes; routes depend on this, never on the FS."""

    def create(self, meta: TakeCreate, wav_bytes: bytes) -> Take: ...

    def list(self) -> list[Take]:
        """Newest first."""
        ...

    def get(self, take_id: str) -> Take:
        """Raises ``TakeNotFound`` when the id is unknown."""
        ...

    def update(self, take_id: str, patch: TakeUpdate) -> Take: ...

    def delete(self, take_id: str) -> None: ...

    def raw_path(self, take_id: str) -> Path: ...

    def mix_path(self, take_id: str) -> Path | None:
        """The produced ``mix.<ext>`` if one is present, else ``None``."""
        ...

    def set_status(self, take_id: str, status: TakeStatus) -> Take: ...


class FilesystemTakeRepository:
    """``TakeRepository`` backed by ``{takes_dir}/{uuid}/`` directories.

    Each take dir holds ``raw.wav`` (the uploaded vocal) and ``meta.json`` (the
    serialized :class:`Take`). The computed ``raw_url``/``mix_url`` fields are
    derived, so reads simply re-validate the persisted JSON to recompute them.
    """

    def __init__(self, takes_dir: Path) -> None:
        self._root = takes_dir
        self._root.mkdir(parents=True, exist_ok=True)

    # ---- internals -----------------------------------------------------
    def _dir(self, take_id: str) -> Path:
        return self._root / take_id

    def _meta_file(self, take_id: str) -> Path:
        return self._dir(take_id) / _META_NAME

    def _require_dir(self, take_id: str) -> Path:
        d = self._dir(take_id)
        if not d.is_dir():
            raise TakeNotFound(f"take {take_id} not found")
        return d

    def _read(self, take_id: str) -> Take:
        meta = self._meta_file(take_id)
        if not meta.is_file():
            raise TakeNotFound(f"take {take_id} not found")
        return Take.model_validate_json(meta.read_text(encoding="utf-8"))

    def _write(self, take: Take) -> Take:
        # Re-validate so the persisted form is the canonical (computed) shape.
        self._meta_file(take.id).write_text(
            take.model_dump_json(indent=2), encoding="utf-8"
        )
        return take

    # ---- writes --------------------------------------------------------
    def create(self, meta: TakeCreate, wav_bytes: bytes) -> Take:
        take_id = uuid4().hex
        d = self._dir(take_id)
        d.mkdir(parents=True, exist_ok=True)
        raw = d / _RAW_NAME
        raw.write_bytes(wav_bytes)

        # Trust the bytes on disk over the client-declared meta: probe the WAV
        # with the stdlib so duration/sample_rate are sample-accurate.
        sample_rate = meta.sample_rate
        duration: float | None = None
        try:
            with wave.open(str(raw), "rb") as wf:
                framerate = wf.getframerate()
                nframes = wf.getnframes()
                sample_rate = framerate or sample_rate
                duration = (nframes / framerate) if framerate else None
        except (wave.Error, EOFError, OSError) as exc:
            log.warning(
                "take.wave_probe_failed",
                take_id=take_id,
                error=str(exc),
            )

        take = Take(
            id=take_id,
            status="uploaded",
            kind=meta.kind,
            created_at=datetime.now(UTC),
            latency_ms=meta.latency_ms,
            record_start_song_sec=meta.record_start_song_sec,
            sample_rate=sample_rate,
            duration=duration,
            size_bytes=len(wav_bytes),
            starred=False,
            label=meta.label,
        )
        self._write(take)
        log.info(
            "take.created",
            take_id=take_id,
            kind=take.kind,
            duration=take.duration,
            sample_rate=take.sample_rate,
            size_bytes=take.size_bytes,
        )
        return take

    def list(self) -> list[Take]:
        takes: list[Take] = []
        if not self._root.is_dir():
            return takes
        for child in self._root.iterdir():
            if not child.is_dir():
                continue
            try:
                takes.append(self._read(child.name))
            except (TakeNotFound, ValueError) as exc:
                log.warning("take.read_skipped", take_id=child.name, error=str(exc))
        takes.sort(key=lambda t: t.created_at, reverse=True)
        return takes

    def get(self, take_id: str) -> Take:
        return self._read(take_id)

    def update(self, take_id: str, patch: TakeUpdate) -> Take:
        take = self._read(take_id)
        updates = patch.model_dump(exclude_none=True)
        if not updates:
            return take
        take = take.model_copy(update=updates)
        log.info("take.updated", take_id=take_id, fields=sorted(updates))
        return self._write(take)

    def delete(self, take_id: str) -> None:
        d = self._require_dir(take_id)
        shutil.rmtree(d)
        log.info("take.deleted", take_id=take_id)

    def raw_path(self, take_id: str) -> Path:
        self._require_dir(take_id)
        return self._dir(take_id) / _RAW_NAME

    def mix_path(self, take_id: str) -> Path | None:
        d = self._dir(take_id)
        if not d.is_dir():
            return None
        for name in ("mix.mp4", "mix.m4a"):
            candidate = d / name
            if candidate.is_file():
                return candidate
        return None

    def set_status(self, take_id: str, status: TakeStatus) -> Take:
        take = self._read(take_id)
        take = take.model_copy(update={"status": status})
        return self._write(take)


# ---- mixer -----------------------------------------------------------------
class TakeMixer:
    """A bounded pool of single-take ffmpeg mix jobs.

    Clones ``RenderManager``'s state-machine + streamed-log-tail idiom, but is
    keyed per ``take_id`` and gated by an ``asyncio.Semaphore`` so at most two
    ffmpeg processes run at once. The first log-tail line is the exact argv, so
    a take's mix is fully reproducible from its status.
    """

    def __init__(self, max_concurrent: int = _MAX_CONCURRENT_MIXES) -> None:
        self._sem = asyncio.Semaphore(max_concurrent)
        self._status: dict[str, TakeMixStatus] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._counter = 0

    def status(self, take_id: str) -> TakeMixStatus:
        return self._status.get(take_id, TakeMixStatus(state="idle", take_id=take_id))

    def _busy(self, take_id: str) -> bool:
        return self.status(take_id).state in ("queued", "running")

    def start(
        self,
        take: Take,
        req: TakeMixRequest,
        *,
        audio_path: Path,
        render_path: Path,
        backing_sr: int,
        backing_duration: float,
        repo: TakeRepository,
    ) -> TakeMixStatus:
        """Queue a mix for ``take``. If one is already queued/running for this
        take, the current status is returned unchanged (the route turns that
        into a 409)."""
        if self._busy(take.id):
            return self._status[take.id]

        self._counter += 1
        job_id = f"mix-{self._counter}"
        status = TakeMixStatus(state="queued", take_id=take.id, job_id=job_id)
        self._status[take.id] = status
        self._tasks[take.id] = asyncio.create_task(
            self._run(
                take,
                req,
                job_id=job_id,
                audio_path=audio_path,
                render_path=render_path,
                backing_sr=backing_sr,
                backing_duration=backing_duration,
                repo=repo,
            )
        )
        return status

    async def _run(
        self,
        take: Take,
        req: TakeMixRequest,
        *,
        job_id: str,
        audio_path: Path,
        render_path: Path,
        backing_sr: int,
        backing_duration: float,
        repo: TakeRepository,
    ) -> None:
        kind = req.kind if req.kind is not None else take.kind
        async with self._sem:
            log.info("mix.start", take_id=take.id, job_id=job_id, kind=kind)
            tail: deque[str] = deque(maxlen=_TAIL_LINES)
            try:
                repo.set_status(take.id, "mixing")
            except TakeNotFound as exc:
                self._status[take.id] = TakeMixStatus(
                    state="failed",
                    take_id=take.id,
                    job_id=job_id,
                    returncode=-1,
                    log_tail=f"take vanished before mix: {exc!r}",
                )
                log.error("mix.missing_take", take_id=take.id, job_id=job_id)
                return

            raw_wav = repo.raw_path(take.id)
            out_path = raw_wav.parent / ("mix.mp4" if kind == "video" else "mix.m4a")
            argv = build_mix_argv(
                take=take,
                req=req,
                audio_path=audio_path,
                render_path=render_path,
                raw_wav=raw_wav,
                out_path=out_path,
                backing_sr=backing_sr,
                backing_duration=backing_duration,
            )
            # First tail line is the exact argv -> reproducible from status.
            tail.append("$ " + " ".join(argv))
            self._status[take.id] = TakeMixStatus(
                state="running",
                take_id=take.id,
                job_id=job_id,
                log_tail="\n".join(tail),
            )

            try:
                proc = await asyncio.create_subprocess_exec(
                    *argv,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                assert proc.stdout is not None
                async for raw in proc.stdout:
                    tail.append(raw.decode(errors="replace").rstrip())
                    self._status[take.id] = TakeMixStatus(
                        state="running",
                        take_id=take.id,
                        job_id=job_id,
                        log_tail="\n".join(tail),
                    )
                rc = await proc.wait()
            except Exception as exc:  # noqa: BLE001 — surface launch failures
                tail.append(f"mixer error: {exc!r}")
                self._status[take.id] = TakeMixStatus(
                    state="failed",
                    take_id=take.id,
                    job_id=job_id,
                    returncode=-1,
                    log_tail="\n".join(tail),
                )
                self._safe_set_status(repo, take.id, "failed")
                log.error("mix.error", take_id=take.id, job_id=job_id, error=str(exc))
                return

            if rc == 0:
                self._status[take.id] = TakeMixStatus(
                    state="done",
                    take_id=take.id,
                    job_id=job_id,
                    returncode=rc,
                    log_tail="\n".join(tail),
                    output_url=f"/api/media/take/{take.id}/mix",
                )
                self._safe_set_status(repo, take.id, "done")
            else:
                self._status[take.id] = TakeMixStatus(
                    state="failed",
                    take_id=take.id,
                    job_id=job_id,
                    returncode=rc,
                    log_tail="\n".join(tail),
                )
                self._safe_set_status(repo, take.id, "failed")
            log.info("mix.finished", take_id=take.id, job_id=job_id, returncode=rc)

    @staticmethod
    def _safe_set_status(repo: TakeRepository, take_id: str, status: TakeStatus) -> None:
        try:
            repo.set_status(take_id, status)
        except TakeNotFound:
            log.warning("mix.status_set_skipped", take_id=take_id, status=status)
