#!/usr/bin/env python3
"""Build the artist data from the FULL genre pages (every artist Every Noise lists, ~425k).

Input : data/raw/genre_artists_all.json.gz (page slug -> [[size, preview id, track id, artist, song], ...]), override with
        env ARTISTS_ALL or argv[1]; + data/genres.json, data/tracks.json (same slug -> genre mapping as data/more).
Output (all deterministic):
  data/artists.json   "core": the ~CORE_N most popular artists. Loaded on first focus of the search box (<= ~400 KB gzip).
        { "a": "Name|Name|...",       display names, '|' separated, sorted by case-folded name
          "g": "i,i,i|i|...",          per artist: genre indices (base36), MOST CENTRAL FIRST (font size desc, then smaller page)
          "b": "k,k,..." }             base36 positions of names matching KID_BAD (hidden in kids mode)
  data/ar/index.json  manifest { "n": "leaf,leaf,...", "p": "leaf,..." } = the leaf keys of the two shard sets below
  data/ar/<leaf>.json the other artists, same {a,g,b} format, sharded by the prefix of each *word* of the name (first 3
        words; stop words and 1-2 letter later words are skipped), so "tung" finds "Sơn Tùng M-TP"'s shard
  data/ap/<leaf>.json "profiles", sharded by the prefix of the whole name: { "Name": [[preview(base64url), track id, song,
        "genre,genre"], ...] }: one entry per distinct track, listing the genres it is the artist's track in (artist page)
  data/bridge.json    playable pairs for the artist-bridge game: [[genre a, genre b, steps], ...] (kid-safe subgraph, core only)
Key rules (mirrored in js/artists.js `fold`/`keyBase`/`leafFor`): names are folded like util.norm + ø æ œ ß ł ð þ ı; a key is the
leading a-z0-9 run of a word (or of the whole name with punctuation removed); anything that does not start with a-z0-9 goes to
the bucket "_<code point % 97>". Big keys are split by the next letter until a leaf holds <= N entries (trie, longest-prefix lookup).
The big dirs (data/ar, data/ap) are git-ignored: rebuild them with this script before deploy.
"""
import base64
import gzip
import json
import math
import os
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_data import ARTISTS_ALL, KID_BAD, OUT, TRACKS, page_slug  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
CORE_N = int(os.environ.get("CORE_N", 33000))   # core artists (first search); tuned for <= ~390 KB gzip
NAME_LEAF = 7000      # max entries of a name shard
NAME_MIN = 80         # a child group smaller than this stays in its parent leaf
PROF_LEAF = 1200      # max artists of a profile shard
PROF_MIN = 40
MAX_DEPTH_N, MAX_DEPTH_P = 5, 8
STOP = {"the", "and", "of", "de", "la", "le", "les", "los", "las", "el", "da", "di", "von", "van", "der", "den", "die", "das",
        "feat", "ft", "with", "for", "dj", "mc"}
