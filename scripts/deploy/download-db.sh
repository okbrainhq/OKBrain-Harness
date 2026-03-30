#!/bin/bash

# scripts/deploy/download-db.sh
# Purpose: Downloads the SQLite database from a remote server using a safe backup.
# Usage: ./scripts/deploy/download-db.sh [USER@HOST]
#
# Uses sqlite3 .backup on the remote server to create a consistent snapshot,
# then downloads it to the current working directory as brain.db.

set -e

# Read config from .deploy file
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$PROJECT_ROOT/.deploy" ]; then
    source "$PROJECT_ROOT/.deploy"
fi

HOST=${1:-"$DEPLOY_HOST"}

if [ -z "$HOST" ]; then
    echo "Error: No host specified and DEPLOY_HOST not set in .deploy file."
    echo "Usage: ./scripts/deploy/download-db.sh [USER@HOST]"
    echo "Or create a .deploy file in the project root."
    exit 1
fi

REMOTE_DB="/var/www/brain/brain.db"
REMOTE_BACKUP="/tmp/brain-backup-$(date +%s).db"
LOCAL_FILE="./brain.db"

if [ -f "$LOCAL_FILE" ]; then
    echo "Warning: $LOCAL_FILE already exists in the current directory."
    read -p "Overwrite? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo "Creating backup on $HOST..."
ssh "$HOST" "sqlite3 '$REMOTE_DB' \".backup '$REMOTE_BACKUP'\""

echo "Downloading backup..."
scp "$HOST:$REMOTE_BACKUP" "$LOCAL_FILE"

echo "Cleaning up remote backup..."
ssh "$HOST" "rm -f '$REMOTE_BACKUP'"

echo "Done! Database saved to $LOCAL_FILE"
ls -lh "$LOCAL_FILE"
