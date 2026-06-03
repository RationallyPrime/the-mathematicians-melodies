#!/usr/bin/env python3
"""Download media assets from the companion Hugging Face dataset into the local
layout the build scripts expect.

The dataset (RationallyPrime/Whimsy-Daisy) is PRIVATE, so authenticate first:
    hf auth login            # or set HF_TOKEN
Then:
    python fetch_assets.py

Places:
  clips/*.mp4  -> repo root      (build_*.py read clips from here)
  audio/*.wav  -> ~/Downloads/separated/htdemucs/Aravísur/  (hardcoded in scripts)
  everything   -> ./assets/      (full snapshot, incl. renders/)
"""
import os
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download

REPO = "RationallyPrime/Whimsy-Daisy"
ROOT = Path(__file__).resolve().parent
AUDIO_DEST = Path(os.path.expanduser("~/Downloads/separated/htdemucs/Aravísur"))


def main() -> None:
    snap = Path(snapshot_download(REPO, repo_type="dataset",
                                  local_dir=str(ROOT / "assets")))
    for p in (snap / "clips").glob("*.mp4"):
        shutil.copy2(p, ROOT / p.name)
    AUDIO_DEST.mkdir(parents=True, exist_ok=True)
    for p in (snap / "audio").glob("*.wav"):
        shutil.copy2(p, AUDIO_DEST / p.name)
    print(f"clips -> {ROOT}")
    print(f"audio -> {AUDIO_DEST}")
    print(f"full snapshot (incl. renders/) -> {snap}")


if __name__ == "__main__":
    main()
