#!/bin/bash

# deploy.sh
# Purpose: Updates the application code, builds, and restarts the service.
# Usage: ./scripts/deploy.sh

set -e

APP_DIR="/var/www/brain"
DATA_DIR="/var/www/brain-data"
BRANCH="main"

export UPLOAD_DATA_DIR="$DATA_DIR"

echo "Starting deployment for Brain App..."
echo "Target Directory: $APP_DIR"
echo "Branch: $BRANCH"

# Navigate to app directory
cd "$APP_DIR"

# 1. Pull latest changes
echo "Fetching latest changes..."
git fetch origin

# 2. Reset to remote main (Handles conflicts by discarding local tracked changes)
# WARNING: This will overwrite any LOCAL changes to tracked files.
# .env.local and brain.db should be ignored by git, so they will be safe.
echo "Resetting to origin/$BRANCH..."
git reset --hard "origin/$BRANCH"

# 3. Install dependencies
echo "Installing dependencies..."
npm ci

# 4. Build application
echo "Building application..."
npm run build

# 5. Restart with PM2
echo "Restarting application with PM2..."

# Check if process exists
if pm2 show brain > /dev/null 2>&1; then
    echo "Process found. Restarting..."
    pm2 restart brain --update-env
else
    echo "Process not found. Starting new process..."
    pm2 start npm --name "brain" -- start
fi

# Save the process list so it respawns on reboot
pm2 save

echo "Deployment completed successfully!"
