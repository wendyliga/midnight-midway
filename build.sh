#!/usr/bin/env bash
set -euo pipefail

# Run from the repo root (the directory this script lives in).
cd "$(dirname "$0")"

# Install dependencies on first run (node_modules is git-ignored).
if [ ! -d node_modules ]; then
  echo "node_modules not found — installing dependencies..."
  npm install
fi

# Regenerate favicons + the Open Graph preview from the alley photo. Cheap;
# always runs so the icons and preview never lag behind a source change.
echo "Rendering icons and social preview into public/ ..."
node scripts/gen-icons.mjs

# Stamp the build with the current git commit so the hash is visible in-game.
export VITE_BUILD_HASH="$(git rev-parse --short=8 HEAD 2>/dev/null || echo 'dev')"
echo "Build hash: $VITE_BUILD_HASH"

# Build the site into ./dist. Extra args pass through to Vite,
# e.g. ./build.sh --base=/midnight-midway/
echo ""
echo "Building single-file site into ./dist ..."
npm run build -- "$@"

echo ""
echo "Done. dist/:"
ls -1 dist
echo ""
echo "  ./dist/index.html  — the game (open it, or upload the whole folder)"
