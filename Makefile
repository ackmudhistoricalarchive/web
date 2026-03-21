.PHONY: all clean test nginx-install nginx-reload certbot-acktng

SERVICE ?= ackmud-web

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

clean:
	@:
