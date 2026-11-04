#!/usr/bin/env python3
"""Build data/radio/<genre index>.json: the endless-radio list of every genre (up to RADIO_N tracks).

Input : data/raw/genre_artists_all.json.gz (env EN_ARTISTS_ALL overrides; every artist Every Noise lists)
        + data/genres.json + data/tracks.json (+ data/raw/dead_previews.txt)
Output: one file per genre, [[preview id, track id, artist, song], ...], track #1 of tracks.json NOT included
        (js/data.js radioOf() puts it in front). Same ranking as data/more (make_ranker in build_data.py),
        distinct artists, kid genres drop KID_BAD songs/artists, dead previews dropped.
data/radio is git-ignored (~35 MB): regenerate with this script before scripts/deploy.sh.
"""
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_data import ARTISTS_ALL, DEAD, KID_BAD, OUT, ROOT, TRACKS, make_ranker, page_slug  # noqa: E402

DEST = ROOT / "data" / "radio"
RADIO_N = 59     # + track #1 = 60


def main():
    out = json.loads(OUT.read_text(encoding="utf-8"))["genres"]
    tracks = json.loads(TRACKS.read_text(encoding="utf-8"))
    with gzip.open(ARTISTS_ALL, "rt", encoding="utf-8") as f:
        pages = json.load(f)
    dead = set(DEAD.read_text().split()) if DEAD.exists() else set()
    rank = make_ranker(pages, out)
    DEST.mkdir(exist_ok=True)
    for f in DEST.glob("*.json"):
        f.unlink()
    counts, size = Counter(), 0
    for i, o in enumerate(out):
        first, cands = tracks[i], pages.get(page_slug(o["n"]))
        if not first or not cands:
            continue
        kid = bool(o["kid"])
        used, picks = {first[2].lower()}, []
        for _, pid, tid, artist, song in rank(o, cands):
            if pid in dead or pid == first[0] or artist.lower() in used:
                continue
            if kid and (KID_BAD.search(song) or KID_BAD.search(artist)):
                continue
            used.add(artist.lower())
            picks.append([pid, tid, artist, song])
            if len(picks) >= RADIO_N:
                break
        counts[len(picks) + 1] += 1
        if picks:
            b = json.dumps(picks, ensure_ascii=False, separators=(",", ":")).encode()
            (DEST / f"{i}.json").write_bytes(b)
            size += len(b)
    gz = sum(len(gzip.compress(f.read_bytes(), 6)) for f in DEST.glob("*.json"))
    print("radio: files", len(list(DEST.glob("*.json"))), "raw MB %.1f" % (size / 1e6), "gzip MB %.1f" % (gz / 1e6),
          "avg gzip KB %.1f" % (gz / 1024 / max(1, len(list(DEST.glob("*.json"))))),
          "tracks per genre (top):", sorted(counts.items())[-3:], "genres <60:", sum(v for k, v in counts.items() if k < 60))


if __name__ == "__main__":
    main()
