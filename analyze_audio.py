#!/usr/bin/env python3
"""Beat/onset analysis for beat-synced cutting, + an onset-based word-timing
fallback from the isolated vocal stem (used if CTC alignment is unavailable)."""
import json
from pathlib import Path
import numpy as np
import librosa

ROOT = Path("/home/rationallyprime/Videos/Afhverju-Abra")
MUSIC = "/home/rationallyprime/Downloads/separated/htdemucs/Aravísur/no_vocals.wav"
VOCALS = "/home/rationallyprime/Downloads/separated/htdemucs/Aravísur/vocals.wav"
LABELS = ROOT / "Abravisur_labels.txt"


def beats():
    y, sr = librosa.load(MUSIC, sr=None, mono=True)
    tempo, beat_f = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beat_t = librosa.frames_to_time(beat_f, sr=sr)
    # also onset envelope peaks for finer snap points
    onset_t = librosa.onset.onset_detect(y=y, sr=sr, units="time",
                                          backtrack=True)
    tempo = float(np.atleast_1d(tempo)[0])
    (ROOT / "beats.json").write_text(json.dumps(
        {"tempo": tempo, "beats": [round(float(t), 3) for t in beat_t],
         "onsets": [round(float(t), 3) for t in onset_t]}))
    print(f"tempo ~{tempo:.1f} BPM, {len(beat_t)} beats, {len(onset_t)} onsets")
    print("first beats:", [round(float(t), 2) for t in beat_t[:8]])
    return beat_t


def word_times_from_vocals():
    """Per-word timestamps: detect vocal onsets inside each line window and
    distribute the line's words across them (energy-aware fallback)."""
    y, sr = librosa.load(VOCALS, sr=None, mono=True)
    lines = []
    for raw in LABELS.read_text(encoding="utf-8").splitlines():
        if raw.strip():
            s, e, t = raw.split("\t")
            lines.append((float(s), float(e), t))

    out = []
    for s, e, text in lines:
        words = text.split()
        a = int(s * sr)
        b = int(e * sr)
        seg = y[a:b]
        # onset strength within the line, pick the strongest len(words) peaks
        oenv = librosa.onset.onset_strength(y=seg, sr=sr, hop_length=256)
        peaks = librosa.util.peak_pick(oenv, pre_max=3, post_max=3, pre_avg=5,
                                       post_avg=5, delta=0.05, wait=4)
        ptimes = sorted(s + librosa.frames_to_time(peaks, sr=sr, hop_length=256))
        # always include the line start as the first boundary
        bounds = [s] + [p for p in ptimes if p > s + 0.08]
        # reduce/pad to exactly len(words) boundaries
        if len(bounds) >= len(words):
            # keep the strongest-spread subset: take evenly across detected
            idx = np.linspace(0, len(bounds) - 1, len(words)).round().astype(int)
            bounds = [bounds[i] for i in sorted(set(idx))]
            while len(bounds) < len(words):  # safety
                bounds.append(bounds[-1])
        else:
            # not enough onsets: interpolate remaining by char-weight
            extra = len(words) - len(bounds)
            span_start = bounds[-1]
            weights = [max(1, len(w)) for w in words[len(bounds):]]
            tot = sum(weights)
            acc = span_start
            for w in weights:
                acc += (e - span_start) * w / tot / 1.0
                bounds.append(min(acc, e - 0.05))
            bounds = bounds[:len(words)]
        bounds = sorted(bounds)[:len(words)]
        wt = []
        for i, w in enumerate(words):
            ws = bounds[i]
            we = bounds[i + 1] if i + 1 < len(bounds) else e
            wt.append({"word": w, "start": round(ws, 3), "end": round(max(we, ws + 0.06), 3)})
        out.append({"start": s, "end": e, "text": text, "words": wt})
    (ROOT / "word_times_onset.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"onset word-times: {len(out)} lines, {sum(len(o['words']) for o in out)} words")
    return out


if __name__ == "__main__":
    beats()
    word_times_from_vocals()
