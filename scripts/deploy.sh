#!/usr/bin/env bash
# Build dist/ with only the files the site loads, stamp the service worker version, deploy to Cloudflare Pages.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist && mkdir -p dist/data
cp -R index.html manifest.webmanifest robots.txt sitemap.xml _headers css js fonts icons dist/
cp data/genres.json data/tracks.json data/world.json dist/data/
cp -R data/more dist/data/more

# static SEO pages: dist/g/<genre>/index.html for every genre + dist/sitemap.xml (generated, never committed)
python3 scripts/build_pages.py dist

version="$(git rev-parse --short HEAD)$(git diff --quiet || echo -dirty)-$(date +%s)"
sed "s/__VERSION__/$version/" sw.js > dist/sw.js

npx wrangler pages deploy dist --project-name everynoise --branch "${BRANCH:-main}" --commit-dirty=true
echo "deployed sw version $version"
