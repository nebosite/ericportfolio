#!/usr/bin/env bash
#
# deploy.sh — pull the latest code, rebuild all apps, reload PM2.
# Run on the VPS for every deployment after initial provisioning.
#
set -euo pipefail

REPO_DIR=/var/www/portfolio
ENV_FILE=/root/portfolio.env

# Load persisted secrets (e.g. ADMIN_TOKEN for the feedback service) so PM2
# captures them via --update-env.
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
fi

echo "==> Pulling latest code"
cd "${REPO_DIR}"
git pull

echo "==> Installing dependencies (clean, from package-lock.json)"
# npm ci installs exactly what the lockfile says and never rewrites it, so it
# won't leave the working tree dirty and block the next git pull.
npm ci

echo "==> Building all apps"
npm run build

echo "==> Reloading PM2 processes"
pm2 reload "${REPO_DIR}/ecosystem.config.js" --update-env

echo
echo "============================================"
echo " Deploy complete: $(git rev-parse --short HEAD)"
echo "============================================"
pm2 status
