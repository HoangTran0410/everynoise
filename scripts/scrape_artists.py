#!/usr/bin/env python3
"""Scrape the artists Every Noise lists on each genre page -> data/raw/genre_artists.json.

Every genre has a page https://everynoise.com/engenremap-<slug>.html where <slug> is the genre name
lower-cased with everything except a-z and 0-9 removed ("k-pop" -> "kpop", "children's music" ->
"childrensmusic"; this matches the slugs in everynoise1d.html for every genre listed there).
Each artist on the page is a <div class="genre scanme" preview_url=... style="font-size: N%"
onclick="playx(&quot;<spotify TRACK id>&quot;, &quot;<artist>&quot;, this)" title='e.g. Artist "Song"'>;
the font size is how central the artist is to the genre.

Usage: python3 scripts/scrape_artists.py [cache_dir]
  Polite (<= 2.5 requests/s), resumable: raw pages are cached gzipped in cache_dir (default
  /tmp/everynoise-pages, NOT in the repo) and never fetched twice. 404s are remembered.
Output: data/raw/genre_artists.json   slug -> [[size%, preview id, spotify track id, artist, song], ...]
        data/raw/genre_artists_all.json.gz  same shape, every artist on the page (not only KEEP); git-ignored,
        a copy of the 2026-11-04 scrape is on GitHub release raw-artists-2026-11-04
  (top KEEP entries with a preview, one per artist, biggest first).
"""
import gzip
import html
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "everynoise-pwa-data-builder (github.com/HoangTran0410/everynoise)"
KEEP = int(os.environ.get("KEEP", 24))   # artists kept per genre: enough to find the ones *specific* to it
INTERVAL = 0.4
DIV = re.compile(r'<div id=item\d+([^>]*?class="genre scanme"[^>]*)>', re.S)


def slug(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def parse(page, keep=None):
    rows, seen = [], set()
    for m in DIV.finditer(page):
        a = m.group(1)
        pm = re.search(r'preview_url="https://p\.scdn\.co/mp3-preview/([0-9a-f]{40})"', a)
        fs = re.search(r"font-size:\s*(\d+)%", a)
        pl = re.search(r"playx\(&quot;([A-Za-z0-9]+)&quot;, &quot;(.*?)&quot;, this\)", a)
        ti = re.search(r'title="e\.g\. (.*)"\s*$', a)
        if not (pm and fs and pl and ti):
            continue
        artist = html.unescape(pl.group(2))
        t = html.unescape(ti.group(1))
        pre = artist + ' "'
        if not (t.startswith(pre) and t.endswith('"')) or artist.lower() in seen:
            continue
        seen.add(artist.lower())
        rows.append([int(fs.group(1)), pm.group(1), pl.group(1), artist, t[len(pre):-1]])
    rows.sort(key=lambda r: -r[0])
    return rows[: keep or KEEP]


def main():
    # default cache lives in the repo (git-ignored) so the ~135 MB of pages survive for later features
    cache = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "raw" / "pages")
    cache.mkdir(parents=True, exist_ok=True)
    genres = json.loads((ROOT / "data" / "genres.json").read_text(encoding="utf-8"))["genres"]
    slugs = sorted({slug(g["n"]) for g in genres if slug(g["n"])})
    lock, last = threading.Lock(), [0.0]

    def fetch(s):
        p = cache / (s + ".html.gz")
        if p.exists() or (cache / (s + ".404")).exists():
            return
        for attempt in range(4):
            with lock:
                wait = last[0] + INTERVAL - time.time()
                if wait > 0:
                    time.sleep(wait)
                last[0] = time.time()
            try:
                req = urllib.request.Request(f"https://everynoise.com/engenremap-{s}.html",
                                             headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    b = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        b = gzip.decompress(b)
                with gzip.open(str(p) + ".tmp", "wb") as f:
                    f.write(b)
                os.replace(str(p) + ".tmp", p)
                return
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    (cache / (s + ".404")).touch()
                    return
                time.sleep(5 * (attempt + 1))
            except Exception:
                time.sleep(5 * (attempt + 1))
        print("failed", s)

    with ThreadPoolExecutor(3) as ex:
        list(ex.map(fetch, slugs))
    out, full = {}, {}
    for s in slugs:
        p = cache / (s + ".html.gz")
        if p.exists():
            rows = parse(gzip.open(p, "rt", encoding="utf-8", errors="replace").read(), keep=10**9)
            if rows:
                out[s] = rows[:KEEP]
                full[s] = rows
    dest = ROOT / "data" / "raw" / "genre_artists.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("pages", len(out), "of", len(slugs), "->", dest, dest.stat().st_size // 1024, "KB")
    # every artist of every page (unused by the app today; kept so new features need no re-crawl)
    allp = ROOT / "data" / "raw" / "genre_artists_all.json.gz"
    with gzip.open(allp, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(full, f, ensure_ascii=False, separators=(",", ":"))
    print("all artists:", sum(map(len, full.values())), "rows ->", allp, allp.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
