#!/usr/bin/env python3
"""Forced-align the known lyrics to the isolated vocal stem with the ONNX
MMS_FA aligner (uroman romanization -> handles Icelandic þ/ð/æ/ö).
Emits word_times_ctc.json in the same schema as the onset fallback."""

import json
import os
from pathlib import Path

import ctc_forced_aligner as c

ROOT = Path("/home/rationallyprime/Videos/Afhverju-Abra")
VOCALS = "/home/rationallyprime/Downloads/separated/htdemucs/Aravísur/vocals.wav"
LABELS = ROOT / "Abravisur_labels.txt"

lines = []
for raw in LABELS.read_text(encoding="utf-8").splitlines():
    if raw.strip():
        s, e, t = raw.split("\t")
        lines.append((float(s), float(e), t))
disp_words = [ln[2].split() for ln in lines]
counts = [len(w) for w in disp_words]
full_text = " ".join(ln[2] for ln in lines)

mp = os.path.expanduser("~/ctc_forced_aligner/model.onnx")
c.ensure_onnx_model(mp, c.MODEL_URL)
al = c.Alignment(mp)
model, tok = al.alignment_model, al.alignment_tokenizer


full_wave = c.load_audio(VOCALS)  # 16 kHz mono float
SR = c.SAMPLING_FREQ
PAD = 0.20  # small window padding (s)


def align_window(text, w0, w1):
    a = max(0, int((w0 - PAD) * SR))
    b = min(len(full_wave), int((w1 + PAD) * SR))
    seg = full_wave[a:b]
    emissions, stride = c.generate_emissions(model, seg, batch_size=4)
    toks, text_starred = c.preprocess_text(text, romanize=True, language="isl")
    segments, scores, blank = c.get_alignments(emissions, toks, tok)
    spans = c.get_spans(toks, segments, blank)
    wts = c.postprocess_results(text_starred, spans, stride, scores)
    real = [w for w in wts if str(w.get("text", "")).strip() not in ("<star>", "*", "")]
    off = a / SR
    return [(float(w["start"]) + off, float(w["end"]) + off) for w in real]


out = []
for (s, e, text), dw, n in zip(lines, disp_words, counts, strict=True):
    times = align_window(text, s, e)
    words = []
    for i, w in enumerate(dw):
        if i < len(times):
            st, en = times[i]
        else:  # safety: even split of remaining
            st = s + (e - s) * i / max(1, n)
            en = s + (e - s) * (i + 1) / max(1, n)
        st = min(max(st, s - PAD), e)
        en = min(max(en, st + 0.05), e + PAD)
        words.append({"word": w, "start": round(st, 3), "end": round(en, 3)})
    out.append({"start": s, "end": e, "text": text, "words": words})
    print(f"L{lines.index((s, e, text)) + 1:>2} [{s:6.2f}-{e:6.2f}] aligned {len(times)}/{n}")

(ROOT / "word_times_ctc.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print("wrote word_times_ctc.json")
# quick sanity: show line 8 (death ray) and line 17 (eureka) word times
for idx in (7, 16):
    o = out[idx]
    print(f"L{idx + 1}", [(w["word"], w["start"]) for w in o["words"]])
