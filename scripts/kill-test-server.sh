#!/usr/bin/env bash
set -euo pipefail

SELF_PID="$$"
PARENT_PID="$PPID"

mapfile -t PIDS < <(
  ps -eo pid=,args= | awk -v self="$SELF_PID" -v parent="$PARENT_PID" '
    {
      pid = $1
      $1 = ""
      args = substr($0, 2)

      is_dev_test = (args ~ /node scripts\/dev-test\.js( |$)/ && args ~ /-p 3001/)
      is_next_dev = (args ~ /next dev( |$)/ && args ~ /-p 3001/)

      if ((is_dev_test || is_next_dev) && pid != self && pid != parent) {
        print pid
      }
    }
  '
)

if [ "${#PIDS[@]}" -gt 0 ]; then
  echo "[kill:test-server] killing stale test server PIDs: ${PIDS[*]}"
  kill "${PIDS[@]}" 2>/dev/null || true
  sleep 1
fi

# Delete test database for a clean slate
DB_PATH="brain.test.db"
rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"
