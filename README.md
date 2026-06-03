# Afhverju Abra — karaoke music video

A lyric / karaoke music video for the Icelandic kids' science song **Aravísur**
("Afhverju Abra"), assembled from 21 AI-generated clips of *Abra*, a curious
yellow cat. Clips are re-ordered to match the lyrics, the original vocals are
removed (htdemucs) for a karaoke backing track, and forced-aligned per-word
lyrics are burned in with animated, beat-synced styling.

## Layout

Media assets (clips, audio, rendered videos) are **not in git** — they live in a
companion **Hugging Face dataset** (see *Assets* below). This repo is code only.

| Path | Tracked | What |
|---|---|---|
| `Afhverju-Abra_202606021704_*.mp4` (1–21) | ⬇️ HF | Source clips (irreplaceable AI generations) |
| `Abravisur_labels.txt` | ✅ | Lyrics — TSV `start⇥end⇥text`, one line per lyric phrase |
| `align_ctc.py` | ✅ | GPU CTC forced alignment → `word_times_ctc.json` |
| `analyze_audio.py` | ✅ | Beat/onset detection → `beats.json`; onset word-timing fallback |
| `karaoke_ass.py` | ✅ | Animated kinetic-karaoke ASS → `Abravisur_anim.ass` |
| `build_v3.py` | ✅ | Final render: crossfades + beat-snapped cuts + animated karaoke |
| `build_v2.py` | ✅ | Simpler render: hard cuts, interpolated karaoke |
| `build_lyrics_video.sh` | ✅ | First pass: plain concat + SRT subtitles |
| `verify_align.py` | ✅ | Per-lyric-line alignment contact sheet |
| `*.json`, `Abravisur*.ass/.srt` | ✅ | Derived alignment/lyric assets |
| `Afhverju-Abra_{full,novocals,lyrics,karaoke,fullblast}.mp4` | ❌ | Rendered outputs (rebuild) |
| `screens/`, `montages/` | ❌ | Generated frames / contact sheets |
| `.venv-fx/` | ❌ | uv venv (5.4 G) |

### Assets (Hugging Face dataset)
The media assets are published as a HF dataset: **`<DATASET_ID>`** (filled in
once created). It contains:
- `clips/Afhverju-Abra_202606021704_*.mp4` — the 21 source clips
- `audio/no_vocals.wav` — instrumental backing track (karaoke audio, 167.69 s)
- `audio/vocals.wav` — isolated vocals (used for forced alignment)
- `renders/Afhverju-Abra_fullblast.mp4` — the finished video

Locally, the build scripts currently reference the audio stems by absolute path
under `~/Downloads/separated/htdemucs/Aravísur/`; `fetch_assets.py` (added with
the dataset) pulls everything from HF into the expected layout.

## Environment

```sh
uv venv .venv-fx --python 3.12
uv pip install --python .venv-fx numpy scipy librosa soundfile pillow \
    torch torchaudio --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv-fx ctc-forced-aligner unidecode
```
Needs an NVIDIA GPU for the aligner (developed on an RTX 4080). `ffmpeg` must be
on PATH.

## Build (full-blast cut)

```sh
.venv-fx/bin/python analyze_audio.py   # beats.json + onset fallback
.venv-fx/bin/python align_ctc.py       # word_times_ctc.json (per-line CTC)
.venv-fx/bin/python karaoke_ass.py     # Abravisur_anim.ass
.venv-fx/bin/python build_v3.py        # -> Afhverju-Abra_fullblast.mp4
```

## How it fits together

- **Clip order ≠ filename order.** Clips are placed to match lyric *content*
  (death-ray on "herskipin þurfa að brenna", bath on "fara í bað? (Eureka!)",
  Spinoza portrait on the free-will line, …). The `EDIT` list in `build_v3.py`
  is the cut: `(clip_number, source_start, slot_length)`.
- **Alignment is per-line.** Aligning the whole 167 s at once drifts ~20 s
  across the big instrumental gaps, so each line is aligned inside its own label
  window.
- **Karaoke is burned at absolute audio times**, decoupled from clip
  boundaries, so cuts can be crossfaded and beat-snapped without desyncing the
  words.
- **Verse themes:** gold (lines 1–8) → cyan (9–17) → magenta (18–21).

## Variants

- `Afhverju-Abra_fullblast.mp4` — the works (forced-aligned animated karaoke,
  crossfades, beat-snapped cuts).
- `Afhverju-Abra_karaoke.mp4` — simpler hard-cut karaoke (`build_v2.py`).
- `Afhverju-Abra_novocals.mp4` — concat + audio swap, no lyrics.
