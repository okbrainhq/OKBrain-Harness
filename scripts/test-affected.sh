#!/bin/bash
# Usage: ./scripts/test-affected.sh [base-ref]
# Default base-ref: main

BASE=${1:-main}
RETRIES=${RETRIES:-0}

CHANGED=$(git diff --name-only $BASE...HEAD 2>/dev/null || git diff --name-only $BASE HEAD)

if [ -z "$CHANGED" ]; then
  CHANGED=$(git diff --name-only)
fi

if [ -z "$CHANGED" ]; then
  echo "No changed files detected."
  exit 0
fi

# Use node to map changed files to groups
GROUPS=$(node -e "
const mapping = require('./scripts/test-path-mapping.json');
const groups = require('./scripts/test-groups.json');
const changed = process.argv.slice(1);
const catchAll = ['src/lib/db/', 'e2e/test-utils.ts', 'playwright.config.ts', 'src/app/(main)/layout.tsx'];

// Check catch-all
const hitCatchAll = changed.some(f => catchAll.some(c => f.includes(c)));
if (hitCatchAll) {
  console.log('ALL');
  process.exit(0);
}

const matched = new Set();
for (const file of changed) {
  for (const [pathPrefix, group] of Object.entries(mapping)) {
    if (file.includes(pathPrefix)) {
      matched.add(group);
    }
  }
}

if (matched.size === 0) {
  console.log('NONE');
} else {
  console.log([...matched].join(' '));
}
" $CHANGED)

if [ "$GROUPS" = "ALL" ]; then
  echo "Core files changed — run full suite:"
  echo "  npm run test:e2e"
  exit 0
fi

if [ "$GROUPS" = "NONE" ]; then
  echo "No test groups matched. Changed files:"
  echo "$CHANGED" | head -20
  echo ""
  echo "Consider running smoke tests: npm run test:smoke"
  exit 0
fi

echo "Affected groups: $GROUPS"
echo ""

# Collect all test files from matched groups
TESTS=$(node -e "
const groups = require('./scripts/test-groups.json');
const matched = '$GROUPS'.split(' ');
const files = new Set();
for (const g of matched) {
  if (groups[g]) groups[g].tests.forEach(t => files.add('e2e/' + t));
}
console.log([...files].join(' '));
")

echo "Command:"
echo "  npx playwright test $TESTS --retries=$RETRIES"
echo ""
read -p "Run now? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  npm run kill:test-server 2>/dev/null
  npx playwright test $TESTS --retries=$RETRIES
fi
