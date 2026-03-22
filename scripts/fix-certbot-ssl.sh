#!/usr/bin/env bash
# Fix/re-obtain TLS certificates for ackmud.com when the full nginx config
# cannot load (because certs are missing or expired) — the chicken-and-egg problem.
#
# This script:
#   1. Ensures /var/www/certbot exists
#   2. Swaps in a temporary HTTP-only nginx config (no SSL required)
#   3. Runs certbot --webroot to obtain/renew the cert
#   4. Restores the full nginx config
#
# Prerequisites:
#   - DNS A records for ackmud.com, www.ackmud.com, and aha.ackmud.com must
#     all point to this server's public IP before running this script.
#     Verify with: dig +short ackmud.com www.ackmud.com aha.ackmud.com
#
# Run as root (or with sudo):
#   sudo bash scripts/fix-certbot-ssl.sh

set -euo pipefail

DOMAIN="ackmud.com"
EMAIL="${CERTBOT_EMAIL:-admin@ackmud.com}"
WEBROOT="/var/www/certbot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

BOOTSTRAP_AVAILABLE="/etc/nginx/sites-available/ackmud-bootstrap.conf"
BOOTSTRAP_ENABLED="/etc/nginx/sites-enabled/ackmud-bootstrap.conf"
FULL_AVAILABLE="/etc/nginx/sites-available/ackmud.conf"
FULL_ENABLED="/etc/nginx/sites-enabled/ackmud.conf"

# ── 0. Preflight: verify DNS resolves for all three domains ───────────────────
echo "Checking DNS resolution..."
all_ok=true
for host in "$DOMAIN" "www.$DOMAIN" "aha.$DOMAIN"; do
    if dig +short "$host" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "  OK  $host → $(dig +short "$host" | head -1)"
    else
        echo "  FAIL  $host — no A record found"
        all_ok=false
    fi
done
if [[ "$all_ok" != "true" ]]; then
    echo ""
    echo "ERROR: One or more domains have no DNS A record."
    echo "Add the missing A records at your DNS provider and re-run this script."
    exit 1
fi

# ── 1. Ensure ACME webroot exists ─────────────────────────────────────────────
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"
chmod 775 "$WEBROOT"

# ── 2. Install temporary bootstrap nginx config (HTTP only, no SSL) ───────────
cat > "$BOOTSTRAP_AVAILABLE" <<'EOF'
server {
    listen 80;
    server_name ackmud.com www.ackmud.com aha.ackmud.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Bootstrap: HTTPS setup in progress.\n';
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf "$BOOTSTRAP_AVAILABLE" "$BOOTSTRAP_ENABLED"

# Disable the full config while we bootstrap (it needs certs that may not exist)
rm -f "$FULL_ENABLED"

nginx -t
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
else
    systemctl start nginx
fi
echo "Bootstrap nginx config active."

# ── 3. Obtain/renew certificate ───────────────────────────────────────────────
certbot certonly \
    --webroot \
    --webroot-path "$WEBROOT" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    -d "aha.$DOMAIN"

# ── 4. Restore the full nginx config ─────────────────────────────────────────
cp "$REPO_DIR/nginx/ackmud.conf" "$FULL_AVAILABLE"
ln -sf "$FULL_AVAILABLE" "$FULL_ENABLED"

rm -f "$BOOTSTRAP_ENABLED" "$BOOTSTRAP_AVAILABLE"

nginx -t
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
else
    systemctl start nginx
fi

echo ""
echo "Done. Certificate obtained and nginx is serving HTTPS for $DOMAIN."
