#!/usr/bin/env bash
#
# deploy.sh — pull the latest code, rebuild all apps, reload PM2.
# Run on the VPS for every deployment after initial provisioning.
#
set -euo pipefail

REPO_DIR=/var/www/portfolio

echo "==> Pulling latest code"
cd "${REPO_DIR}"
git pull

echo "==> Installing dependencies"
npm install

echo "==> Building all four apps"
npm run build

echo "==> Reloading PM2 processes"
pm2 reload "${REPO_DIR}/ecosystem.config.js" --update-env

echo
echo "============================================"
echo " Deploy complete: $(git rev-parse --short HEAD)"
echo "============================================"
pm2 status
