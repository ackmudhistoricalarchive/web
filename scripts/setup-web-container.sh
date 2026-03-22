#!/usr/bin/env bash
# Setup script for the web server container at 192.168.1.113.
#
# Run as root (or with sudo) on the new container after cloning this repo:
#   sudo bash scripts/setup-web-container.sh
#
# Prerequisites:
#   - The acktng host (192.168.1.103) must already be exporting
#     /home/user/acktng via NFS before this script mounts it.
#     Run  scripts/cleanup-acktng-web.sh --nfs-only  on 192.168.1.103 first,
#     or run the NFS export section of that script manually.
#   - Ports 80/443/9890/8891/8892 must be forwarded to 192.168.1.113 on the
#     network router/firewall before running certbot.

set -euo pipefail

ACKTNG_HOST="192.168.1.103"
DOMAIN="ackmud.com"
EMAIL="${CERTBOT_EMAIL:-admin@ackmud.com}"
WEBROOT="/var/www/certbot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # ~/web
WEB_USER="${SUDO_USER:-user}"
WEB_HOME="$(getent passwd "$WEB_USER" | cut -d: -f6)"
ACKTNG_MOUNT="$WEB_HOME/acktng"
NFS_EXPORT="${ACKTNG_HOST}:/home/user/acktng"

echo "==> Web container setup"
echo "    Repo:        $REPO_DIR"
echo "    Web user:    $WEB_USER  ($WEB_HOME)"
echo "    acktng NFS:  $NFS_EXPORT → $ACKTNG_MOUNT"
echo ""

# ── 1. Install packages ────────────────────────────────────────────────────────
echo "==> [1/7] Installing packages..."
apt-get update -y
apt-get install -y nginx certbot python3 nfs-common

# ── 2. Mount acktng game data via NFS ─────────────────────────────────────────
echo "==> [2/7] Mounting acktng data directory..."
mkdir -p "$ACKTNG_MOUNT"
chown "$WEB_USER:$WEB_USER" "$ACKTNG_MOUNT"

# Test that the NFS export is reachable before adding to fstab
if ! showmount -e "$ACKTNG_HOST" 2>/dev/null | grep -q "/home/user/acktng"; then
    echo ""
    echo "ERROR: NFS export $NFS_EXPORT is not visible from this host."
    echo "  Run  scripts/cleanup-acktng-web.sh --nfs-only  on $ACKTNG_HOST first."
    echo "  Aborting."
    exit 1
fi

# Add fstab entry if not already present
FSTAB_ENTRY="${NFS_EXPORT}  ${ACKTNG_MOUNT}  nfs  ro,hard,intr,_netdev  0  0"
if ! grep -qF "$NFS_EXPORT" /etc/fstab; then
    echo "$FSTAB_ENTRY" >> /etc/fstab
    echo "    Added NFS entry to /etc/fstab."
fi

mount "$ACKTNG_MOUNT" || true   # may already be mounted

if mountpoint -q "$ACKTNG_MOUNT"; then
    echo "    NFS mount OK: $ACKTNG_MOUNT"
else
    echo "ERROR: Failed to mount $NFS_EXPORT. Check NFS server and network."
    exit 1
fi

# ── 3. Create ACME webroot ─────────────────────────────────────────────────────
echo "==> [3/7] Preparing ACME webroot..."
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"
chmod 775 "$WEBROOT"

# ── 4. Bootstrap nginx for ACME challenge ─────────────────────────────────────
echo "==> [4/7] Installing bootstrap nginx config for certificate request..."
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

# ── 5. Obtain TLS certificate ──────────────────────────────────────────────────
echo "==> [5/7] Obtaining Let's Encrypt certificate..."
certbot certonly \
    --webroot \
    --webroot-path "$WEBROOT" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    -d "aha.$DOMAIN"

# Install only the nginx reload hook (no acktng restart hook — game servers
# are on the other host and no longer co-located with nginx).
install -m 755 "$REPO_DIR/scripts/certbot-post-renew.sh" \
    /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh

# Enable certbot auto-renewal
if systemctl list-units --type=timer 2>/dev/null | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
    echo "    certbot systemd timer enabled."
else
    CRON_LINE="0 0,12 * * * root certbot renew --quiet"
    CRON_FILE="/etc/cron.d/certbot-ackmud"
    echo "$CRON_LINE" > "$CRON_FILE"
    echo "    certbot cron job written to $CRON_FILE."
fi

# ── 6. Install full nginx config ───────────────────────────────────────────────
echo "==> [6/7] Installing full nginx config..."
cp "$REPO_DIR/nginx/ackmud.conf" /etc/nginx/sites-available/ackmud.conf
ln -sf /etc/nginx/sites-available/ackmud.conf \
        /etc/nginx/sites-enabled/ackmud.conf

rm -f /etc/nginx/sites-enabled/ackmud-bootstrap.conf \
      /etc/nginx/sites-available/ackmud-bootstrap.conf

nginx -t
systemctl reload nginx

# ── 7. Install and start Python web server ────────────────────────────────────
echo "==> [7/7] Installing Python web service..."
install -m 644 "$REPO_DIR/systemd/web-server.service" \
    /etc/systemd/system/web-server.service
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
echo "  Web server:  http://127.0.0.1:8081  (via nginx: https://$DOMAIN)"
echo "  acktng data: $ACKTNG_MOUNT  (NFS from $ACKTNG_HOST)"
echo "  Game API:    http://$ACKTNG_HOST:8080  (via ACKTNG_GAME_URL)"
echo ""
echo "Next steps:"
echo "  1. Test:  curl -k --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/"
echo "  2. Update the DEPLOY_HOST GitHub Actions secret to 192.168.1.113"
echo "  3. Re-point router port forwarding (80/443/9890/8891/8892) to 192.168.1.113"
echo "  4. Run  sudo bash scripts/cleanup-acktng-web.sh  on $ACKTNG_HOST"
