#!/usr/bin/env bash
# certbot post-renewal hook: restart acktng MUD server processes after renewal.
#
# acktng lives at ~/acktng on the server and runs under the auto-restart loop
# at ~/acktng/scripts/startup, not as a systemd service.  Killing the ack
# binary causes the loop to respawn it, picking up the renewed certificate that
# nginx now serves on ports 9890, 8891, and 8892.
#
# Install (run once as root):
#   sudo cp scripts/certbot-post-renew-acktng.sh \
#       /etc/letsencrypt/renewal-hooks/post/acktng-restart.sh
#   sudo chmod +x /etc/letsencrypt/renewal-hooks/post/acktng-restart.sh
#
# certbot calls every script in /etc/letsencrypt/renewal-hooks/post/ after a
# successful renewal.  This hook complements certbot-post-renew.sh (which
# reloads nginx); install both.

set -euo pipefail

# nginx reloads its TLS context on SIGHUP, so the MUD servers themselves do not
# need direct cert access — they connect to nginx's local proxy.  We restart
# them anyway so any in-process TLS state is refreshed cleanly.
if pkill -0 ack 2>/dev/null; then
    pkill -TERM ack || true
    echo "Sent SIGTERM to ack; the startup loop will respawn it."
else
    echo "ack process not found; nothing to restart."
fi
