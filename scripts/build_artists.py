#!/usr/bin/env python3
"""Build data/artists.json: artist -> the genres (indices into data/genres.json) they appear in.

Input : data/raw/genre_artists.json (page slug -> [[size, preview id, track id, artist, song], ...]) + data/genres.json
Output: data/artists.json, deterministic (sorted by case-folded name, then name).

Format (one small file, lazily fetched by js/artists.js on first focus of the search box):
  { "a": "Name|Name|...",            artist display names, '|' separated
    "g": "i,d,d|i,d|...",            per artist: genre indices ascending, base36, delta-coded after the first
    "b": "k,k,..." }                 base36 positions of artists whose name matches KID_BAD (never shown in kids mode)
Same slug -> genre mapping as data/more (page_slug in build_data.py).
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_data import ARTISTS, KID_BAD, OUT, page_slug  # noqa: E402

MIN_SIZE = 110     # an artist seen in only one genre page must be at least this central there (100..160) to be kept: keeps the file < 600 KB
DEST = Path(__file__).resolve().parent.parent / "data" / "artists.json"


def b36(n: int) -> str:
    s = ""
    while True:
        n, r = divmod(n, 36)
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
        if not n:
            return s


def main():
    genres = json.loads(OUT.read_text(encoding="utf-8"))["genres"]
    by_slug = defaultdict(list)
    for i, g in enumerate(genres):
        by_slug[page_slug(g["n"])].append(i)
    pages = json.loads(ARTISTS.read_text(encoding="utf-8"))

    spell = defaultdict(Counter)       # case-folded name -> spelling counts
    where = defaultdict(set)           # case-folded name -> genre indices
    best = Counter()                   # case-folded name -> biggest font size seen
    seen = Counter()                   # case-folded name -> number of genre pages
    for slug, rows in pages.items():
        for row in rows:
            name = row[3].strip().replace("|", "/")
            if not name:
                continue
            k = name.casefold()
            spell[k][name] += 1
            where[k].update(by_slug.get(slug, []))
            best[k] = max(best[k], row[0])
            seen[k] += 1
    keys = sorted(k for k in where if where[k] and (seen[k] > 1 or best[k] >= MIN_SIZE))
    names, refs, bad = [], [], []
    for pos, k in enumerate(keys):
        # most common spelling; ties -> lexicographic so the output stays deterministic
        name = sorted(spell[k].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        idx = sorted(where[k])
        names.append(name)
        refs.append(",".join([b36(idx[0])] + [b36(b - a) for a, b in zip(idx, idx[1:])]))
        if KID_BAD.search(name):
            bad.append(b36(pos))
    out = {"a": "|".join(names), "g": "|".join(refs), "b": ",".join(bad)}
    DEST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    multi = sum(1 for r in refs if "," in r)
    print(f"artists: {len(names)} ({multi} in 2+ genres, {len(bad)} kid-bad), {DEST.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
