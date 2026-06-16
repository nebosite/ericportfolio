#!/usr/bin/env bash
#
# provision.sh — full server setup from a fresh Ubuntu 22.04 VPS.
# Idempotent: safe to re-run at any time.
#
# Usage (as root on the VPS):
#   bash provision.sh
#
set -euo pipefail

REPO_DIR=/var/www/portfolio
NODE_MAJOR=20
NVM_DIR=/opt/nvm
export NVM_DIR

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: provision.sh must be run as root." >&2
  exit 1
fi

echo "==> [1/11] Updating apt packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "==> [2/11] Installing system packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential python3 curl git nginx certbot python3-certbot-nginx

echo "==> [3/11] Installing nvm + Node.js ${NODE_MAJOR} LTS (system-wide in ${NVM_DIR})"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  mkdir -p "${NVM_DIR}"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
source "${NVM_DIR}/nvm.sh"
nvm install "${NODE_MAJOR}"
nvm alias default "${NODE_MAJOR}"
nvm use default
# Expose node/npm/npx to every user (PM2 systemd unit included) via /usr/local/bin
NODE_BIN_DIR="$(dirname "$(nvm which default)")"
ln -sf "${NODE_BIN_DIR}/node" /usr/local/bin/node
ln -sf "${NODE_BIN_DIR}/npm" /usr/local/bin/npm
ln -sf "${NODE_BIN_DIR}/npx" /usr/local/bin/npx
echo "    node: $(node --version), npm: $(npm --version)"

echo "==> [4/11] Installing PM2 globally"
npm install -g pm2
ln -sf "${NODE_BIN_DIR}/pm2" /usr/local/bin/pm2

echo "==> [5/11] Preparing ${REPO_DIR}"
mkdir -p /var/www

if [[ -d "${REPO_DIR}/.git" ]]; then
  echo "==> [6/11] Repo already present in ${REPO_DIR} — skipping clone"
else
  echo "==> [6/11] Cloning monorepo"
  if [[ -z "${GIT_REPO_URL:-}" ]]; then
    read -rp "Git repository URL to clone: " GIT_REPO_URL
  fi
  if [[ -z "${GIT_REPO_URL}" ]]; then
    echo "ERROR: a git repository URL is required (set GIT_REPO_URL or enter it at the prompt)." >&2
    exit 1
  fi
  git clone "${GIT_REPO_URL}" "${REPO_DIR}"
fi

cd "${REPO_DIR}"

echo "==> [7/11] Installing npm dependencies (workspaces, clean from lockfile)"
# npm ci installs exactly what package-lock.json specifies and never rewrites
# it, keeping the working tree clean so later `git pull`s in deploy.sh aren't
# blocked by a drifted lockfile.
npm ci

echo "==> [8/11] Building all four apps (client + server)"
npm run build

echo "==> [9/11] Installing nginx configs"
bash "${REPO_DIR}/scripts/nginx-gen.sh"

# Ensure the feedback service has an admin token. Persisted to /root/portfolio.env
# (chmod 600) and exported so PM2 captures it; reused by deploy.sh thereafter.
ENV_FILE=/root/portfolio.env
GENERATED_TOKEN=0
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
fi
if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  ADMIN_TOKEN="$(openssl rand -hex 24)"
  echo "ADMIN_TOKEN=${ADMIN_TOKEN}" >> "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  GENERATED_TOKEN=1
fi
export ADMIN_TOKEN

echo "==> [10/11] Starting PM2 apps"
pm2 startOrReload "${REPO_DIR}/ecosystem.config.js" --update-env
pm2 save
# Install the systemd startup hook so PM2 resurrects apps on reboot
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

echo "==> [11/11] Done"
if [[ "${GENERATED_TOKEN}" == "1" ]]; then
  echo
  echo "============================================================"
  echo " Feedback admin password (save this — it won't be shown again):"
  echo "     ${ADMIN_TOKEN}"
  echo " Stored in ${ENV_FILE}. Log in at:"
  echo "     https://ericjorgensen.com/manage/feedback"
  echo "============================================================"
fi
cat <<'CHECKLIST'

============================================================
 Provisioning complete. Post-install checklist:
============================================================
 1. Point DNS A records for all 4 domains (and their www
    subdomains) at this server's IP.
 2. Once DNS has propagated, run:
        bash /var/www/portfolio/scripts/ssl-setup.sh
    to obtain Let's Encrypt certificates and switch nginx
    to HTTPS.
 3. Verify each app:
        curl http://<domain>/api/health
 4. Manage feedback at https://ericjorgensen.com/manage/feedback
    (admin password is in /root/portfolio.env).
 5. Check process health any time with:  pm2 status
============================================================
CHECKLIST
