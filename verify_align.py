#!/usr/bin/env python3
"""Sample the FINAL karaoke render at each lyric-line midpoint and build a
labeled contact sheet to verify clip<->lyric alignment.

Each tile: top caption = EXPECTED line (n + text); the bottom of the frame
already carries the burned-in karaoke lyric; the image is the actual clip
content. All three should agree.
"""

import subprocess
from pathlib import Path

ROOT = Path("/home/rationallyprime/Videos/Afhverju-Abra")
VIDEO = ROOT / "Afhverju-Abra_karaoke.mp4"
LABELS = ROOT / "Abravisur_labels.txt"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUTDIR = ROOT / "_align"
OUTDIR.mkdir(exist_ok=True)

lines = []
for raw in LABELS.read_text(encoding="utf-8").splitlines():
    if raw.strip():
        s, e, t = raw.split("\t")
        lines.append((float(s), float(e), t))

# instrumental gap probe points (no lyric should be on screen)
gaps = [
    ("intro", 5.0),
    ("intro", 9.5),
    ("break1", 55.0),
    ("break2", 107.0),
    ("break2", 117.0),
    ("break2", 125.0),
    ("outro", 155.0),
    ("outro", 164.0),
]


def grab(t, dst):
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{t}",
            "-i",
            str(VIDEO),
            "-frames:v",
            "1",
            str(dst),
        ],
        check=True,
    )


def caption(src, text, color):
    subprocess.run(
        [
            "convert",
            str(src),
            "-gravity",
            "North",
            "-font",
            FONT,
            "-pointsize",
            "30",
            "-fill",
            color,
            "-undercolor",
            "#000000cc",
            "-annotate",
            "+0+4",
            text,
            str(src),
        ],
        check=True,
    )


line_tiles = []
for i, (s, e, t) in enumerate(lines, 1):
    mid = (s + e) / 2
    p = OUTDIR / f"L{i:02d}.png"
    grab(mid, p)
    caption(p, f"L{i}  @{mid:0.1f}s   {t}", "#FFE000")
    line_tiles.append(str(p))

gap_tiles = []
for name, t in gaps:
    p = OUTDIR / f"gap_{name}_{int(t)}.png"
    grab(t, p)
    caption(p, f"{name} @{t:0.0f}s  (should be NO lyric)", "#66FFFF")
    gap_tiles.append(str(p))

subprocess.run(
    [
        "montage",
        *line_tiles,
        "-tile",
        "3x",
        "-geometry",
        "560x315+4+4",
        "-background",
        "black",
        str(OUTDIR / "sheet_lines.png"),
    ],
    check=True,
)
subprocess.run(
    [
        "montage",
        *gap_tiles,
        "-tile",
        "4x",
        "-geometry",
        "480x270+4+4",
        "-background",
        "black",
        str(OUTDIR / "sheet_gaps.png"),
    ],
    check=True,
)
print("wrote", OUTDIR / "sheet_lines.png", "and", OUTDIR / "sheet_gaps.png")
