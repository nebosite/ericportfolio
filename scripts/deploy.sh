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

cd "${REPO_DIR}"

# Pre-deploy safety checks (clean tree, right branch, fast-forwardable, token).
# Aborts the deploy if it finds a problem it can't safely fix.
bash "${REPO_DIR}/scripts/preflight.sh"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Installing dependencies (clean, from package-lock.json)"
# npm ci installs exactly what the lockfile says and never rewrites it, so it
# won't leave the working tree dirty and block the next git pull.
npm ci

echo "==> Building all apps"
npm run build

echo "==> Reloading PM2 processes"
# startOrReload (not reload) so newly-added services are started, not skipped.
pm2 startOrReload "${REPO_DIR}/ecosystem.config.js" --update-env
pm2 save

# Post-deploy verification: fail loudly if any service is unhealthy.
bash "${REPO_DIR}/scripts/smoke-test.sh"

echo
echo "============================================"
echo " Deploy complete: $(git rev-parse --short HEAD)"
echo "============================================"
pm2 status
