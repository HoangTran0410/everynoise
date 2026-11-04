#!/usr/bin/env python3
"""Build data/near/<k>.json (k = genre index // SHARD): the most similar genres by SHARED ARTISTS.

Input : data/raw/genre_artists_all.json.gz (env EN_ARTISTS_ALL overrides) + data/genres.json
Output: {"<genre index>": [[neighbour index, score 1..100], ...]} (NEAR_N best first), ~5 KB per shard, lazy
        (js/data.js nearOf()); used by the "near" auto-next mode. Genres without an entry fall back to map distance.

Similarity = weighted Jaccard over artist sets: weight of an artist on a page = its font size (centrality) divided by
log2(2 + number of pages listing it) so the many-genre mega artists do not glue everything to "pop":
  sim(a,b) = sum_x min(w_ax, w_bx) / (W_a + W_b - sum_x min(w_ax, w_bx))
Pairs that share fewer than MIN_SHARED artists are ignored. Score = sim relative to the best neighbour of that genre.
"""
import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_data import ARTISTS_ALL, OUT, ROOT, SHARD, page_slug  # noqa: E402

DEST = ROOT / "data" / "near"
NEAR_N = 12
MIN_SHARED = 3
MAX_SPREAD = 400     # artists on more pages than this say nothing about similarity


def main():
    out = json.loads(OUT.read_text(encoding="utf-8"))["genres"]
    idx = {page_slug(o["n"]): i for i, o in enumerate(out)}
    with gzip.open(ARTISTS_ALL, "rt", encoding="utf-8") as f:
        pages = json.load(f)
    spread = defaultdict(int)
    for rows in pages.values():
        for r in rows:
            spread[r[3].lower()] += 1
    inv = defaultdict(list)       # artist -> [(genre index, weight)]
    tot = defaultdict(float)      # genre index -> total weight
    for slug, rows in pages.items():
        i = idx.get(slug)
        if i is None:
            continue
        seen = set()
        for r in rows:
            a = r[3].lower()
            if a in seen:
                continue
            seen.add(a)
            w = r[0] / math.log2(2 + spread[a])
            tot[i] += w
            if spread[a] <= MAX_SPREAD:
                inv[a].append((i, w))
    inter = defaultdict(lambda: defaultdict(float))
    shared = defaultdict(lambda: defaultdict(int))
    for lst in inv.values():
        if len(lst) < 2:
            continue
        for ia, wa in lst:
            ra, sa = inter[ia], shared[ia]
            for ib, wb in lst:
                if ib != ia:
                    ra[ib] += min(wa, wb)
                    sa[ib] += 1
    DEST.mkdir(exist_ok=True)
    for f in DEST.glob("*.json"):
        f.unlink()
    shards, n = {}, 0
    for ia, row in inter.items():
        cand = []
        for ib, m in row.items():
            if shared[ia][ib] >= MIN_SHARED:
                cand.append((m / (tot[ia] + tot[ib] - m), ib))
        cand.sort(key=lambda c: (-c[0], c[1]))
        cand = cand[:NEAR_N]
        if not cand:
            continue
        top = cand[0][0]
        shards.setdefault(ia // SHARD, {})[str(ia)] = [[ib, max(1, round(100 * s / top))] for s, ib in cand]
        n += 1
    for k, d in shards.items():
        (DEST / f"{k}.json").write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
    raw = sum(f.stat().st_size for f in DEST.glob("*.json"))
    gz = [len(gzip.compress(f.read_bytes())) for f in DEST.glob("*.json")]
    print("near: genres", n, "of", len(out), "shards", len(shards), "raw KB", raw // 1024, "gzip KB", sum(gz) // 1024,
          "max gzip KB", max(gz) // 1024)


if __name__ == "__main__":
    main()
