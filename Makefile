.PHONY: all clean test nginx-install nginx-reload certbot-acktng service-install renewal-hooks-install

REPO_DIR := $(shell pwd)

SERVICE ?= web-server

# The Python app listens on 8080; nginx proxies port 80/443 to it.
export ACK_WEB_PORT ?= 8080

all:
	systemctl restart $(SERVICE)

test:
	python3 test_integration.py

# Copy the nginx site config and reload nginx.
nginx-install:
	sudo cp nginx/ackmud.conf /etc/nginx/sites-available/ackmud.conf
	sudo ln -sf /etc/nginx/sites-available/ackmud.conf /etc/nginx/sites-enabled/ackmud.conf
	sudo nginx -t
	sudo systemctl reload nginx

# Reload nginx (e.g. after a manual cert renewal or config edit).
nginx-reload:
	sudo nginx -t
	sudo systemctl reload nginx

# Obtain/renew the ackmud.com certificate using the nginx-served ACME webroot.
# nginx must already be running with the ackmud.conf config before calling this.
# acktng can run this target from its own deploy to certbot independently.
certbot-acktng:
	sudo certbot certonly \
		--webroot \
		--webroot-path /var/www/certbot \
		--non-interactive \
		--agree-tos \
		--email "${CERTBOT_EMAIL:-admin@ackmud.com}" \
		-d ackmud.com \
		-d www.ackmud.com

# Install certbot post-renewal hooks so nginx reloads after every cert renewal.
renewal-hooks-install:
	sudo mkdir -p /etc/letsencrypt/renewal-hooks/post
	sudo cp scripts/certbot-post-renew.sh \
		/etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh
	sudo chmod +x \
		/etc/letsencrypt/renewal-hooks/post/ackmud-reload-nginx.sh
	sudo cp scripts/certbot-post-renew-acktng.sh \
		/etc/letsencrypt/renewal-hooks/post/acktng-restart.sh
	sudo chmod +x \
		/etc/letsencrypt/renewal-hooks/post/acktng-restart.sh
	@echo "Renewal hooks installed. Test with: sudo certbot renew --dry-run"

# Install and enable the Python web server systemd service, then start it.
# Uses the actual repo location (REPO_DIR) so the service works regardless of
# where the repo is checked out.
service-install:
	sed 's|/home/user/web|$(REPO_DIR)|g' systemd/web-server.service \
		| sudo tee /etc/systemd/system/web-server.service > /dev/null
	sudo systemctl daemon-reload
	sudo systemctl enable web-server
	sudo systemctl restart web-server

clean:
	@:
