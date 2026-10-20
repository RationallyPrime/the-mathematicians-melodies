# Web app — player + cut editor

A little web front-end for the *Afhverju Abra* karaoke cut: a **player** (the
finished render with a beat-synced word teleprompter and a clickable slot
ribbon) and a **cut editor** (retrim / reorder / re-clip the timeline, save, and
trigger a re-render).

End-to-end type-safe, the way the house likes it:

```
Pydantic v2 models  ──▶  FastAPI / OpenAPI  ──▶  Orval  ──▶  TanStack Query hooks
   (backend/)              openapi.json            (codegen)     + Zod schemas (frontend/)
```

The timeline lives in one file — `../cut.json` — read by both the render
pipeline (`build_v3.py`) and this API, and written by the editor. Change the cut
in the browser, hit **Re-render**, and `build_v3.py` rebuilds the video.

## Recording studio

The web app includes a recording studio for vocal takes over the backing track. It captures microphone audio in the browser, persists takes through the API, and mixes them with the backing track using ffmpeg. Recording requires HTTPS or localhost and microphone permission. Takes are stored under the project’s `takes/` directory by default; override it with `ABRA_TAKES_DIR_OVERRIDE`.

From the repository root, `just takes-clean` removes takes older than `ABRA_TAKE_TTL_DAYS` (30 days by default). `just take ID=<take-id>` reproduces a saved take’s mix offline.

## Stack

| Layer | Tech |
|---|---|
| Package manager | **bun** (frontend), **uv** (backend) |
| Backend | FastAPI · uvicorn · pydantic-settings · structlog |
| Build / transpile | Vite + SWC, Lightning CSS |
| Routing / data | TanStack Router + TanStack Query |
| Codegen | Orval (fetch client + react-query hooks + Zod) |
| Lint / format | Biome (frontend) · ruff (backend) |

## Run it

From the project root (`just --list` shows everything):

```sh
just web-setup     # uv sync (backend) + bun install (frontend)
just gen           # dump OpenAPI from the models + orval codegen
just api           # terminal 1 — FastAPI on :5678
just web           # terminal 2 — Vite/bun dev on :4321 (proxies /api)
```

Open <http://localhost:4321>. The dev server proxies `/api` to the backend, so
the app uses same-origin relative URLs in dev and prod alike.

## Layout

```
web/
  backend/   abra_api/{config,logging,domain,repository,render,app}.py
  frontend/  src/{routes,components,lib,api}/  +  orval.config.ts, vite.config.ts
```

- `backend/abra_api/domain.py` is the contract — edit a model, run `just gen`,
  and the frontend types/hooks/Zod regenerate.
- `frontend/src/api/generated/` and `src/api/zod/` are **generated** (gitignored).
- `frontend/src/api/client.ts` is the single fetch mutator every hook flows
  through (base URL + typed errors).

See `backend/README.md` for the full route table.
