#!/usr/bin/env python3
"""Generate static SEO pages into dist/ at deploy time (nothing generated is committed).

  dist/g/<slug>/index.html         one page per genre (data/genres.json)
  dist/g/family/<slug>/index.html  one page per family
  dist/g/index.html                A-Z index + family links
  dist/g/page.css                  shared stylesheet (scripts/page.css)
  dist/sitemap.xml                 / + all pages (overwrites the static one in dist only)

Usage: python3 scripts/build_pages.py [dist_dir]   (stdlib only)
"""
import hashlib
import html
import json
import re
import shutil
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://everynoise.pages.dev"
SHARD = 80  # keep in sync with js/data.js / build_data.py
OTHER = "Other"
VI_FAMILY = {  # vi labels, mirrors FAMILY_INFO in js/data.js (only used for the Vietnamese line)
    "Pop": "Pop", "Rock": "Rock", "Metal": "Metal", "Hip hop & Rap": "Hip hop & Rap",
    "Electronic": "Điện tử", "Jazz": "Jazz", "Classical": "Cổ điển",
    "Folk & Traditional": "Dân gian & Truyền thống", "Country": "Country",
    "R&B, Soul & Funk": "R&B, Soul & Funk", "Blues": "Blues", "Latin": "Latin",
    "Reggae & Caribbean": "Reggae & Caribbean", "African": "Châu Phi", "Religious": "Tôn giáo",
    "Soundtrack & Media": "Nhạc phim & Truyền thông", "Experimental": "Thử nghiệm",
    "Indie & Alternative": "Indie & Alternative", "Wellness & Spoken": "Thư giãn & Lời nói",
}

esc = html.escape


def slugify(name):
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def make_slugs(names):
    """Stable unique slugs: plain slug for the alphabetically first name of a collision group,
    '<slug>-<4 hex of sha1(name)>' for the rest; names with no ASCII letters get 'x-<8 hex>'."""
    base = {}
    for n in names:
        s = slugify(n)
        base[n] = s or "x-" + hashlib.sha1(n.encode()).hexdigest()[:8]
    groups = defaultdict(list)
    for n, s in base.items():
        groups[s].append(n)
    out, used = {}, set()
    for s, ns in groups.items():
        for k, n in enumerate(sorted(ns)):
            out[n] = s if k == 0 else f"{s}-{hashlib.sha1(n.encode()).hexdigest()[:4]}"
    for n, s in out.items():  # last-resort guarantee (also avoids the reserved 'family' folder)
        while s in used or s == "family":
            s += "-" + hashlib.sha1((n + s).encode()).hexdigest()[:4]
        out[n] = s
        used.add(s)
    return out


