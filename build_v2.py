#!/usr/bin/env python3
"""Build v2: content-aligned clip order + karaoke (word-fill) lyrics.

- Each themed clip is placed so it is on screen during its matching lyric line
  (mapping below), not in filename order.
- Instrumental gaps (intro / break / big break / outro) are filled with the
  abstract clips (spiral, montage, molecules, cat-??, sun-gear...).
- Lyrics are burned in karaoke style via ASS \\kf word-fill, timing distributed
  across each line by word length.
"""
import subprocess
from pathlib import Path

ROOT = Path("/home/rationallyprime/Videos/Afhverju-Abra")
PREFIX = "Afhverju-Abra_202606021704"
AUDIO = "/home/rationallyprime/Downloads/separated/htdemucs/Aravísur/no_vocals.wav"
LABELS = ROOT / "Abravisur_labels.txt"
ASS = ROOT / "Abravisur.ass"
OUT = ROOT / "Afhverju-Abra_karaoke.mp4"

# ---- EDIT: (clip number, source start, segment length) in timeline order ----
# Lengths sum to 167.69 (= audio).  Each (ss+len) <= source length (10s, clip2=4s).
EDIT = [
    (6,  0.00, 6.00),   # intro  - puzzled Abra (?? -> grumpy)
    (1,  0.00, 10.00),  # L1     - Abra gulur / dulur  (?? payoff lands on "mysterious")
    (2,  0.00, 4.00),   # L2     - spiral galaxy (snýst)
    (8,  0.00, 10.00),  # L3-4   - studying, no one fast enough to answer
    (3,  5.20, 4.80),   # L5     - blue flame in jar (what causes heat)
    (10, 5.00, 3.80),   # L6     - molecules (sameindir)
    (5,  0.00, 10.00),  # L7-8   - ARCHIMEDES DEATH RAY: mirror -> beam -> burning ships
    (16, 2.60, 7.40),   # break1 - golden sun-gear
    (20, 0.00, 6.04),   # break1 - molecular field
    (13, 0.00, 9.44),   # L9-10  - the gathering (everyone Abra meets)
    (11, 0.00, 8.92),   # L11-12 - atom / hydrogen (vetni)
    (9,  2.00, 7.92),   # L13-14 - Spinoza portrait (front-trim so the portrait lands on "Spinoza")
    (12, 0.00, 7.16),   # L15-16 - cosmic (quantum field theory / relativity)
    (7,  1.98, 8.02),   # L17    - BATH -> EUREKA glow (fara i bad)
    (14, 0.00, 10.00),  # break2 - 4-scene montage
    (17, 2.00, 8.00),   # break2 - lightbulb / brain idea
    (15, 0.00, 8.98),   # break2 - cat ??
    (21, 4.98, 5.02),   # L18    - KADABRA finale
    (18, 2.50, 7.50),   # L19-20 - chalkboard, finished answer
    (19, 2.00, 8.00),   # L20-21 - flying-books frenzy (let's go / find out now)
    (1,  0.00, 8.50),   # outro  - Abra reprise / bookend
    (4,  1.50, 8.19),   # outro  - quiet arched room -> sleeping cat (goodnight)
]


def ass_time(t: float) -> str:
    cs = round(t * 100)
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, c = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def karaoke_text(text: str, dur_cs: int) -> str:
    words = text.split()
    weights = [max(1, len(w)) for w in words]
    tot = sum(weights)
    durs = [round(dur_cs * w / tot) for w in weights]
    # fix rounding so the syllable timings sum exactly to the line duration
    durs[-1] += dur_cs - sum(durs)
    if durs[-1] < 1:
        durs[-1] = 1
    return "".join(f"{{\\kf{d}}}{w} " for d, w in zip(durs, words)).rstrip()


def write_ass() -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,DejaVu Sans,38,&H0000E5FF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,46,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text
"""
    lines = [header]
    for raw in LABELS.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        s, e, text = raw.split("\t")
        s, e = float(s), float(e)
        dur_cs = max(1, round((e - s) * 100))
        kt = karaoke_text(text, dur_cs)
        lines.append(f"Dialogue: 0,{ass_time(s)},{ass_time(e)},Karaoke,,0,0,0,,{kt}")
    ASS.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_cmd() -> list[str]:
    cmd = ["ffmpeg", "-y"]
    for clip, ss, length in EDIT:
        cmd += ["-ss", f"{ss}", "-t", f"{length}", "-i", f"{ROOT}/{PREFIX}_{clip}.mp4"]
    cmd += ["-i", AUDIO]
    n = len(EDIT)
    fc = ""
    labels = ""
    for i in range(n):
        fc += (f"[{i}:v]scale=1280:720,setsar=1,fps=24,format=yuv420p,"
               f"setpts=PTS-STARTPTS[v{i}];")
        labels += f"[v{i}]"
    fc += f"{labels}concat=n={n}:v=1:a=0[cat];[cat]ass={ASS.name}[v]"
    cmd += [
        "-filter_complex", fc,
        "-map", "[v]", "-map", f"{n}:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", "24",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        str(OUT),
    ]
    return cmd


if __name__ == "__main__":
    write_ass()
    print(f"wrote {ASS.name}")
    cmd = build_cmd()
    proc = subprocess.run(cmd, cwd=ROOT, stderr=subprocess.STDOUT,
                          stdout=subprocess.PIPE, text=True)
    print(proc.stdout[-1500:])
    print("returncode", proc.returncode)
