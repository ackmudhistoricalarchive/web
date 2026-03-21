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
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"  # ~/web
ACKTNG_DIR="$(dirname "$REPO_DIR")/acktng"    # ~/acktng (sibling of ~/web)

# ── 1. Install packages ────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y nginx certbot

# ── 2. Prepare ACME webroot ────────────────────────────────────────────────────
# The webroot is shared: nginx serves it for HTTP-01 challenges, and any
# process that runs certbot --webroot can point at the same path.
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"
# Group-writable so that certbot can write challenge files regardless of which
# user triggers the renewal (root via cron, or acktng via sudo certbot).
chmod 775 "$WEBROOT"

# ── 3. Install a minimal HTTP-only nginx config to pass the ACME challenge ─────
# (We can't install the full config yet because the certificate doesn't exist.)
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
    -d "www.$DOMAIN" \
    -d "aha.$DOMAIN"

# ── 5. Install the full nginx config ──────────────────────────────────────────
cp "$REPO_DIR/nginx/ackmud.conf" /etc/nginx/sites-available/ackmud.conf
ln -sf /etc/nginx/sites-available/ackmud.conf \
        /etc/nginx/sites-enabled/ackmud.conf

# Remove bootstrap config
rm -f /etc/nginx/sites-enabled/ackmud-bootstrap.conf \
      /etc/nginx/sites-available/ackmud-bootstrap.conf

# Remove acktng's legacy WSS proxy config if it exists — this file supersedes it.
if [[ -f /etc/nginx/conf.d/ackmud-wss.conf ]]; then
    echo "Removing legacy acktng WSS config (/etc/nginx/conf.d/ackmud-wss.conf)."
    rm -f /etc/nginx/conf.d/ackmud-wss.conf
fi

nginx -t
systemctl reload nginx

# ── 6. Install certbot post-renewal hooks ─────────────────────────────────────
# Hook 1: reload nginx to serve the new certificate on ports 443/9890/8891/8892.
install -m 755 "$REPO_DIR/scripts/certbot-post-renew.sh" \
    /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh

# Hook 2: restart MUD game server processes (acktng, ack431, ack42).
# Install from the acktng repo if you prefer to keep it there; the file is
# included here so the web repo is the single source of truth for the setup.
install -m 755 "$REPO_DIR/scripts/certbot-post-renew-acktng.sh" \
    /etc/letsencrypt/renewal-hooks/post/acktng-restart.sh

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
echo "  Certificates will auto-renew; nginx and acktng restart on each renewal."
echo ""
echo "Server layout:"
echo "  ~/web    → $REPO_DIR"
echo "  ~/acktng → $ACKTNG_DIR"
echo ""
echo "  To renew the cert manually (from either repo's Makefile):"
echo "    make -C $REPO_DIR certbot-acktng"
echo "  or directly:"
echo "    sudo certbot certonly --webroot --webroot-path $WEBROOT \\"
echo "        --non-interactive --agree-tos --email $EMAIL -d $DOMAIN"
echo ""
echo "Next step: run 'make' in ~/web to start the Python web server on port 8080."
