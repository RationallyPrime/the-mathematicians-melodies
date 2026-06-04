"""A tiny single-slot render manager: shells out to the `build_v3.py` pipeline
in the project root and tracks status, so the editor can re-render the cut.

One render at a time — re-rendering is GPU/ffmpeg-heavy and there is exactly one
output file. A queued request while running is rejected (409) by the route.
"""

from __future__ import annotations

import asyncio
from collections import deque
from pathlib import Path

from .domain import RenderStatus
from .logging import get_logger

log = get_logger("render")
_TAIL_LINES = 40


class RenderManager:
    def __init__(self, project_root: Path) -> None:
        self._root = project_root
        self._status = RenderStatus(state="idle")
        self._task: asyncio.Task[None] | None = None
        self._counter = 0

    @property
    def busy(self) -> bool:
        return self._status.state in ("queued", "running")

    def status(self) -> RenderStatus:
        return self._status

    def start(self) -> RenderStatus:
        if self.busy:
            return self._status
        self._counter += 1
        job_id = f"render-{self._counter}"
        self._status = RenderStatus(state="queued", job_id=job_id)
        self._task = asyncio.create_task(self._run(job_id))
        return self._status

    async def _run(self, job_id: str) -> None:
        log.info("render.start", job_id=job_id)
        tail: deque[str] = deque(maxlen=_TAIL_LINES)
        self._status = RenderStatus(state="running", job_id=job_id)
        try:
            proc = await asyncio.create_subprocess_exec(
                "uv",
                "run",
                "build_v3.py",
                cwd=str(self._root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert proc.stdout is not None
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                tail.append(line)
                self._status = RenderStatus(
                    state="running", job_id=job_id, log_tail="\n".join(tail)
                )
            rc = await proc.wait()
            self._status = RenderStatus(
                state="done" if rc == 0 else "failed",
                job_id=job_id,
                returncode=rc,
                log_tail="\n".join(tail),
            )
            log.info("render.finished", job_id=job_id, returncode=rc)
        except Exception as exc:  # noqa: BLE001 — surface any launch failure to the client
            tail.append(f"render manager error: {exc!r}")
            self._status = RenderStatus(
                state="failed", job_id=job_id, returncode=-1, log_tail="\n".join(tail)
            )
            log.error("render.error", job_id=job_id, error=str(exc))
