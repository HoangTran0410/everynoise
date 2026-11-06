#!/usr/bin/env python3
"""Artist layer of the map: a position for each "core" artist (data/artists.json), most popular first.

Input : data/artists.json (core names + genre indices, most central first), data/genres.json,
        data/raw/genre_artists_all.json.gz (popularity score, same formula as build_artists.py).
Output: data/amap.json { "o": "k,k,...",  base36 positions in artists.json's name list, most popular first
                         "p": "eeebbb..." 3+3 base36 chars per artist (same order): map axes e, b in 0..46655 }
Placement (normalised map axes, e = organic→electric, b = dense→bouncy, as in js/data.js):
  - near the artist's most central genre, pulled 30% toward the weighted mean of their other genres, so an artist who
    spans two scenes leans toward the second without landing in the empty space between them;
  - artists sharing a main genre are fanned out on a sunflower spiral around it (most popular closest), so a genre's
    artists form a small cloud instead of one stacked point.
"""
import gzip
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_data import ARTISTS_ALL, page_slug  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
PULL = 0.30          # how far toward the other genres
SPREAD = 0.0011      # spiral step (normalised units); radius = SPREAD * sqrt(rank + 1.5)
GOLDEN = math.pi * (3 - math.sqrt(5))
Q = 36 ** 3 - 1


def b36(n: int, w: int = 0) -> str:
    s = ""
    while True:
        n, r = divmod(n, 36)
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
        if not n:
            break
    return s.rjust(w, "0")


def main():
    core = json.loads((DATA / "artists.json").read_text(encoding="utf-8"))
    names = core["a"].split("|")
    gl = [[int(x, 36) for x in s.split(",")] if s else [] for s in core["g"].split("|")]
    genres = json.loads((DATA / "genres.json").read_text(encoding="utf-8"))["genres"]
    ymin, ymax = min(g["y"] for g in genres), max(g["y"] for g in genres)
    E = [(g["y"] - ymin) / (ymax - ymin) for g in genres]
    B = [g["x"] / 1500 for g in genres]

    by_slug = defaultdict(list)
    for i, g in enumerate(genres):
        by_slug[page_slug(g["n"])].append(i)
    want = {n.casefold() for n in names}
    score = Counter()
    with gzip.open(Path(sys.argv[1]) if len(sys.argv) > 1 else ARTISTS_ALL, "rt", encoding="utf-8") as f:
        pages = json.load(f)
    for slug, rows in pages.items():
        if not by_slug.get(slug):
            continue
        w = 1 + math.log10(len(rows))
        for r in rows:
            k = r[3].strip().replace("|", "/").casefold()
            if k in want:
                score[k] += (r[0] - 99) * w

    order = sorted((k for k in range(len(names)) if gl[k]), key=lambda k: (-score[names[k].casefold()], names[k]))
    rank_in = Counter()
    o, p = [], []
    for k in order:
        gs = gl[k][:6]
        g0 = gs[0]
        ws = [1 / (j + 1) for j in range(len(gs))]
        me = sum(w * E[g] for w, g in zip(ws, gs)) / sum(ws)
        mb = sum(w * B[g] for w, g in zip(ws, gs)) / sum(ws)
        e = E[g0] + PULL * (me - E[g0])
        b = B[g0] + PULL * (mb - B[g0])
        r = rank_in[g0]
        rank_in[g0] += 1
        a = r * GOLDEN + (g0 * 0.6180339) % 1 * 2 * math.pi
        rad = SPREAD * math.sqrt(r + 1.5)
        e += rad * math.cos(a)
        b += rad * math.sin(a)
        o.append(b36(k))
        p.append(b36(round(min(1, max(0, e)) * Q), 3) + b36(round(min(1, max(0, b)) * Q), 3))
    out = DATA / "amap.json"
    out.write_text(json.dumps({"o": ",".join(o), "p": "".join(p)}, separators=(",", ":")), encoding="utf-8")
    big = Counter({g: n for g, n in rank_in.items()}).most_common(3)
    print("artists", len(o), "size", out.stat().st_size // 1024, "KB", "biggest clouds",
          [(genres[g]["n"], n) for g, n in big])


if __name__ == "__main__":
    main()
