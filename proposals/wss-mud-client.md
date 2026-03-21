# Proposal: WSS (WebSocket Secure) Support for the ACKMUD Web Client

## Background

The ACKMUD web client (`/mud/`) connects to game servers using the browser's native WebSocket API. The client already contains protocol-detection logic that selects `wss://` when the page is loaded over HTTPS and `ws://` when loaded over HTTP:

```javascript
const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
return `${scheme}://${world.dataset.host}:${world.dataset.port}/`;
```

This means the **client-side code requires no changes**. The scheme is already chosen correctly. The gap is entirely on the server side.

## Problem

Modern browsers enforce the **mixed-content policy**: a page loaded over HTTPS is not permitted to open unencrypted (`ws://`) WebSocket connections. Any attempt is silently blocked before the TCP handshake even begins. This means that as soon as `ackmud.com` is served over HTTPS (or when a user accesses it via a browser that upgrades to HTTPS automatically), the MUD client becomes completely non-functional because all three game server endpoints (`ackmud.com:8890`, `:8891`, `:8892`) only accept plain unencrypted WebSocket connections.

The symptom visible to players is the error message already wired into the client:

```
[Error] WebSocket handshake failed for this endpoint.
```

## Goals

1. Players can connect to all three worlds (ACK!TNG, ACK! 4.3.1, ACK! 4.2) from an HTTPS-served page.
2. Connections are encrypted end-to-end between browser and game server.
3. The game server's internal MUD logic does not need to be rewritten.
4. The solution is maintainable and uses widely-understood tools.

## Recommended Architecture: TLS-Terminating Reverse Proxy

The cleanest solution is to place a reverse proxy in front of each WebSocket server. The proxy accepts inbound `wss://` connections from browsers (TLS-terminated at the proxy), then forwards plain WebSocket frames to the existing game server process listening on localhost. The game servers are unchanged.

```
Browser
  │  wss://ackmud.com:8890  (TLS, public)
  ▼
nginx / haproxy / stunnel      ← terminates TLS
  │  ws://127.0.0.1:8890      (plain, localhost only)
  ▼
ACK!TNG game server process
```

This is the standard pattern used by virtually every WebSocket-based service and requires no changes to the game code.

## Server-Side Implementation (acktng)

### Prerequisites

