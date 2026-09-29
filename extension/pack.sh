#!/bin/sh
# Zips the extension into the app's public folder, so Netlify serves it at /monarch-lead-finder.zip.
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
mkdir "$tmp/monarch-lead-finder"
cp -r extension/manifest.json extension/*.js extension/*.html extension/*.css extension/icons extension/README.md "$tmp/monarch-lead-finder/"
rm -f "$tmp/monarch-lead-finder/test.mjs"
rm -f app/public/monarch-lead-finder.zip
(cd "$tmp" && zip -qrX - monarch-lead-finder) > app/public/monarch-lead-finder.zip
rm -rf "$tmp"
echo "Wrote app/public/monarch-lead-finder.zip"
