#!/usr/bin/env bash
# Build the lyric-overlaid music video.
# - 21 source clips, numbered = song order.
# - Each clip trimmed to ~8.185s (clip 2 kept at its native 4.0s) so the total
#   equals the audio length (167.69s). Trim is taken from the FRONT or BACK of
#   each clip to preserve its key visual beat (see FRONT/BACK sets below).
# - Clips are concatenated, the synced Icelandic lyrics are burned in, and the
#   htdemucs no_vocals track is muxed as the audio.
set -euo pipefail
cd "$(dirname "$0")"

AUDIO="/home/rationallyprime/Downloads/separated/htdemucs/Aravísur/no_vocals.wav"
SRT="Abravisur.srt"
OUT="Afhverju-Abra_lyrics.mp4"
PREFIX="Afhverju-Abra_202606021704"
SEG=8.185          # kept length for the 10s clips
TRIM=1.815         # amount removed (10.0 - 8.185)

# Clips whose payoff is at the END -> trim the FRONT (-ss TRIM).
FRONT=" 1 3 4 6 9 10 16 17 18 19 21 "
# Clips with a zoom-out/reset at the END (or uniform) -> trim the BACK (-t SEG from 0).
# BACK = 5 7 8 11 12 13 14 15 20 ; KEEP_FULL = 2

inputs=()
filter=""
labels=""
for i in $(seq 1 21); do
  idx=$((i-1))
  f="${PREFIX}_${i}.mp4"
  if [[ "$i" -eq 2 ]]; then
    inputs+=( -ss 0 -t 4.0 -i "$f" )            # native length, keep whole
  elif [[ "$FRONT" == *" $i "* ]]; then
    inputs+=( -ss "$TRIM" -t "$SEG" -i "$f" )    # drop the front
  else
    inputs+=( -ss 0 -t "$SEG" -i "$f" )          # drop the back
  fi
  filter+="[${idx}:v]scale=1280:720,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v${idx}];"
  labels+="[v${idx}]"
done

style="FontName=DejaVu Sans,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=34"
filter+="${labels}concat=n=21:v=1:a=0[cat];[cat]subtitles=${SRT}:force_style='${style}'[v]"

ffmpeg -y "${inputs[@]}" -i "$AUDIO" \
  -filter_complex "$filter" \
  -map "[v]" -map 21:a \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 24 \
  -c:a aac -b:a 192k -movflags +faststart "$OUT"

echo "Wrote $OUT"