def nearest_all(G, k=10):
    """k nearest genres (by x,y, the original Every Noise space) for every genre, via a grid."""
    cell = 40
    grid = defaultdict(list)
    for i, g in enumerate(G):
        grid[(g["x"] // cell, g["y"] // cell)].append(i)
    res = []
    for i, g in enumerate(G):
        cx, cy = g["x"] // cell, g["y"] // cell
        best = []  # sorted [(d2, j)]
        r = 0
        while True:
            for gx in range(cx - r, cx + r + 1):
                for gy in range(cy - r, cy + r + 1):
                    if max(abs(gx - cx), abs(gy - cy)) != r:
                        continue
                    for j in grid.get((gx, gy), ()):
                        if j == i:
                            continue
                        d2 = (G[j]["x"] - g["x"]) ** 2 + (G[j]["y"] - g["y"]) ** 2
                        if len(best) < k or d2 < best[-1][0]:
                            best.append((d2, j))
                            best.sort()
                            del best[k:]
            # everything unseen is at least r*cell away
            if len(best) >= k and best[-1][0] <= (r * cell) ** 2:
                break
            r += 1
            if r > 600:
                break
        res.append([j for _, j in best])
    return res


def describe(g, ymin, ymax):
    e = (g["y"] - ymin) / (ymax - ymin)
    b = g["x"] / 1500
    if e < 0.33: ea, ev = "organic, acoustic", "mộc, acoustic"
    elif e > 0.66: ea, ev = "electric, electronic", "điện tử"
    else: ea, ev = "a mix of organic and electric", "pha giữa mộc và điện tử"
    if b < 0.33: ba, bv = "dense and atmospheric", "đặc, mơ màng"
    elif b > 0.66: ba, bv = "spiky and bouncy", "nảy, sắc"
    else: ba, bv = "balanced between dense and spiky", "cân bằng giữa đặc và sắc"
    return ea, ba, ev, bv


def jsonld(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


HEAD = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#0b0d12">
<meta property="og:type" content="website"><meta property="og:site_name" content="Everynoise">
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{site}/icons/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icons/icon-192.png">
<link rel="stylesheet" href="/g/page.css">
<script type="application/ld+json">{ld}</script>
</head><body><header><a href="/">Everynoise</a> <a href="/g/">All genres</a></header><main>
"""
FOOT = """</main><footer>Everynoise is a free interactive map of 5,986 music genres. <a href="/">Open the map</a> | <a href="/g/">Genre index</a></footer></body></html>
"""


def link(slug, name):
    return f'<a href="/g/{slug}/">{esc(name)}</a>'


def main():
    dist = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist"
    t0 = time.time()
    data = json.loads((ROOT / "data/genres.json").read_text())
    G = data["genres"]
    first = json.loads((ROOT / "data/tracks.json").read_text())
    shards = {}

    def tracks_of(i):
        k = i // SHARD
        if k not in shards:
            p = ROOT / f"data/more/{k}.json"
            shards[k] = json.loads(p.read_text()) if p.exists() else {}
        out = ([first[i]] if first[i] else []) + shards[k].get(str(i), [])
        return out[:6]

    slugs = make_slugs([g["n"] for g in G])
    S = [slugs[g["n"]] for g in G]
    byname = {g["n"]: i for i, g in enumerate(G)}
    ymin = min(g["y"] for g in G); ymax = max(g["y"] for g in G)
    near = nearest_all(G)
    children = defaultdict(list)  # parent name -> sub-genre indices (genres naming it in p)
    for i, g in enumerate(G):
        for p in g["p"]:
            children[p].append(i)
    fam_slug = {f: slugify(f) for f in data["meta"]["families"]}
    fam_slug[OTHER] = "other"
    members = defaultdict(list)  # family -> genre indices (first family only for grouping)
    for i, g in enumerate(G):
        members[g["f"][0] if g["f"] else OTHER].append(i)

    gdir = dist / "g"
    if gdir.exists():
        shutil.rmtree(gdir)
    gdir.mkdir(parents=True)
    shutil.copy(ROOT / "scripts/page.css", gdir / "page.css")

    def write(rel, text):
        p = dist / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    urls = [f"{SITE}/", f"{SITE}/g/"] + [f"{SITE}/g/family/{fam_slug[f]}/" for f in members]
    maxsize = 0
    for i, g in enumerate(G):
        name, slug = g["n"], S[i]
        url = f"{SITE}/g/{slug}/"
        urls.append(url)
        fams = g["f"] or [OTHER]
        ea, ba, ev, bv = describe(g, ymin, ymax)
        tr = tracks_of(i)
        where = f" from {g['co']}" if g["co"] else ""
        wherev = f" của {g['co']}" if g["co"] else ""
        fam_txt = ", ".join(fams)
        desc = (f"{name} is a {fam_txt} music genre{where}, sounding {ea} and {ba}. "
                f"Hear {len(tr)} example track{'s' if len(tr) != 1 else ''} and explore {len(near[i])} similar genres on the map.")
        title = f"{name} music — examples, similar genres | Everynoise"
        rel = [byname[p] for p in g["p"] if p in byname and p != name]
        sub = children.get(name, [])[:10]
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "WebPage", "@id": url, "url": url, "name": title, "description": desc,
             "inLanguage": "en", "isPartOf": {"@type": "WebSite", "name": "Everynoise", "url": SITE + "/"},
             "about": {"@type": "Thing", "name": name, "description": f"{name} is a {fam_txt} music genre{where}."},
             "breadcrumb": {"@type": "BreadcrumbList", "itemListElement": [
                 {"@type": "ListItem", "position": 1, "name": "Everynoise", "item": SITE + "/"},
                 {"@type": "ListItem", "position": 2, "name": "Genres", "item": SITE + "/g/"},
                 {"@type": "ListItem", "position": 3, "name": name, "item": url}]}},
        ]}
        if tr:
            ld["@graph"].append({"@type": "ItemList", "name": f"{name} example tracks", "itemListElement": [
                {"@type": "ListItem", "position": n + 1, "item": {
                    "@type": "MusicRecording", "name": t[3], "byArtist": {"@type": "MusicGroup", "name": t[2]},
                    "url": f"https://open.spotify.com/track/{t[1]}"}} for n, t in enumerate(tr)]})
        out = [HEAD.format(title=esc(title), desc=esc(desc), url=url, site=SITE, ld=jsonld(ld))]
        out.append(f"<h1>{esc(name)}</h1>\n")
        facts = " | ".join(
            [", ".join(f'<a href="/g/family/{fam_slug[f]}/">{esc(f)}</a>' for f in fams)]
            + ([esc(g["co"])] if g["co"] else []))
        out.append(f'<p class="facts">{facts}</p>\n')
        out.append(f'<p>{esc(name)} is a {esc(fam_txt)} music genre{esc(where)}. On the Everynoise map it sounds {ea} '
                   f'and {ba}, based on the audio features of its tracks.</p>\n')
        fv = ", ".join(VI_FAMILY.get(f, f) for f in fams)
        out.append(f'<p lang="vi" class="vi">{esc(name)} là thể loại nhạc {esc(fv)}{esc(wherev)}, âm hưởng {ev}, {bv}.</p>\n')
        out.append(f'<a class="cta" href="/#g={quote(name, safe="")}">▶ Listen on the map</a>\n')
        if tr:
            out.append(f"<h2>Example tracks</h2>\n<ol class=\"tracks\">\n")
            for t in tr:
                out.append(f'<li><a href="https://open.spotify.com/track/{t[1]}" rel="noopener" target="_blank">'
                           f'{esc(t[2])} — {esc(t[3])}</a></li>\n')
            out.append("</ol>\n")
        for head, idx in (("Related genres", rel[:12]), ("Sub-genres", sub), ("Nearest genres on the map", near[i])):
            if idx:
                out.append(f"<h2>{head}</h2>\n<ul class=\"chips\">" +
                           "".join(f"<li>{link(S[j], G[j]['n'])}</li>" for j in idx) + "</ul>\n")
        out.append(FOOT)
        text = "".join(out)
        maxsize = max(maxsize, len(text.encode()))
        write(f"g/{slug}/index.html", text)

    # family pages + A-Z index
    def page(title, desc, url, body, ld_extra=None):
        ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": title, "url": url, "description": desc}
        return HEAD.format(title=esc(title), desc=esc(desc), url=url, site=SITE, ld=jsonld(ld)) + body + FOOT

    for f, idx in members.items():
        idx = sorted(idx, key=lambda j: G[j]["n"].lower())
        url = f"{SITE}/g/family/{fam_slug[f]}/"
        title = f"{f} genres — {len(idx)} sub-genres | Everynoise"
        desc = f"Browse {len(idx)} {f} music genres and listen to examples on the Everynoise map."
        body = (f"<h1>{esc(f)} genres</h1>\n<p>{len(idx)} genres. <a href=\"/g/\">All genres</a></p>\n<ul class=\"cols\">" +
                "".join(f"<li>{link(S[j], G[j]['n'])}</li>" for j in idx) + "</ul>\n")
        write(f"g/family/{fam_slug[f]}/index.html", page(title, desc, url, body))

    letters = defaultdict(list)
    for i, g in enumerate(G):
        c = unicodedata.normalize("NFKD", g["n"])[:1].upper()
        letters[c if c.isascii() and c.isalpha() else "#"].append(i)
    keys = sorted(letters, key=lambda c: (c == "#", c))
    nav = " ".join(f'<a href="#l-{"num" if c == "#" else c}">{c}</a>' for c in keys)
    fams = "".join(f'<li><a href="/g/family/{fam_slug[f]}/">{esc(f)}</a> ({len(members[f])})</li>' for f in members)
    body = [f"<h1>All music genres</h1>\n<p>{len(G)} genres from the Everynoise map. <a href=\"/\">Open the map</a></p>\n",
            f'<h2>By family</h2>\n<ul class="chips">{fams}</ul>\n<h2>A–Z</h2>\n<p class="az">{nav}</p>\n']
    for c in keys:
        idx = sorted(letters[c], key=lambda j: G[j]["n"].lower())
        body.append(f'<h3 id="l-{"num" if c == "#" else c}">{c}</h3>\n<ul class="cols">' +
                    "".join(f"<li>{link(S[j], G[j]['n'])}</li>" for j in idx) + "</ul>\n")
    write("g/index.html", page("All music genres, A–Z | Everynoise",
                               f"Index of {len(G)} music genres, grouped by letter and family, with example tracks on the Everynoise map.",
                               f"{SITE}/g/", "".join(body)))

    # a real 404: without it Cloudflare Pages answers unknown paths with the app and status 200
    # (a "soft 404" search engines dislike). "/" and "/#g=..." deep links are unaffected.
    nf = HEAD.format(title="Page not found | Everynoise", desc="This page does not exist.", url=f"{SITE}/",
                     site=SITE, ld="{}").replace("</title>", '</title>\n<meta name="robots" content="noindex">', 1)
    (dist / "404.html").write_text(nf + '<h1>Page not found</h1><p>This genre page does not exist. '
                                   '<a href="/g/">Browse all genres</a> or <a href="/">open the map</a>.</p>\n' + FOOT,
                                   encoding="utf-8")

    sm = ['<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n']
    for u in urls:
        extra = "<changefreq>weekly</changefreq><priority>1.0</priority>" if u == SITE + "/" else ""
        sm.append(f"<url><loc>{esc(u)}</loc>{extra}</url>\n")
    sm.append("</urlset>\n")
    (dist / "sitemap.xml").write_text("".join(sm))

    nfiles = sum(1 for p in dist.rglob("*") if p.is_file())
    size = sum(p.stat().st_size for p in gdir.rglob("*") if p.is_file())
    print(f"build_pages: {len(G)} genre pages, {len(urls)} sitemap urls, dist/g {size/1e6:.1f} MB, "
          f"max page {maxsize} B, {nfiles} files in dist, {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
