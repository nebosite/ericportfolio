#!/usr/bin/env bash
#
# ssl-setup.sh — obtain Let's Encrypt certificates for all four domains and
# switch nginx to the full HTTPS configs. Idempotent (certbot skips domains
# that already have valid certificates).
#
# Certificates are requested per-domain (one cert per domain + its www
# subdomain) so each lands in /etc/letsencrypt/live/<domain>/, which is the
# path the nginx configs reference.
#
set -euo pipefail

REPO_DIR=/var/www/portfolio
SERVER_IP=198.71.56.24

DOMAINS=(
  ericjorgensen.com
  pixelwhimsy.com
  thejcrew.net
  bigtinygames.com
)

echo "Before continuing, confirm that DNS A records for ALL of these names"
echo "point to ${SERVER_IP}:"
for d in "${DOMAINS[@]}"; do
  echo "  - ${d} and www.${d}"
done
read -rp "DNS is configured and propagated for all domains? [y/N] " CONFIRM
if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
  echo "Aborting. Re-run this script once DNS is in place."
  exit 1
fi

for d in "${DOMAINS[@]}"; do
  echo "==> Requesting certificate for ${d} + www.${d}"
  certbot certonly --nginx --non-interactive --agree-tos \
    --register-unsafely-without-email --keep-until-expiring \
    -d "${d}" -d "www.${d}"
done

echo "==> Installing HTTPS nginx configs"
bash "${REPO_DIR}/scripts/nginx-gen.sh"

echo
echo "============================================================"
echo " SSL setup complete. All four domains now serve HTTPS."
echo " Certbot installed a systemd timer for automatic renewal;"
echo " verify with: systemctl list-timers | grep certbot"
echo "============================================================"
