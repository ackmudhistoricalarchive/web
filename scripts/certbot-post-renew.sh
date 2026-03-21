#!/usr/bin/env bash
# certbot post-renewal hook: reload nginx after certificate renewal.
#
# Install (run once as root):
#   sudo cp scripts/certbot-post-renew.sh /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh
#   sudo chmod +x /etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh
#
# certbot calls all scripts in /etc/letsencrypt/renewal-hooks/post/ after
# a successful renewal.  nginx must reload to pick up the new certificate.

set -euo pipefail

systemctl reload nginx
