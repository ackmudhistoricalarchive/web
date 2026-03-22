#!/usr/bin/env bash
# Setup script for the web server container at 192.168.1.113.
#
# Run as root (or with sudo) on the new container after cloning this repo:
#   sudo bash scripts/setup-web-container.sh
#
# Prerequisites:
#   - Ports 80/443/9890/8891/8892 must be forwarded to 192.168.1.113 on the
#     network router/firewall before running certbot (needed for ACME HTTP-01
#     challenge on port 80).

set -euo pipefail

DOMAIN="ackmud.com"
EMAIL="${CERTBOT_EMAIL:-admin@ackmud.com}"
WEBROOT="/var/www/certbot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # ~/web

echo "==> Web container setup"
echo "    Repo: $REPO_DIR"
echo ""

# ── 1. Install packages ────────────────────────────────────────────────────────
echo "==> [1/5] Installing packages..."
apt-get update -y
apt-get install -y nginx certbot python3

# ── 2. Create ACME webroot ─────────────────────────────────────────────────────
echo "==> [2/5] Preparing ACME webroot..."
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"
chmod 775 "$WEBROOT"

# ── 3. Bootstrap nginx for ACME challenge ─────────────────────────────────────
echo "==> [3/5] Installing bootstrap nginx config for certificate request..."
cat > /etc/nginx/sites-available/ackmud-bootstrap.conf <<'EOF'
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

ln -sf /etc/nginx/sites-available/ackmud-bootstrap.conf \
        /etc/nginx/sites-enabled/ackmud-bootstrap.conf
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx

# ── 4. Obtain TLS certificate ──────────────────────────────────────────────────
echo "==> [4/5] Obtaining Let's Encrypt certificate..."
certbot certonly \
    --webroot \
    --webroot-path "$WEBROOT" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    -d "aha.$DOMAIN"

# Install nginx reload hook; no acktng restart hook needed here.
install -m 755 "$REPO_DIR/scripts/certbot-post-renew.sh" \
    /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh

# Enable certbot auto-renewal
if systemctl list-units --type=timer 2>/dev/null | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
    echo "    certbot systemd timer enabled."
else
    CRON_LINE="0 0,12 * * * root certbot renew --quiet"
    echo "$CRON_LINE" > /etc/cron.d/certbot-ackmud
    echo "    certbot cron job written to /etc/cron.d/certbot-ackmud."
fi

# Install full nginx config
cp "$REPO_DIR/nginx/ackmud.conf" /etc/nginx/sites-available/ackmud.conf
ln -sf /etc/nginx/sites-available/ackmud.conf \
        /etc/nginx/sites-enabled/ackmud.conf
rm -f /etc/nginx/sites-enabled/ackmud-bootstrap.conf \
      /etc/nginx/sites-available/ackmud-bootstrap.conf

nginx -t
systemctl reload nginx

# ── 5. Install and start Python web server ────────────────────────────────────
echo "==> [5/5] Installing Python web service..."
sed "s|/home/user/web|$REPO_DIR|g" "$REPO_DIR/systemd/web-server.service" \
    > /etc/systemd/system/web-server.service
chmod 644 /etc/systemd/system/web-server.service
systemctl daemon-reload
systemctl enable web-server
systemctl restart web-server

sleep 2
if systemctl is-active --quiet web-server; then
    echo "    web-server.service is running."
else
    echo "ERROR: web-server.service failed to start."
    journalctl -u web-server --no-pager -n 30
    exit 1
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "Setup complete."
echo ""
echo "  Web server:  https://$DOMAIN  (proxy → 127.0.0.1:8080)"
echo "  Game API:    http://192.168.1.103:8080  (via ACKTNG_GAME_URL)"
echo ""
echo "Next steps:"
echo "  1. Verify:  curl -k --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/"
echo "  2. Update the DEPLOY_HOST GitHub Actions secret to 192.168.1.113"
echo "  3. Re-point router port forwarding (80/443/9890/8891/8892) to 192.168.1.113"
echo "  4. Run  sudo bash scripts/cleanup-acktng-web.sh  on 192.168.1.103"
