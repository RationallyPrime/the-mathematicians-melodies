# abra-api — karaoke web backend

FastAPI service that exposes the *Afhverju Abra* cut, lyrics, beats and renders
to the web player / editor. Reads the pipeline artifacts (`cut.json`,
`clips.json`, `word_times_ctc.json`, `beats.json`) from the project root; writes
`cut.json` when the editor saves.

```sh
uv sync                       # create .venv with fastapi/uvicorn/structlog
uv run python -m abra_api      # dev server on http://127.0.0.1:8000  (--reload)
# docs: http://127.0.0.1:8000/docs   openapi: http://127.0.0.1:8000/openapi.json
```

Config is env-driven (`ABRA_*`, see `abra_api/config.py`) and defaults to the
local pipeline layout, so it runs with zero setup in dev.

| Route | Method | Returns |
|---|---|---|
| `/api/project` | GET | everything the editor needs in one shot |
| `/api/cut` | GET / PUT | the timeline (single source of truth) |
| `/api/clips` | GET | clip catalog |
| `/api/lyrics` | GET | forced-aligned per-word lyrics + verse themes |
| `/api/beats` | GET | beat grid (~107.7 BPM) |
| `/api/render` | GET / POST | render info / trigger a re-render |
| `/api/render/status` | GET | live render status + log tail |
| `/api/media/{render,audio,clip/{id}}` | GET | range-served media (not in the client) |
