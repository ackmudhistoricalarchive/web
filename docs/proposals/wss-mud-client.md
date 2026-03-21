# Proposal: WSS (WebSocket Secure) Support for the ACKMUD Web Client

## Background

The ACKMUD web client (`/mud/`) connects to game servers using the browser's native WebSocket API. The client already contains protocol-detection logic that selects `wss://` when the page is loaded over HTTPS and `ws://` when loaded over HTTP:

```javascript
const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
return `${scheme}://${world.dataset.host}:${world.dataset.port}/`;
```

This means the **client-side code requires no protocol-selection changes**. The scheme is already chosen correctly based on page security context.

## Problem

Modern browsers enforce the **mixed-content policy**: a page loaded over HTTPS is not permitted to open unencrypted (`ws://`) WebSocket connections. Any attempt is silently blocked before the TCP handshake even begins. This means that as soon as `ackmud.com` is served over HTTPS (or when a user accesses it via a browser that upgrades to HTTPS automatically), the MUD client becomes completely non-functional because all three game server endpoints (`ackmud.com:9890`, `:8891`, `:8892`) only accept plain unencrypted WebSocket connections.

The client now displays a targeted error message in this case:

```
[Error] WSS connection failed. The server does not appear to support
        secure WebSocket (wss://) on this endpoint yet.
[Info]  The server admin needs to set up a TLS proxy in front of the game server.
```

## Goals

1. Players can connect to all three worlds (ACK!TNG, ACK! 4.3.1, ACK! 4.2) from an HTTPS-served page.
2. Connections are encrypted end-to-end between the browser and the game server.
3. The game server's internal MUD logic does not need to be rewritten.
4. The solution is maintainable and uses widely-understood tools.

## Client-Side Changes (already implemented)

| File | Change |
|---|---|
| `templates/mud_client.html` | Connected status now shows `[WSS]` or `[WS]` tag |
| `templates/mud_client.html` | WSS-specific error message when secure handshake fails |
| `web_who_server.py` | None — ports in `WORLD_TARGETS` unchanged |

The `WORLD_TARGETS` in `web_who_server.py` point to the same public ports (`9890`, `8891`, `8892`) that the proxy will occupy, so no server configuration change is needed on the web side.

---

## WebSocket Protocol Reference

This section documents exactly what the game server's WebSocket endpoint must speak so that the client can interoperate with it. The server implementor must ensure these semantics are preserved after adding the TLS proxy layer.

### Endpoint

| World | Public URL (after WSS) | Internal (pre-proxy) |
|---|---|---|
| ACK!TNG | `wss://ackmud.com:9890/` | `ws://127.0.0.1:19890/` |
| ACK! 4.3.1 | `wss://ackmud.com:8891/` | `ws://127.0.0.1:18891/` |
| ACK! 4.2 | `wss://ackmud.com:8892/` | `ws://127.0.0.1:18892/` |

- **Path**: `/` (the client always connects to the root path).
- **WebSocket version**: 13 (RFC 6455).
- **Subprotocols**: none — the client does not send a `Sec-WebSocket-Protocol` header.

### Frame Types

| Direction | Frame type | Encoding |
|---|---|---|
| Client → Server | Text | UTF-8 |
| Server → Client | Text | UTF-8 |

Binary frames must not be sent by the server. The client logs `[Binary message received]` and discards them.

### Client → Server: Player Commands

The client sends one text frame per player command. Each frame is the raw command string followed by a Unix newline:

```
look\n
north\n
say Hello everyone!\n
```

- Commands are single-line; no multi-line frames are sent.
- The newline (`\n`, `0x0A`) is always appended — the server must strip it before passing the command to the MUD parser.
- An empty frame (`\n`) may be sent if the player hits Enter with nothing typed; the server should handle this gracefully (treat it as a no-op or a blank line, matching standard MUD telnet behaviour).

### Server → Client: Game Output (Text Frames)

The server sends game output as UTF-8 text frames. Frames may be of any length; the client appends each frame's content directly to the output buffer.

**ANSI colour codes** are supported and rendered by the client:

```
\x1b[32mYou see a dark forest.\x1b[0m\n
```

Supported SGR codes:

| Code(s) | Effect |
|---|---|
| `0` | Reset all attributes |
| `1` | Bold |
| `22` | Bold off |
| `4` | Underline |
| `24` | Underline off |
| `30–37` | Standard foreground colours |
| `90–97` | Bright foreground colours |
| `40–47` | Standard background colours (code − 10 mapping) |
| `39` | Default foreground |
| `49` | Default background |

Unsupported SGR codes are silently ignored by the client parser.

### Server → Client: JSON Extension Messages

If the server sends a text frame whose first character is `{`, the client attempts to parse it as JSON. Unrecognised or malformed JSON is treated as plain text output.

Currently one extension type is defined:

#### Music command

```json
{"type": "music", "action": "play", "url": "https://ackmud.com/web/mp3/somefile.mp3"}
```

