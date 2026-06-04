"""`python -m abra_api` / `uv run python -m abra_api` — dev server entrypoint."""

from __future__ import annotations

import uvicorn

from .config import get_settings


def main() -> None:
    s = get_settings()
    uvicorn.run("abra_api.app:app", host=s.host, port=s.port, reload=s.reload)


if __name__ == "__main__":
    main()
