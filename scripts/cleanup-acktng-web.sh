#!/usr/bin/env bash
# Cleanup script for the acktng host (192.168.1.103).
#
# Removes the web server and all associated software (nginx, certbot,
# web-server systemd service, TLS certificates, ~/web) from the acktng host.
# Run this after the new web container (192.168.1.113) is verified and live.
#
# Run as root (or with sudo) on 192.168.1.103:
#   sudo bash ~/web/scripts/cleanup-acktng-web.sh

set -euo pipefail

WEB_USER="${SUDO_USER:-user}"
WEB_HOME="$(getent passwd "$WEB_USER" | cut -d: -f6)"

echo "==> acktng web cleanup"
echo "    Web user: $WEB_USER  ($WEB_HOME)"
echo ""
echo "WARNING: This will permanently remove nginx, certbot, the web-server"
echo "         systemd service, TLS certificates, and ~/web from this host."
echo ""
read -r -p "Continue? [y/N] " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
    echo "Aborted."
    exit 0
fi

# ── 1. Stop and disable Python web server ─────────────────────────────────────
echo ""
echo "==> [1/4] Removing web-server systemd service..."
systemctl stop web-server   2>/dev/null || true
systemctl disable web-server 2>/dev/null || true
rm -f /etc/systemd/system/web-server.service
systemctl daemon-reload
echo "    Done."

# ── 2. Remove nginx ────────────────────────────────────────────────────────────
echo "==> [2/4] Removing nginx..."
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true

rm -f /etc/nginx/sites-enabled/ackmud.conf \
      /etc/nginx/sites-available/ackmud.conf \
      /etc/nginx/sites-enabled/ackmud-bootstrap.conf \
      /etc/nginx/sites-available/ackmud-bootstrap.conf \
      /etc/nginx/conf.d/ackmud-wss.conf

apt-get remove -y --purge nginx nginx-core nginx-common nginx-full 2>/dev/null || true
apt-get autoremove -y

rm -rf /var/www/certbot
echo "    Done."

# ── 3. Remove certbot and TLS certificates ────────────────────────────────────
echo "==> [3/4] Removing certbot and TLS certificates..."
systemctl stop certbot.timer   2>/dev/null || true
systemctl disable certbot.timer 2>/dev/null || true
rm -f /etc/cron.d/certbot-ackmud
rm -f /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh \
      /etc/letsencrypt/renewal-hooks/post/acktng-restart.sh
rm -rf /etc/letsencrypt

apt-get remove -y --purge certbot 2>/dev/null || true
apt-get autoremove -y
echo "    Done."

# ── 4. Remove ~/web repository ────────────────────────────────────────────────
echo "==> [4/4] Removing ~/web directory..."
WEB_DIR="$WEB_HOME/web"
if [[ -d "$WEB_DIR" ]]; then
    rm -rf "$WEB_DIR"
    echo "    Removed $WEB_DIR."
else
    echo "    $WEB_DIR not found, skipping."
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "Cleanup complete."
echo "  Removed: nginx, certbot, /etc/letsencrypt, web-server.service, ~/web"
echo "  Retained: MUD game servers and API on ports 8080/18890/18891/18892"