- A valid TLS certificate for `ackmud.com`. [Let's Encrypt](https://letsencrypt.org/) via `certbot` is free and auto-renewing. If the web server already has a certificate (which it must if the site is served over HTTPS), the same certificate and key files can be reused for the WebSocket proxy.
- `nginx` (preferred) or an equivalent reverse proxy installed on the host.
- The game server processes must listen on loopback (`127.0.0.1`) rather than `0.0.0.0` after this change, so that unencrypted access from the public internet is no longer possible.

---

### Option A — nginx (Recommended)

Add a `server` block for each game port. The three worlds map to ports `8890`, `8891`, and `8892`.

```nginx
# /etc/nginx/conf.d/ackmud-wss.conf

# ACK!TNG  — wss://ackmud.com:8890
server {
    listen 8890 ssl;
    server_name ackmud.com;

    ssl_certificate     /etc/letsencrypt/live/ackmud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ackmud.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass          http://127.0.0.1:18890;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade    $http_upgrade;
        proxy_set_header    Connection "upgrade";
        proxy_set_header    Host       $host;
        proxy_read_timeout  3600s;   # keep idle MUD sessions alive
        proxy_send_timeout  3600s;
    }
}

# ACK! 4.3.1 — wss://ackmud.com:8891
server {
    listen 8891 ssl;
    server_name ackmud.com;

    ssl_certificate     /etc/letsencrypt/live/ackmud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ackmud.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass          http://127.0.0.1:18891;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade    $http_upgrade;
        proxy_set_header    Connection "upgrade";
        proxy_set_header    Host       $host;
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}

# ACK! 4.2  — wss://ackmud.com:8892
server {
    listen 8892 ssl;
    server_name ackmud.com;

    ssl_certificate     /etc/letsencrypt/live/ackmud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ackmud.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass          http://127.0.0.1:18892;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade    $http_upgrade;
        proxy_set_header    Connection "upgrade";
        proxy_set_header    Host       $host;
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
```

Key points:

- nginx listens on the **same public ports** (`8890`, `8891`, `8892`) that the web client already targets, so no changes to `WORLD_TARGETS` in `web_who_server.py` are needed.
- The game server processes are moved to private ports (`18890`, `18891`, `18892`) on loopback. The `18xxx` offset is a convention; any available private port works.
- `proxy_read_timeout` and `proxy_send_timeout` are set to one hour so that idle players are not dropped by the proxy before the game's own idle-kick logic fires.
- The `Upgrade` and `Connection` headers are required by the WebSocket protocol for the HTTP→WebSocket upgrade handshake.

Reload nginx after editing:

```bash
sudo nginx -t          # validate config
sudo systemctl reload nginx
```

---

### Option B — stunnel (Simpler, no HTTP involvement)

`stunnel` is a lightweight TLS wrapper that requires no knowledge of HTTP. It wraps any TCP stream in TLS, making it ideal for bridging a plain WebSocket server to a TLS-speaking port.

```ini
# /etc/stunnel/ackmud.conf

[acktng]
accept  = 8890
connect = 127.0.0.1:18890
cert    = /etc/letsencrypt/live/ackmud.com/fullchain.pem
key     = /etc/letsencrypt/live/ackmud.com/privkey.pem

[ack431]
accept  = 8891
connect = 127.0.0.1:18891
cert    = /etc/letsencrypt/live/ackmud.com/fullchain.pem
key     = /etc/letsencrypt/live/ackmud.com/privkey.pem

[ack42]
accept  = 8892
connect = 127.0.0.1:18892
cert    = /etc/letsencrypt/live/ackmud.com/fullchain.pem
key     = /etc/letsencrypt/live/ackmud.com/privkey.pem
```

stunnel operates at the TCP layer — it is completely transparent to the WebSocket protocol. The browser negotiates TLS with stunnel, and stunnel pipes the decrypted bytes to the game server exactly as if the browser had connected directly. No HTTP proxy headers are injected.

**Trade-off vs. nginx**: stunnel is simpler to configure but provides no HTTP-level features (routing, logging, rate-limiting). nginx is preferable if the host already runs it for the web site.

---

### Game Server Process Changes

Regardless of which proxy option is chosen, the game server processes must be reconfigured to:

1. **Bind to loopback only** (`127.0.0.1` / `::1`), not `0.0.0.0`. This prevents browsers (or anyone) from bypassing TLS by connecting directly to the inner port.
2. **Listen on the new private port** (`18890`, `18891`, `18892` in the examples above — the actual values just need to match the proxy config).

If the game servers are already binding to all interfaces via a configurable address, update that setting. If the bind address is hardcoded, a one-line change is required. The WebSocket framing, message format, and all game logic remain completely unchanged.

Example — if the WebSocket server is Python using `websockets`:

```python
# Before
await websockets.serve(handler, "0.0.0.0", 8890)

# After
await websockets.serve(handler, "127.0.0.1", 18890)
```

---

### Firewall Rules

After the proxy is in place, the inner ports (`18890`–`18892`) should be blocked at the firewall so they are not reachable from outside the host:

```bash
# iptables example
sudo iptables -A INPUT -p tcp --dport 18890 ! -s 127.0.0.1 -j DROP
sudo iptables -A INPUT -p tcp --dport 18891 ! -s 127.0.0.1 -j DROP
sudo iptables -A INPUT -p tcp --dport 18892 ! -s 127.0.0.1 -j DROP
```

The public-facing ports (`8890`, `8891`, `8892`) remain open so the proxy can accept connections.

---

### TLS Certificate Renewal

Let's Encrypt certificates expire every 90 days. `certbot` installs a cron job or systemd timer that handles renewal automatically. However, nginx and stunnel must reload after a renewal to pick up the new certificate files. Add a post-renewal hook:

```bash
# /etc/letsencrypt/renewal-hooks/deploy/reload-ackmud-proxy.sh
#!/bin/bash
systemctl reload nginx   # or: killall -HUP stunnel4
```

```bash
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-ackmud-proxy.sh
```

---

## Client-Side Changes (web_who_server.py / mud_client.html)

**None are required.** The client already selects `wss://` on HTTPS pages. The `WORLD_TARGETS` configuration in `web_who_server.py` already points to the correct ports, so no configuration change is needed on the web server side either.

The only scenario that would require a client change is if the proxy must use different port numbers than the ones currently configured (e.g. standard HTTPS port 443 with path-based routing). If that path is chosen, `WORLD_TARGETS` would need a `ws` key per world pointing to the new URL, which `mud_client.html` already supports via `world.dataset.ws`.

---

## Testing

After the proxy is deployed:

1. Open `https://ackmud.com/mud/` in a browser.
2. Open the browser's developer tools → Network tab → filter by "WS".
3. Click **Connect** for ACK!TNG. The network tab should show a `wss://ackmud.com:8890/` connection with status **101 Switching Protocols** and the TLS lock icon.
4. Type a command (e.g. `look`) and confirm the game responds.
5. Repeat for ACK! 4.3.1 (`:8891`) and ACK! 4.2 (`:8892`).

A quick command-line sanity check before opening the browser:

```bash
# Should print the WebSocket upgrade response headers
openssl s_client -connect ackmud.com:8890 -quiet 2>/dev/null <<'EOF'
GET / HTTP/1.1
Host: ackmud.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

EOF
```

A `HTTP/1.1 101 Switching Protocols` line in the response confirms WSS is working.

---

## Summary

| Component | Change required |
|---|---|
| `mud_client.html` | None — `wss://` already selected on HTTPS |
| `web_who_server.py` | None — ports in `WORLD_TARGETS` unchanged |
| acktng game server bind address | Change from `0.0.0.0:8890–8892` to `127.0.0.1:18890–18892` |
| TLS proxy (nginx or stunnel) | Add and configure — listens on `8890–8892`, forwards to `18890–18892` |
| Firewall | Block `18890–18892` from external traffic |
| TLS certificate | Reuse existing cert; add post-renewal reload hook |
