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

# remove generated renders & frame dumps (keeps source clips + assets)
clean:
    rm -f Afhverju-Abra_full.mp4 Afhverju-Abra_novocals.mp4 \
          Afhverju-Abra_lyrics.mp4 Afhverju-Abra_karaoke.mp4 \
          Afhverju-Abra_fullblast.mp4
    rm -rf screens montages
