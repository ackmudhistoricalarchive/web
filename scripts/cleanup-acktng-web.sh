#!/usr/bin/env bash
# Cleanup script for the acktng host (192.168.1.103).
#
# Removes the web server and all associated software (nginx, certbot, web-server
# systemd service, TLS certificates, ~/web) from the acktng host, and sets up
# an NFS export of /home/user/acktng so the new web container (192.168.1.113)
# can continue to serve the help/shelp/lore reference pages.
#
# Run as root (or with sudo) on 192.168.1.103:
#   sudo bash ~/web/scripts/cleanup-acktng-web.sh
#
# To set up only the NFS export without removing anything (e.g. before the
# new container is ready), pass --nfs-only:
#   sudo bash ~/web/scripts/cleanup-acktng-web.sh --nfs-only

set -euo pipefail

WEB_CONTAINER="192.168.1.113"
WEB_USER="${SUDO_USER:-user}"
WEB_HOME="$(getent passwd "$WEB_USER" | cut -d: -f6)"
NFS_EXPORT_PATH="/home/user/acktng"
NFS_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --nfs-only) NFS_ONLY=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

echo "==> acktng web cleanup"
echo "    Web user:       $WEB_USER  ($WEB_HOME)"
echo "    Web container:  $WEB_CONTAINER"
echo "    NFS export:     $NFS_EXPORT_PATH → $WEB_CONTAINER (read-only)"
echo "    NFS only:       $NFS_ONLY"
echo ""

# ── NFS export setup ───────────────────────────────────────────────────────────
echo "==> [NFS] Setting up NFS export of $NFS_EXPORT_PATH..."
apt-get install -y nfs-kernel-server

# Add export entry if not already present
EXPORTS_ENTRY="${NFS_EXPORT_PATH}  ${WEB_CONTAINER}(ro,no_subtree_check,no_root_squash)"
if ! grep -qF "$NFS_EXPORT_PATH" /etc/exports; then
    echo "$EXPORTS_ENTRY" >> /etc/exports
    echo "    Added export to /etc/exports."
else
    echo "    Export already present in /etc/exports."
fi

exportfs -ra
systemctl enable --now nfs-kernel-server
echo "    NFS export active: $NFS_EXPORT_PATH → $WEB_CONTAINER"

if $NFS_ONLY; then
    echo ""
    echo "NFS export configured. Exiting without removing web server."
    echo "Run this script without --nfs-only once the new container is verified."
    exit 0
fi

# ── Confirmation ───────────────────────────────────────────────────────────────
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
echo "==> [1/5] Removing web-server systemd service..."
if systemctl is-active --quiet web-server 2>/dev/null; then
    systemctl stop web-server
    echo "    Stopped web-server.service."
fi
if systemctl is-enabled --quiet web-server 2>/dev/null; then
    systemctl disable web-server
fi
if [[ -f /etc/systemd/system/web-server.service ]]; then
    rm -f /etc/systemd/system/web-server.service
    echo "    Removed /etc/systemd/system/web-server.service."
fi
systemctl daemon-reload

# ── 2. Remove nginx ────────────────────────────────────────────────────────────
echo "==> [2/5] Removing nginx..."
if systemctl is-active --quiet nginx 2>/dev/null; then
    systemctl stop nginx
fi
systemctl disable nginx 2>/dev/null || true

# Remove ackmud-specific nginx configs
for conf in ackmud.conf ackmud-bootstrap.conf ackmud-wss.conf; do
    rm -f "/etc/nginx/sites-enabled/$conf" "/etc/nginx/sites-available/$conf"
    rm -f "/etc/nginx/conf.d/$conf"
done

apt-get remove -y nginx nginx-core nginx-common 2>/dev/null || \
    apt-get remove -y nginx 2>/dev/null || true
apt-get autoremove -y

# Remove ACME webroot
rm -rf /var/www/certbot
echo "    nginx removed."

# ── 3. Remove certbot and TLS certificates ────────────────────────────────────
echo "==> [3/5] Removing certbot and TLS certificates..."

# Remove renewal hooks installed by this repo
rm -f /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh
rm -f /etc/letsencrypt/renewal-hooks/post/acktng-restart.sh

# Stop and disable certbot timer/cron
systemctl stop certbot.timer  2>/dev/null || true
systemctl disable certbot.timer 2>/dev/null || true
rm -f /etc/cron.d/certbot-ackmud

# Remove certificates and certbot config
rm -rf /etc/letsencrypt

# Remove certbot package
apt-get remove -y certbot 2>/dev/null || true
apt-get autoremove -y
echo "    certbot and certificates removed."

# ── 4. Remove ~/web repository ────────────────────────────────────────────────
echo "==> [4/5] Removing ~/web directory..."
WEB_DIR="$WEB_HOME/web"
if [[ -d "$WEB_DIR" ]]; then
    rm -rf "$WEB_DIR"
    echo "    Removed $WEB_DIR."
else
    echo "    $WEB_DIR not found, skipping."
fi

# ── 5. Firewall: close web ports (optional, best-effort) ──────────────────────
echo "==> [5/5] Closing web-related firewall ports (if ufw is active)..."
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    ufw delete allow 80/tcp  2>/dev/null || true
    ufw delete allow 443/tcp 2>/dev/null || true
    ufw delete allow 9890/tcp 2>/dev/null || true
    ufw delete allow 8891/tcp 2>/dev/null || true
    ufw delete allow 8892/tcp 2>/dev/null || true
    echo "    Closed ports 80, 443, 9890, 8891, 8892."
else
    echo "    ufw not active; skipping firewall changes."
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "Cleanup complete."
echo ""
echo "  Removed:  nginx, certbot, web-server.service, ~/web, /etc/letsencrypt"
echo "  Retained: MUD game servers, NFS export of $NFS_EXPORT_PATH"
echo ""
echo "  Verify NFS from the web container (192.168.1.113):"
echo "    showmount -e 192.168.1.103"
echo "    mount 192.168.1.103:$NFS_EXPORT_PATH /home/user/acktng"
