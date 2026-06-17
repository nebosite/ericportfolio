#!/usr/bin/env bash
#
# preflight.sh — pre-deploy safety checks, run on the VPS before pulling/building.
# Aborts (non-zero exit) on anything it can't safely fix, so a bad environment
# state can't ship stale or broken code. Safe to run on its own at any time.
#
set -euo pipefail

REPO_DIR=/var/www/portfolio
ENV_FILE=/root/portfolio.env

cd "${REPO_DIR}"

echo "==> Preflight checks"

# 1. Must actually be the git repo.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: ${REPO_DIR} is not a git working tree." >&2
  exit 1
fi

# 2. Clean working tree. A dirty tree blocks `git pull`. The only drift we know
#    is safe to discard is package-lock.json (older `npm install`s rewrote it;
#    `npm ci` no longer does). Anything else must be resolved by hand rather than
#    deployed around.
dirty="$(git status --porcelain)"
if [[ -n "${dirty}" ]]; then
  non_lock="$(git status --porcelain | awk '{print $2}' | grep -v '^package-lock\.json$' || true)"
  if [[ -z "${non_lock}" ]]; then
    echo "    package-lock.json drifted — restoring it"
    git checkout HEAD -- package-lock.json
  else
    echo "ERROR: the VPS working tree is not clean. Resolve these before deploying:" >&2
    git status --short >&2
    exit 1
  fi
fi

# 3. On the expected branch.
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${branch}" != "main" ]]; then
  echo "ERROR: expected branch 'main' but on '${branch}'." >&2
  exit 1
fi

# 4. Fetch and refuse to deploy unless we can fast-forward to origin/main
#    (i.e. no stray commits made directly on the server).
git fetch --quiet origin main
local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse origin/main)"
base="$(git merge-base HEAD origin/main)"
if [[ "${local_head}" == "${remote_head}" ]]; then
  echo "    already up to date with origin/main ($(git rev-parse --short HEAD))"
elif [[ "${base}" != "${local_head}" ]]; then
  echo "ERROR: local main has diverged from origin/main; refusing to deploy." >&2
  echo "       Resolve the divergence on the server manually." >&2
  exit 1
else
  echo "    fast-forward available: $(git rev-parse --short HEAD) -> $(git rev-parse --short origin/main)"
fi

# 5. ADMIN_TOKEN available for the feedback service (warn only — the rest of the
#    deploy is still valid, the admin API just stays closed without it).
if [[ -f "${ENV_FILE}" ]] && grep -q '^ADMIN_TOKEN=' "${ENV_FILE}"; then
  echo "    ADMIN_TOKEN present in ${ENV_FILE}"
else
  echo "WARNING: ADMIN_TOKEN not found in ${ENV_FILE} — the feedback admin API will be closed until it is set." >&2
fi

echo "==> Preflight OK"
