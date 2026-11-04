#!/usr/bin/env bash
# Build dist/ with only the files the site loads, stamp the service worker version, deploy to Cloudflare Pages.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist && mkdir -p dist/data
cp -R index.html manifest.webmanifest robots.txt sitemap.xml _headers css js fonts icons dist/
cp data/genres.json data/tracks.json data/world.json data/artists.json data/bridge.json data/explain.json dist/data/
cp -R data/more data/near dist/data/
[ -d data/radio ] || { echo "data/radio missing: run python3 scripts/build_radio.py first" >&2; exit 1; }
cp -R data/radio dist/data/radio
# artist shards are not in the repo (45 MB): python3 scripts/build_artists.py regenerates them from data/raw/genre_artists_all.json.gz
[ -d data/ar ] && [ -d data/ap ] || { echo "data/ar and data/ap are missing: run scripts/build_artists.py first" >&2; exit 1; }
cp -R data/ar data/ap dist/data/

# static SEO pages: dist/g/<genre>/index.html for every genre + dist/sitemap.xml (generated, never committed)
python3 scripts/build_pages.py dist

version="$(git rev-parse --short HEAD)$(git diff --quiet || echo -dirty)-$(date +%s)"
sed "s/__VERSION__/$version/" sw.js > dist/sw.js

npx wrangler pages deploy dist --project-name everynoise --branch "${BRANCH:-main}" --commit-dirty=true
echo "deployed sw version $version"
