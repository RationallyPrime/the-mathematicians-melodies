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

# run the FastAPI backend on http://127.0.0.1:5678  (docs at /docs)
api:
    cd web/backend && uv run python -m abra_api

# run the Vite/bun dev server on http://localhost:4321 (proxies /api -> :5678)
web:
    cd web/frontend && bun run dev

# run both dev servers together (backend :5678 + frontend :4321); Ctrl-C stops both
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT
    just api &
    just web &
    wait

# typecheck + production build of the frontend
web-build:
    cd web/frontend && bun run build

# run the backend test suite (pytest + hypothesis)
test:
    cd web/backend && uv run pytest -q

# purge recorded takes older than the configured TTL (ABRA_TAKE_TTL_DAYS)
takes-clean:
    cd web/backend && uv run python -c "from abra_api.config import get_settings; from pathlib import Path; import shutil,time; s=get_settings(); d=s.takes_dir; cutoff=time.time()-s.take_ttl_days*86400; [shutil.rmtree(p) for p in (d.iterdir() if d.exists() else []) if p.is_dir() and p.stat().st_mtime < cutoff]; print('takes-clean done')"

# reproduce one take's mix offline from its persisted meta.json + raw.wav
# Reruns the mixer's ffmpeg argv (build_mix_argv) against the probed backing,
# writing the deliverable next to the take. Pass ID=<take-id>.
take ID='':
    cd web/backend && uv run python -c "import sys,subprocess; sys.argv=['take','{{ID}}']; \
    from abra_api.config import get_settings; from abra_api.domain import TakeMixRequest; \
    from abra_api.takes import FilesystemTakeRepository, build_mix_argv; \
    s=get_settings(); repo=FilesystemTakeRepository(s); take=repo.get('{{ID}}'); \
    sr,dur,_=s.backing_facts(); \
    argv,out=build_mix_argv(take, TakeMixRequest(), audio_path=s.audio_path, render_path=s.render_path, backing_sr=sr, backing_duration=dur, repo=repo); \
    print('ffmpeg argv:', argv); subprocess.run(argv, check=True); print('reproduced ->', out)"

# ---- audio (PipeWire) — toggleable recording profile ----------------------
# Runtime-only PipeWire/PulseAudio state: no sudo, no config files, fully
# reversible with `audio-normal`. The Yeti Nano has a headphone jack with
# hardware (zero-latency) monitoring, so we optimise the graph for DROPOUT-FREE
# capture (a stable, pinned clock quantum) over low software-monitoring latency.
# Devices are resolved by name match ("yeti"), so no machine serial lands in the repo.
QUANTUM := "1024"   # frames @48kHz ≈ 21 ms.  ↑ if you hear dropouts;  ↓ for tighter SW monitoring.

# switch to the recording-optimised profile (Yeti default I/O · mic 0 dB · clock pinned)
audio-record:
    #!/usr/bin/env bash
    set -euo pipefail
    src=$(pactl list sources short | awk 'tolower($0) ~ /yeti/ && /input/ {print $2; exit}')
    snk=$(pactl list sinks   short | awk 'tolower($0) ~ /yeti/ {print $2; exit}')
    [ -n "${src:-}" ] && pactl set-default-source "$src"
    [ -n "${snk:-}" ] && pactl set-default-sink   "$snk"
    pactl set-source-mute   @DEFAULT_SOURCE@ 0
    pactl set-source-volume @DEFAULT_SOURCE@ 100%
    pw-metadata -n settings 0 clock.force-quantum {{QUANTUM}}
    echo "▶ record mode — Yeti default · mic 0 dB · quantum {{QUANTUM}} pinned. Monitor through the Yeti's own headphone jack (zero latency)."

# restore everyday audio (dynamic clock quantum; the graph repartitions on demand again)
audio-normal:
    pw-metadata -n settings 0 clock.force-quantum 0
    @echo "■ normal mode — dynamic clock restored."

# show current audio state (defaults · pinned quantum · mic level)
audio-status:
    @pactl info | grep -E 'Default Source|Default Sink|Default Sample'
    @pw-metadata -n settings 0 clock.force-quantum 2>/dev/null | tail -1
    @pactl get-source-volume @DEFAULT_SOURCE@ | head -1

# remove generated renders & frame dumps (keeps source clips + assets)
clean:
    rm -f Afhverju-Abra_full.mp4 Afhverju-Abra_novocals.mp4 \
          Afhverju-Abra_lyrics.mp4 Afhverju-Abra_karaoke.mp4 \
          Afhverju-Abra_fullblast.mp4
    rm -rf screens montages
