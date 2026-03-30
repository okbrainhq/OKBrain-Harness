#!/bin/bash
# Usage: ./scripts/test-group.sh <group> [--grep PATTERN] [--retries N]

GROUP=$1
shift 2>/dev/null || true

RETRIES=${RETRIES:-0}
USER_GREP=""

# Parse flags
while [[ $# -gt 0 ]]; do
  case $1 in
    --retries) RETRIES=$2; shift 2;;
    --grep) USER_GREP=$2; shift 2;;
    *) shift;;
  esac
done

if [ -z "$GROUP" ]; then
  echo "Usage: ./scripts/test-group.sh <group> [--grep PATTERN] [--retries N]"
  echo ""
  echo "Available groups:"
  node -e "const g = require('./scripts/test-groups.json'); Object.keys(g).forEach(k => console.log('  ' + k + ': ' + g[k].tests.join(', ')))"
  exit 1
fi

GROUPS_FILE="./scripts/test-groups.json"
GROUP_DATA=$(node -e "const g = require('$GROUPS_FILE')['$GROUP']; if(!g){process.exit(1)}; console.log(JSON.stringify(g))")

if [ $? -ne 0 ]; then
  echo "Unknown group: $GROUP"
  exit 1
fi

TESTS=$(node -e "const g = JSON.parse('$GROUP_DATA'); console.log(g.tests.map(t => 'e2e/' + t).join(' '))")

# User --grep overrides the group's built-in grep
if [ -n "$USER_GREP" ]; then
  GREP="--grep $USER_GREP"
else
  GREP=$(node -e "const g = JSON.parse('$GROUP_DATA'); if(g.grep) console.log('--grep ' + g.grep)")
fi

echo "Running group: $GROUP"
echo "Tests: $TESTS"
[ -n "$GREP" ] && echo "Filter: $GREP"

npm run kill:test-server 2>/dev/null
npx playwright test $TESTS $GREP --retries=$RETRIES