PUZZLES = 360
EXTRA = {"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "ð": "d", "þ": "th", "ı": "i"}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = re.sub("[̀-ͯ]", "", s).replace("đ", "d")
    return "".join(EXTRA.get(c, c) for c in s)


def b36(n: int) -> str:
    s = ""
    while True:
        n, r = divmod(n, 36)
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
        if not n:
            return s


def key_base(s: str) -> str:
    """Key of an already folded token / name: leading a-z0-9 run (>= 2 chars) or the bucket _<cp % 97>."""
    m = re.match(r"[a-z0-9]+", s)
    if not m or len(m.group(0)) < 2:
        return "_" + str(ord(s[0]) % 97)
    return m.group(0)


def tokens(f: str):
    return [t for t in re.split(r"[^a-z0-9\u0080-\U0010ffff]+", f) if t]


def word_keys(name: str):
    f = fold(name)
    toks = tokens(f)
    if not toks:
        return set()
    cand = [t for t in toks if t not in STOP] or toks[:1]
    return {key_base(t) for j, t in enumerate(cand[:3]) if not j or len(t) >= 3}


def name_key(name: str) -> str:
    f = re.sub(r"[^a-z0-9\u0080-\U0010ffff]", "", fold(name))
    return key_base(f) if f else "_0"


def make_leaves(entries, cap, minn, maxd):
    """entries: [(key string, id)] -> {leaf prefix: [ids]} (trie split by next letter)."""
    leaves = {}

    def rec(prefix, group, depth):
        if len(group) <= cap or depth >= maxd:
            leaves[prefix] = [i for _, i in group]
            return
        rem, kids = [], defaultdict(list)
        for s, i in group:
            if len(s) > depth:
                kids[s[depth]].append((s, i))
            else:
                rem.append((s, i))
        for c in sorted(kids):
            if len(kids[c]) >= minn:
                rec(prefix + c, kids[c], depth + 1)
            else:
                rem.extend(kids[c])
        if rem:
            leaves[prefix] = [i for _, i in rem]

    top = defaultdict(list)
    for s, i in entries:
        if s.startswith("_"):
            top[s].append((s, i))
        else:
            top[s[:2]].append((s, i))
    for p in sorted(top):
        if p.startswith("_"):
            leaves[p] = [i for _, i in top[p]]
        else:
            rec(p, top[p], 2)
    return leaves


def b64_preview(p: str) -> str:
    if re.fullmatch(r"[0-9a-f]{40}", p):
        return base64.urlsafe_b64encode(bytes.fromhex(p)).decode().rstrip("=")
    return "=" + p


def dump(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def gz_size(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), 6))


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ARTISTS_ALL", ARTISTS_ALL))
    genres = json.loads(OUT.read_text(encoding="utf-8"))["genres"]
    tracks = json.loads(TRACKS.read_text(encoding="utf-8"))
    by_slug = defaultdict(list)
    for i, g in enumerate(genres):
        by_slug[page_slug(g["n"])].append(i)
    with gzip.open(src, "rt", encoding="utf-8") as f:
        pages = json.load(f)

    spell = defaultdict(Counter)       # case-folded name -> spelling counts
    gsize = defaultdict(dict)          # case-folded name -> {genre idx: (size, page len)}
    trk = defaultdict(dict)            # case-folded name -> {preview: [track id, song, set(genre idx)]}
    score = Counter()
    for slug, rows in pages.items():
        gis = by_slug.get(slug, [])
        if not gis:
            continue
        w = 1 + math.log10(len(rows))
        for r in rows:
            name = r[3].strip().replace("|", "/")
            if not name:
                continue
            k = name.casefold()
            spell[k][name] += 1
            score[k] += (r[0] - 99) * w
            for gi in gis:
                old = gsize[k].get(gi)
                if old is None or r[0] > old[0]:
                    gsize[k][gi] = (r[0], len(rows))
                t = trk[k].setdefault(r[1], [r[2], r[4], set()])
                t[2].add(gi)
    # junk names from the source pages: "None", and bare numbers seen in a single genre (track-number artefacts)
    junk = {k for k in gsize if k in ("none", "null", "unknown") or (re.fullmatch(r"[0-9 .,'-]+", k) and len(gsize[k]) < 2)}
    keys = sorted(k for k in gsize if k not in junk)
    print("junk names dropped", len(junk))
    disp = {k: sorted(spell[k].items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for k in keys}
    order = {k: [gi for gi, _ in sorted(gsize[k].items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))] for k in keys}
    print("artists", len(keys))

    # ── core: the most popular CORE_N ──
    ranked = sorted(keys, key=lambda k: (-score[k], k))
    core = set(ranked[:CORE_N])

    def block(ks):
        ks = sorted(ks, key=lambda k: (k, disp[k]))
        names = [disp[k] for k in ks]
        return {"a": "|".join(names), "g": "|".join(",".join(b36(g) for g in order[k]) for k in ks),
                "b": ",".join(b36(p) for p, n in enumerate(names) if KID_BAD.search(n))}

    dump(DATA / "artists.json", block(core))
    print("core", len(core), (DATA / "artists.json").stat().st_size // 1024, "KB,", gz_size(DATA / "artists.json") // 1024, "KB gzip")

    # ── tail name shards (by word prefix) ──
    for d in ("ar", "ap"):
        shutil.rmtree(DATA / d, ignore_errors=True)
        (DATA / d).mkdir()
    tail = [k for k in keys if k not in core]
    ents = [(wk, ix) for ix, k in enumerate(tail) for wk in word_keys(disp[k])]
    nleaves = make_leaves(ents, NAME_LEAF, NAME_MIN, MAX_DEPTH_N)
    tot = 0
    for leaf, ids in nleaves.items():
        p = DATA / "ar" / f"{leaf}.json"
        dump(p, block([tail[i] for i in sorted(set(ids))]))
        tot += p.stat().st_size
    nmax = max(((DATA / "ar" / f"{l}.json").stat().st_size, l) for l in nleaves)
    print("name shards", len(nleaves), tot // 1024, "KB; biggest", nmax)

    # ── profiles (by whole-name prefix), every artist ──
    ents = [(name_key(disp[k]), ix) for ix, k in enumerate(keys)]
    pleaves = make_leaves(ents, PROF_LEAF, PROF_MIN, MAX_DEPTH_P)
    tot = 0
    for leaf, ids in pleaves.items():
        obj = {}
        for ix in sorted(set(ids), key=lambda j: keys[j]):
            k = keys[ix]
            tl = sorted(trk[k].items(), key=lambda kv: min(order[k].index(g) for g in kv[1][2]))
            obj[disp[k]] = [[b64_preview(pv), tid, song, ",".join(b36(g) for g in sorted(gs, key=order[k].index))] for pv, (tid, song, gs) in tl]
        p = DATA / "ap" / f"{leaf}.json"
        dump(p, obj)
        tot += p.stat().st_size
    pmax = max(((DATA / "ap" / f"{l}.json").stat().st_size, l) for l in pleaves)
    print("profile shards", len(pleaves), tot // 1024, "KB; biggest", pmax)
    dump(DATA / "ar" / "index.json", {"n": ",".join(sorted(nleaves)), "p": ",".join(sorted(pleaves))})

    # ── bridge game pairs: kid-safe subgraph (isOk genre = kid flag + has a track), core artists in >= 2 such genres ──
    usable = [bool(g.get("kid")) and bool(tracks[i]) for i, g in enumerate(genres)]
    g2a, a2g = defaultdict(list), {}
    for k in sorted(core):
        if KID_BAD.search(disp[k]):
            continue
        gs = [g for g in order[k] if usable[g]]
        if len(gs) < 2:
            continue
        a2g[k] = gs
        for g in gs:
            g2a[g].append(k)
    degree = {g: len(a) for g, a in g2a.items()}
    starts = sorted((g for g in g2a if degree[g] >= 4 and genres[g]["k"] >= 1), key=lambda g: (-degree[g], g))[:1200]
    import random
    rng = random.Random(7)
    pairs, seen_pair = [], set()
    want = {2: PUZZLES // 3, 3: PUZZLES // 3, 4: PUZZLES - 2 * (PUZZLES // 3)}
    got = Counter()
    pool = starts[:]
    rng.shuffle(pool)
    for s in pool:
        if all(got[d] >= want[d] for d in want):
            break
        dist, q = {s: 0}, deque([s])
        while q:
            u = q.popleft()
            if dist[u] >= 4:
                continue
            for a in g2a[u]:
                for v in a2g[a]:
                    if v not in dist:
                        dist[v] = dist[u] + 1
                        q.append(v)
        for d in (2, 3, 4):
            if got[d] >= want[d]:
                continue
            cand = sorted(g for g, dd in dist.items() if dd == d and degree.get(g, 0) >= 3 and g != s)
            if cand:
                t = cand[rng.randrange(len(cand))]
                if (s, t) not in seen_pair and (t, s) not in seen_pair:
                    seen_pair.add((s, t)); pairs.append([s, t, d]); got[d] += 1
    pairs.sort(key=lambda p: (p[2], p[0], p[1]))
    dump(DATA / "bridge.json", pairs)
    print("bridge pairs", dict(got), "genres in graph", len(g2a), "artists", len(a2g))


if __name__ == "__main__":
    main()
