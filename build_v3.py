#!/usr/bin/env python3
"""v3 'full blast': crossfades + beat-snapped cuts + animated word-karaoke.

- Clip order/trims as v2 but every clip capped so it has >=D spare source.
- Each clip is extended by the crossfade duration D so xfade transitions land
  exactly on the (beat-snapped) cut boundaries -> total stays 167.69s, and the
  karaoke (burned at absolute audio times) stays perfectly synced.
"""

import json
import subprocess
from pathlib import Path

from cut import edit_list, load_cut

ROOT = Path("/home/rationallyprime/Videos/Afhverju-Abra")
PREFIX = "Afhverju-Abra_202606021704"
AUDIO = "/home/rationallyprime/Downloads/separated/htdemucs/Aravísur/no_vocals.wav"
ASS = "Abravisur_anim.ass"
OUT = ROOT / "Afhverju-Abra_fullblast.mp4"

# The cut lives in cut.json (single source of truth, shared with the web app).
# slot_len sums to 167.69; every non-last clip has ss+len <= 9.6 (3.6 for clip2)
# so it can extend by the crossfade D and still have source to spare.
_cut = load_cut()
D = float(_cut["crossfade"])  # crossfade duration
EDIT = edit_list(_cut)
N = len(EDIT)
beats = json.loads((ROOT / "beats.json").read_text())["beats"]


def snap(t):
    b = min(beats, key=lambda x: abs(x - t))
    return round(b, 3) if abs(b - t) <= 0.12 else round(t, 3)


# boundaries -> beat-snap the internal ones
T = [0.0]
for *_, L in EDIT:
    T.append(T[-1] + L)
total = T[-1]
T = [0.0] + [snap(t) for t in T[1:-1]] + [round(total, 3)]
slots = [T[i + 1] - T[i] for i in range(N)]


def srcmax(clip):
    return 4.0 if clip == 2 else 10.0


inputs, S = [], []
for i, (clip, ss, _) in enumerate(EDIT):
    ext = D if i < N - 1 else 0.0
    s_len = min(slots[i] + ext, srcmax(clip) - ss)
    S.append(s_len)
    inputs += ["-ss", f"{ss:.3f}", "-t", f"{s_len:.3f}", "-i", f"{ROOT}/{PREFIX}_{clip}.mp4"]
inputs += ["-i", AUDIO]

fc = ""
for i in range(N):
    fc += f"[{i}:v]scale=1280:720,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v{i}];"
prev, merged = "v0", S[0]
for i in range(1, N):
    off = merged - D
    out = f"x{i}" if i < N - 1 else "vcat"
    fc += f"[{prev}][v{i}]xfade=transition=fade:duration={D}:offset={off:.3f}[{out}];"
    merged += S[i] - D
    prev = out
fc += f"[vcat]ass={ASS}[v]"

cmd = [
    "ffmpeg",
    "-y",
    *inputs,
    "-filter_complex",
    fc,
    "-map",
    "[v]",
    "-map",
    f"{N}:a",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "24",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    str(OUT),
]

print(f"merged video len ~{merged:.2f}s (trimmed to audio via -shortest)")
print("snapped boundaries:", [f"{t:.1f}" for t in T])
p = subprocess.run(cmd, cwd=ROOT, stderr=subprocess.STDOUT, stdout=subprocess.PIPE, text=True)
print(p.stdout[-1200:])
print("rc", p.returncode)
