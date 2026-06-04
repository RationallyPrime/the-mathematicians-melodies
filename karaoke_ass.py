#!/usr/bin/env python3
"""Animated karaoke ASS from real per-word timings.

Per line: a base line whose karaoke fill (\\kf) sweeps in exact sync with the
aligned word times, plus one pop/glow overlay event per word (positioned by
PIL-measured pixel centers) that scales up + blurs as the word is sung.
Verse-themed colors. Reads word_times_ctc.json (falls back to onset json)."""

import json
from pathlib import Path

from PIL import ImageFont

ROOT = Path("/home/rationallyprime/Videos/Afhverju-Abra")
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SRC = ROOT / "word_times_ctc.json"
if not SRC.exists():
    SRC = ROOT / "word_times_onset.json"
OUT = ROOT / "Abravisur_anim.ass"

PLAYW, PLAYH = 1280, 720
Y = 656
MAXW = 1180  # max line width before we shrink the font
BASE_FS = 34
WHITE = "&H00FFFFFF"


# verse themes: (sung-fill color, pop glow/outline color)  [ASS &HAABBGGRR]
def theme_for(line_index):
    if line_index <= 7:
        return ("&H0000D7FF", "&H0030B0FF")  # gold
    if line_index <= 16:
        return ("&H00FFE000", "&H00FFC000")  # cyan
    return ("&H00FF50FF", "&H00FF30E0")  # magenta


_fonts = {}


def font(fs):
    if fs not in _fonts:
        _fonts[fs] = ImageFont.truetype(FONT_PATH, fs)
    return _fonts[fs]


def w_of(s, fs):
    return font(fs).getlength(s)


def ass_time(t):
    t = max(0.0, t)
    cs = round(t * 100)
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, c = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


data = json.loads(SRC.read_text(encoding="utf-8"))

header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {PLAYW}
PlayResY: {PLAYH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: K,DejaVu Sans,{BASE_FS},&H0000D7FF,{WHITE},&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

DARK = "&H00101010"
events = []  # (layer, start, end, text)
for li, L in enumerate(data):
    words = L["words"]
    dw = [w["word"] for w in words]
    n = len(dw)
    sung, glow = theme_for(li)

    fs = BASE_FS
    space = w_of(" ", fs)
    widths = [w_of(x, fs) for x in dw]
    total = sum(widths) + (n - 1) * space
    if total > MAXW:
        fs = max(20, int(BASE_FS * MAXW / total))
        space = w_of(" ", fs)
        widths = [w_of(x, fs) for x in dw]
        total = sum(widths) + (n - 1) * space

    start_x = (PLAYW - total) / 2.0
    centers, x = [], start_x
    for i in range(n):
        centers.append(x + widths[i] / 2.0)
        x += widths[i] + space

    s0 = words[0]["start"]
    evs = s0 - 0.30
    eve = L["end"] + 0.40

    # one positioned event per word: visible the whole line, pops + recolors
    # to the verse theme exactly when it is sung (no base line => no doubling).
    for i in range(n):
        ws, we = words[i]["start"], words[i]["end"]
        cx = round(centers[i])
        t0 = max(0, round((ws - evs) * 1000))
        head = (
            f"\\an5\\pos({cx},{Y})\\fs{fs}\\b1\\bord3\\shad1"
            f"\\1c{WHITE}\\3c{DARK}\\fscx100\\fscy100\\blur0"
            f"\\t({t0},{t0 + 90},\\fscx128\\fscy128\\1c{sung}\\3c{glow}\\blur3)"
            f"\\t({t0 + 90},{t0 + 250},\\fscx100\\fscy100\\3c{DARK}\\blur0)"
        )
        events.append((0, evs, eve, f"{{{head}}}{dw[i]}"))

lines_out = [header]
for layer, s, e, txt in events:
    lines_out.append(f"Dialogue: {layer},{ass_time(s)},{ass_time(e)},K,,0,0,0,,{txt}")

OUT.write_text("\n".join(lines_out) + "\n", encoding="utf-8")
print(f"wrote {OUT.name} from {SRC.name}: {len(data)} lines, {len(events)} word-events")
