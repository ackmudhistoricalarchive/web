#!/usr/bin/env bash
# One-time setup: install nginx + certbot, obtain TLS certificates, and wire
# everything together for ackmud.com.
#
# Run as root (or with sudo) on the deployment host:
#   sudo bash scripts/install-nginx-certbot.sh
#
# After this script completes:
#   - nginx serves HTTPS on port 443, proxying to the Python app on port 8080.
#   - WSS proxies listen on ports 9890, 8891, and 8892.
#   - certbot auto-renews certificates twice daily (via systemd timer or cron).
#   - nginx reloads automatically after each successful renewal.

set -euo pipefail

DOMAIN="ackmud.com"
EMAIL="${CERTBOT_EMAIL:-admin@ackmud.com}"   # override with CERTBOT_EMAIL env var
WEBROOT="/var/www/certbot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── 1. Install packages ────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y nginx certbot

# ── 2. Prepare ACME webroot ────────────────────────────────────────────────────
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"

# ── 3. Install a minimal HTTP-only nginx config to pass the ACME challenge ─────
# (We can't install the full config yet because the certificate doesn't exist.)
cat > /etc/nginx/sites-available/ackmud-bootstrap.conf <<'EOF'
server {
    listen 80;
    server_name ackmud.com www.ackmud.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Bootstrap: HTTPS setup in progress.\n';
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ackmud-bootstrap.conf \
        /etc/nginx/sites-enabled/ackmud-bootstrap.conf

# Disable the default site if present
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

# ── 4. Obtain the initial certificate ─────────────────────────────────────────
# --webroot uses the directory nginx is already serving; no service interruption.
certbot certonly \
    --webroot \
    --webroot-path "$WEBROOT" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"

# ── 5. Install the full nginx config ──────────────────────────────────────────
cp "$REPO_DIR/nginx/ackmud.conf" /etc/nginx/sites-available/ackmud.conf
ln -sf /etc/nginx/sites-available/ackmud.conf \
        /etc/nginx/sites-enabled/ackmud.conf

# Remove bootstrap config
rm -f /etc/nginx/sites-enabled/ackmud-bootstrap.conf \
      /etc/nginx/sites-available/ackmud-bootstrap.conf

nginx -t
systemctl reload nginx

# ── 6. Install certbot post-renewal hook ──────────────────────────────────────
install -m 755 "$REPO_DIR/scripts/certbot-post-renew.sh" \
    /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh

# ── 7. Ensure certbot timer / cron is active ──────────────────────────────────
if systemctl list-units --type=timer | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
    echo "certbot systemd timer enabled."
else
    # Fallback: add cron job if the distro uses cron instead
    CRON_LINE="0 0,12 * * * root certbot renew --quiet"
    CRON_FILE="/etc/cron.d/certbot-ackmud"
    echo "$CRON_LINE" > "$CRON_FILE"
    echo "certbot cron job written to $CRON_FILE."
fi

echo ""
echo "Setup complete."
echo "  nginx is serving HTTPS for $DOMAIN."
echo "  Certificates will auto-renew; nginx reloads on each renewal."
echo ""
echo "Next step: run 'make' to start the Python web server on port 8080."
