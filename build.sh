#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Transit Agent Build ==="
echo ""

# Step 1: Bundle each agency's TypeScript into a standalone Node-compatible JS file
echo "Compiling TypeScript → transit/scripts/*.js ..."
mkdir -p transit/scripts

AGENCIES=(capmetro cta mta tfl metra)
for agency in "${AGENCIES[@]}"; do
  echo "  Bundling ${agency}..."
  bun build "src/${agency}/arrivals.ts" \
    --target=node \
    --format=esm \
    --outfile "transit/scripts/${agency}_arrivals.js" \
    --minify-whitespace
done

echo "  Done."
echo ""

# Step 2: Verify no Bun-specific APIs leaked into output
echo "Checking for Bun-specific APIs in compiled output..."
if grep -r 'Bun\.' transit/scripts/*.js 2>/dev/null; then
  echo ""
  echo "ERROR: Bun-specific APIs found in compiled scripts!"
  echo "These scripts must be Node.js-compatible. Remove Bun.* usage from src/."
  exit 1
fi
echo "  Clean — no Bun-specific APIs found."
echo ""

# Step 3: Sanity checks
echo "=== Sanity Checks ==="

MISSING=0
for agency in "${AGENCIES[@]}"; do
  SCRIPT="transit/scripts/${agency}_arrivals.js"
  if [ -f "$SCRIPT" ]; then
    SIZE=$(wc -c < "$SCRIPT" | tr -d ' ')
    echo "  ${agency}_arrivals.js: ${SIZE} bytes"
  else
    echo "  ERROR: ${SCRIPT} missing!"
    MISSING=1
  fi
done

for agency in "${AGENCIES[@]}"; do
  REF="transit/references/${agency}.md"
  if [ -f "$REF" ]; then
    echo "  references/${agency}.md: present"
  else
    echo "  ERROR: ${REF} missing!"
    MISSING=1
  fi
done

if [ "$MISSING" -ne 0 ]; then
  exit 1
fi

echo ""
echo "=== Build complete ==="