```json
{"type": "music", "action": "stop"}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"music"` | Identifies this as a music control message |
| `action` | `"play"` \| `"stop"` | What to do |
| `url` | string (play only) | Absolute URL of the MP3 to play |

Behaviour:
- `play` — If no track is playing, starts the track immediately at the user's current volume setting. If a different track is already playing, crossfades over 2 seconds. If the same track URL is already playing, the message is ignored.
- `stop` — Fades out the current track over 2 seconds and stops playback.
- The music control UI (play/stop/volume/loop) is hidden until the first `play` message is received.

Music URLs must be absolute and reachable from the user's browser. Relative URLs will not work. The `/web/mp3/` path is served by the `web_who_server.py` instance on the same host.

### Connection Lifetime

MUD sessions are long-lived — players routinely remain connected for hours. The server must not impose a short idle timeout. The proxy layer (see below) is configured with a one-hour timeout for the same reason.

The server should send a WebSocket `ping` frame at a reasonable interval (e.g. every 60 seconds) to keep the connection alive through NAT gateways and load balancers. The browser's WebSocket implementation responds with a `pong` automatically; the server does not need to do anything special to handle the pong.

### Disconnection

When the game session ends (player quits, is kicked, or server shuts down) the server should close the WebSocket connection with a standard close frame:

- Code `1000` (Normal Closure) for a clean logout.
- Code `1001` (Going Away) for a server shutdown/restart.

The client displays:

```
[Disconnected] code=1000 reason=none
```

---

## Recommended Architecture: TLS-Terminating Reverse Proxy

The cleanest solution is to place a reverse proxy in front of each WebSocket server. The proxy accepts inbound `wss://` connections from browsers (TLS-terminated at the proxy), then forwards plain WebSocket frames to the existing game server process on loopback. The game servers are unchanged except for their bind address.

```
Browser
  │  wss://ackmud.com:9890  (TLS, public internet)
  ▼
nginx / stunnel                ← terminates TLS, same host as game server
  │  ws://127.0.0.1:19890     (plain WebSocket, loopback only)
  ▼
ACK!TNG game server process
```

---

## Server-Side Implementation (acktng)

### Prerequisites

