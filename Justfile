# Afhverju Abra — task runner.  `just` with no args lists everything.
# Pipeline order: fetch -> beats -> align -> karaoke -> render  (or just `build`).

# canonical project env (reuses the existing one if present)
export UV_PROJECT_ENVIRONMENT := ".venv"

_default:
    @just --list

# create the venv and install all dependencies (incl. cu124 torch)
setup:
    uv sync

# download media assets from the private HF dataset (run `hf auth login` first)
fetch:
    uv run fetch_assets.py

# beat / onset analysis -> beats.json (+ onset word-timing fallback)
beats:
    uv run analyze_audio.py

# GPU forced-alignment of lyrics to the vocal stem -> word_times_ctc.json
align:
    uv run align_ctc.py

# generate the animated kinetic-karaoke subtitle file -> Abravisur_anim.ass
karaoke:
    uv run karaoke_ass.py

# final render: crossfades + beat-snapped cuts + animated karaoke
render:
    uv run build_v3.py

# whole pipeline from existing assets to the finished video
build: beats align karaoke render

# clip<->lyric alignment contact sheet (sanity check)
verify:
    uv run verify_align.py

# lint and format with ruff
lint:
    uvx ruff check .

fmt:
    uvx ruff format .

# ---- web app (bun frontend + FastAPI backend) -----------------------------

# install web deps: backend (uv) + frontend (bun)
web-setup:
    cd web/backend && uv sync
    cd web/frontend && bun install

# dump OpenAPI from the Pydantic models, then regenerate the typed client (orval)
gen:
    cd web/backend && uv run python -c "import json; from abra_api.app import create_app; open('openapi.json','w').write(json.dumps(create_app().openapi()))"
    cd web/frontend && bun run gen

# run the FastAPI backend on http://127.0.0.1:8000  (docs at /docs)
api:
    cd web/backend && uv run python -m abra_api

# run the Vite/bun dev server on http://localhost:5173 (proxies /api -> :8000)
web:
    cd web/frontend && bun run dev

# typecheck + production build of the frontend
web-build:
    cd web/frontend && bun run build

# remove generated renders & frame dumps (keeps source clips + assets)
clean:
    rm -f Afhverju-Abra_full.mp4 Afhverju-Abra_novocals.mp4 \
          Afhverju-Abra_lyrics.mp4 Afhverju-Abra_karaoke.mp4 \
          Afhverju-Abra_fullblast.mp4
    rm -rf screens montages
