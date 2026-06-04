# The Mathematician's Melodies — *Afhverju Abra*

A karaoke music video for the Icelandic kids' science song **Aravísur**
("Afhverju Abra" — *Why, Abra?*), built from 21 AI-generated clips of **Abra**,
a curious yellow cat who wants to know what causes heat, whether the sun makes
rays, and if Spinoza crushed free will.

The pipeline re-orders the clips to match the lyrics, strips the vocals for a
karaoke backing track, **forced-aligns** the lyrics to the singing for
syllable-accurate timing, and burns in **animated, verse-themed karaoke** over
**beat-synced crossfades**.

> **Status:** v0.2.0 — full-blast cut + a bun/FastAPI web player & cut editor. 🐱🔊
> Code: MIT · Media: private HF dataset (rights reserved) · Type checker: vibes on the render scripts, strict on the web app.

---

## Quickstart

```sh
just setup          # uv sync — creates .venv with all deps (incl. cu124 torch)
hf auth login       # the asset dataset is private
just fetch          # pull clips + audio from Hugging Face into place
just build          # beats -> align -> karaoke -> render  => the finished video
```

`just` with no args lists every task. Requires `ffmpeg`, ImageMagick (for
`just verify`), an NVIDIA GPU for alignment, and [`uv`](https://docs.astral.sh/uv/).

## Tasks

| Task | What it does |
|---|---|
| `just setup` | `uv sync` — venv + dependencies |
| `just fetch` | download media from the HF dataset (`fetch_assets.py`) |
| `just beats` | beat/onset analysis → `beats.json` |
| `just align` | GPU forced-alignment of lyrics → `word_times_ctc.json` |
| `just karaoke` | animated kinetic-karaoke subtitles → `Abravisur_anim.ass` |
| `just render` | final render (crossfades + beat-snapped + animated karaoke) |
| `just build` | the whole pipeline, beats → render |
| `just verify` | per-lyric-line alignment contact sheet |
| `just lint` / `just fmt` | ruff |
| `just clean` | remove renders + frame dumps |

## How it works

- **Clip order ≠ filename order.** Clips are placed to match lyric *content* —
  the Archimedes death-ray (mirror → beam → burning ships) on *"herskipin þurfa
  að brenna"*, the bath on *"fara í bað? (Eureka!)"*, the Spinoza portrait on the
  free-will line. The `EDIT` list in `build_v3.py` is the cut:
  `(clip_number, source_start, slot_length)`.
- **Forced alignment is per-line.** Aligning the whole 167 s at once drifts ~20 s
  across the big instrumental gaps, so each line is aligned inside its own label
  window (`align_ctc.py`, ONNX MMS_FA + uroman/unidecode romanization for the
  Icelandic þ/ð/æ/ö).
- **Karaoke is burned at absolute audio times**, decoupled from clip boundaries,
  so cuts can be crossfaded and beat-snapped without desyncing a single word.
  Each word is its own positioned event that pops + recolors when sung.
- **Verse themes:** gold (lines 1–8) → cyan (9–17) → magenta (18–21).

## Project layout

| Path | What |
|---|---|
| `Abravisur_labels.txt` | lyrics — TSV `start⇥end⇥text`, one line per phrase |
| `analyze_audio.py` | beat/onset detection + onset word-timing fallback |
| `align_ctc.py` | GPU CTC forced alignment → `word_times_ctc.json` |
| `karaoke_ass.py` | animated kinetic-karaoke `.ass` generator |
| `build_v3.py` | final render (crossfades + beat-snap + animated karaoke) |
| `verify_align.py` | alignment contact-sheet sanity check |
| `fetch_assets.py` | pull media from the HF dataset |
| `*.json`, `Abravisur_anim.ass` | derived alignment / lyric assets |

Media (source clips, audio stems, rendered videos) and the `.venv`, `screens/`,
`montages/` are **not in git** — see below.

## Assets (Hugging Face dataset)

Media lives in the **private** dataset
[`RationallyPrime/Whimsy-Daisy`](https://huggingface.co/datasets/RationallyPrime/Whimsy-Daisy):

- `clips/Afhverju-Abra_202606021704_*.mp4` — the 21 source clips
- `audio/no_vocals.wav` — instrumental backing track (karaoke audio, 167.69 s)
- `audio/vocals.wav` — isolated vocals (forced alignment)
- `renders/Afhverju-Abra_fullblast.mp4` — the finished video

`just fetch` (→ `fetch_assets.py`) drops clips at the repo root and audio under
`~/Downloads/separated/htdemucs/Aravísur/`, where the build scripts expect them.

## Web app

A bun-managed React front-end (`web/frontend`) over a FastAPI backend
(`web/backend`): a **player** (the render with a beat-synced word teleprompter +
a clickable slot ribbon) and a **cut editor** that writes `cut.json` — the same
file the pipeline renders from. End-to-end type-safe: Pydantic v2 → OpenAPI →
Orval → TanStack Query hooks + Zod. See [`web/README.md`](web/README.md).

```sh
just web-setup && just gen   # install deps + generate the typed client
just api                     # FastAPI on :5678
just web                     # Vite/bun dev on :4321  (proxies /api)
```

## Roadmap

- [ ] Narrative re-cut of the pre/post-vocal sections + color grade across clips
- [x] **Frontend** — a bun/FastAPI web player + cut editor (see [`web/`](web/README.md))
- [ ] **Vocal-overlay recording** — capture take-home vocal tracks over the karaoke
- [ ] Title card + end credits
- [ ] Tighter per-syllable karaoke timing

## License

Code is **MIT** (see `LICENSE`). The media assets — the song *Aravísur*, the
vocal/instrumental stems, the clips, and the rendered videos — are **not**
covered and are not licensed for redistribution; all rights reserved by their
respective owners.
