#!/usr/bin/env bash
#
# smoke-test.sh — post-deploy verification, run on the VPS after PM2 reloads.
# Hits each service directly on localhost (no DNS/SSL needed) and fails the
# deploy if anything is unhealthy. Add a check here whenever you add a service
# or a critical endpoint.
#
set -uo pipefail

fail=0

check() {
  local name="$1" url="$2" expect="${3:-200}" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${url}" 2>/dev/null || echo 000)"
  if [[ "${code}" == "${expect}" ]]; then
    echo "    OK   ${name} (${code})"
  else
    echo "    FAIL ${name} (got ${code}, expected ${expect})" >&2
    fail=1
  fi
}

echo "==> Smoke test (localhost services)"
check "ericjorgensen health" "http://localhost:3001/api/health"
check "pixelwhimsy health"   "http://localhost:3002/api/health"
check "thejcrew health"      "http://localhost:3003/api/health"
check "bigtinygames health"  "http://localhost:3004/api/health"
check "feedback health"      "http://localhost:3005/api/health"
# The feedback admin API must reject an unauthenticated request.
check "feedback admin gated" "http://localhost:3005/api/admin/feedback" 401

if [[ "${fail}" != 0 ]]; then
  echo "==> Smoke test FAILED — services are not all healthy." >&2
  exit 1
fi
echo "==> Smoke test passed"
