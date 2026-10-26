#!/bin/sh
# The server sync function gets a bundled copy of the shared core (only what it uses).
# Edit src/core/*.js, then run this before deploying supabase/functions/priority-sync.
set -e
cd "$(dirname "$0")/.."
rm -rf supabase/functions/priority-sync/core
npx esbuild src/core/server.js --bundle --format=esm --platform=neutral --tree-shaking=true \
  --banner:js="// GENERATED from src/core — do not edit here; run scripts/copy-core.sh" \
  --outfile=supabase/functions/priority-sync/core.js --log-level=warning
echo "core bundled"