- A valid TLS certificate for `ackmud.com`. [Let's Encrypt](https://letsencrypt.org/) via `certbot` is free and auto-renewing. If the web server already has a certificate for HTTPS, the **same certificate and key files can be reused** for the WebSocket proxy — no separate certificate is needed.
- `nginx` (preferred) or `stunnel` installed on the game server host.
- Firewall access to open ports `9890`, `8891`, `8892` for inbound TCP if not already open.

---

### Step 1 — Move the game server processes to loopback

Each game server process must stop binding to `0.0.0.0` (all interfaces) and instead bind to `127.0.0.1` on a new private port. This prevents anyone from bypassing TLS by connecting directly to the inner port.

Suggested port mapping:

| World | Current public port | New internal port |
|---|---|---|
| ACK!TNG | 9890 | 19890 |
| ACK! 4.3.1 | 8891 | 18891 |
| ACK! 4.2 | 8892 | 18892 |

The `18xxx` offset is a convention; any available unprivileged port works as long as it matches the proxy config.

Example change if the WebSocket server is Python (`websockets` library):

```python
# Before
await websockets.serve(handler, "0.0.0.0", 9890)

# After
await websockets.serve(handler, "127.0.0.1", 19890)
```

**The WebSocket handler itself, the MUD game logic, and the message protocol do not change.**

---

### Step 2 — Configure the TLS proxy

#### Option A — nginx (Recommended)

nginx is the preferred option if it is already installed for the HTTPS web server, since the existing TLS configuration and certificates can be reused directly.

```nginx
# /etc/nginx/conf.d/ackmud-wss.conf

# ── ACK!TNG  — wss://ackmud.com:9890 ──────────────────────────────────────
server {
    listen      9890 ssl;
    server_name ackmud.com;

    ssl_certificate     /etc/letsencrypt/live/ackmud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ackmud.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass           http://127.0.0.1:19890;
        proxy_http_version   1.1;

        # Required for WebSocket upgrade handshake
        proxy_set_header     Upgrade    $http_upgrade;
        proxy_set_header     Connection "upgrade";
        proxy_set_header     Host       $host;

        # Allow idle MUD sessions to stay open for up to one hour.
        # Without this nginx defaults to 60 s and drops long idle connections.
        proxy_read_timeout   3600s;
        proxy_send_timeout   3600s;
    }
}

# ── ACK! 4.3.1 — wss://ackmud.com:8891 ────────────────────────────────────
server {
    listen      8891 ssl;
    server_name ackmud.com;

    ssl_certificate     /etc/letsencrypt/live/ackmud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ackmud.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass           http://127.0.0.1:18891;
        proxy_http_version   1.1;
        proxy_set_header     Upgrade    $http_upgrade;
        proxy_set_header     Connection "upgrade";
        proxy_set_header     Host       $host;
        proxy_read_timeout   3600s;
        proxy_send_timeout   3600s;
    }
}

# ── ACK! 4.2  — wss://ackmud.com:8892 ─────────────────────────────────────
server {
    listen      8892 ssl;
    server_name ackmud.com;

    ssl_certificate     /etc/letsencrypt/live/ackmud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ackmud.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass           http://127.0.0.1:18892;
        proxy_http_version   1.1;
        proxy_set_header     Upgrade    $http_upgrade;
        proxy_set_header     Connection "upgrade";
        proxy_set_header     Host       $host;
        proxy_read_timeout   3600s;
        proxy_send_timeout   3600s;
    }
}
```

Notes:
- nginx listens on the **same public ports** (`9890`, `8891`, `8892`) the web client already targets — no config changes needed on the web server side.
- `proxy_http_version 1.1` is mandatory; WebSocket upgrade does not work over HTTP/1.0.
- `Upgrade` and `Connection` headers are required for the HTTP→WebSocket upgrade handshake per RFC 6455 §4.
- `proxy_read_timeout` / `proxy_send_timeout` are set to one hour so players are not dropped by the proxy before the game's own idle-kick logic fires.

Validate and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

#### Option B — stunnel (Simpler)

`stunnel` is a lightweight TLS wrapper that requires no HTTP knowledge. It wraps any TCP stream in TLS, making it a one-to-one drop-in for adding TLS to the WebSocket ports. It operates at the TCP layer so it is completely transparent to the WebSocket protocol — no headers are modified.

```ini
# /etc/stunnel/ackmud.conf
[acktng]
accept  = 9890
connect = 127.0.0.1:19890
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

**Trade-off vs. nginx**: stunnel is simpler to configure but provides no HTTP-level features (logging, rate-limiting, routing). Choose nginx if it is already running for the web server.

---

### Step 3 — Block the inner ports at the firewall

After the proxy is in place, the inner ports (`19890`, `18891`, `18892`) must be blocked from the internet so unencrypted access is impossible:

```bash
# iptables
sudo iptables -A INPUT -p tcp --dport 19890 ! -s 127.0.0.1 -j DROP
sudo iptables -A INPUT -p tcp --dport 18891 ! -s 127.0.0.1 -j DROP
sudo iptables -A INPUT -p tcp --dport 18892 ! -s 127.0.0.1 -j DROP

# Persist (Debian/Ubuntu)
sudo iptables-save > /etc/iptables/rules.v4
```

The public-facing ports (`9890`, `8891`, `8892`) remain open.

---

### Step 4 — TLS Certificate Auto-Renewal Hook

Let's Encrypt certificates expire every 90 days. `certbot` handles renewal automatically but nginx/stunnel must reload afterwards to serve the new certificate. Add a post-renewal deploy hook:

```bash
# /etc/letsencrypt/renewal-hooks/deploy/reload-ackmud-wss.sh
#!/bin/bash
systemctl reload nginx
# If using stunnel instead: systemctl restart stunnel4
```

```bash
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-ackmud-wss.sh
```

Test that renewal simulation triggers the hook:

```bash
sudo certbot renew --dry-run
```

---

## Testing

### Command-line verification

Confirm TLS and the WebSocket upgrade work before opening a browser:

```bash
# Should print HTTP/1.1 101 Switching Protocols, confirming WSS is up
openssl s_client -connect ackmud.com:9890 -quiet 2>/dev/null <<'EOF'
GET / HTTP/1.1
Host: ackmud.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

EOF
```

Repeat for ports `8891` and `8892`.

Verify the inner ports are not reachable from outside the host:

```bash
# Should time out or refuse — NOT succeed
nc -zv ackmud.com 19890
```

### Browser verification

1. Open `https://ackmud.com/mud/`.
2. Open DevTools → Network → filter **WS**.
3. Click **Connect** for ACK!TNG. The request should show:
   - URL: `wss://ackmud.com:9890/`
   - Status: `101 Switching Protocols`
   - A padlock icon (TLS confirmed by browser)
4. The client output panel should show `[Connected] ACK!TNG (ackmud.com:9890) [WSS]`.
5. Type `look` and confirm the game responds with ANSI-coloured room text.
6. Repeat for ACK! 4.3.1 (`:8891`) and ACK! 4.2 (`:8892`).

---

## Summary

| Component | Required change |
|---|---|
| `mud_client.html` | None to protocol logic; `[WSS]`/`[WS]` tag and better error messages added |
| `web_who_server.py` | None — ports in `WORLD_TARGETS` unchanged |
| Game server bind address | `0.0.0.0:9890, 8891, 8892` → `127.0.0.1:19890, 18891, 18892` |
| TLS proxy (nginx or stunnel) | Add and configure — listens on `9890, 8891, 8892`, proxies to `19890, 18891, 18892` |
| Firewall | Block `19890`, `18891`, `18892` from external traffic |
| TLS certificate | Reuse existing cert; add post-renewal reload hook |
