# Proposal: Migrate Web Server to Dedicated Container

**Date:** 2026-03-22
**Branch:** `claude/migrate-web-server-container-7F8Ta`
**Status:** Proposed

## Summary

Move the Python web server (`web_who_server.py`) and its nginx reverse proxy
off the `acktng` game server host (192.168.1.103) onto a dedicated container
at 192.168.1.113. Clean up all web-related software from 192.168.1.103 so it
runs only MUD game processes.

The `/reference/help`, `/reference/shelp`, and `/reference/lore` routes are
out of scope — they will be served via a separate db-service REST API in a
future migration. All other routes, including live game data (`/gsgp`, `/who`),
continue to work by calling the game API on 192.168.1.103 over the LAN.

---

## Architecture

### Before

```
192.168.1.103 (acktng)
├── nginx (ports 80, 443, 9890, 8891, 8892)
│   ├── HTTP → HTTPS redirect
│   ├── HTTPS reverse proxy → Python app (127.0.0.1:8080)
│   └── WSS proxies → game servers (127.0.0.1:18890/18891/18892)
├── Python web server (port 8080, systemd: web-server.service)
│   └── game API calls → http://localhost:8080/gsgp, /who
└── MUD game servers + API (ports 8080, 18890, 18891, 18892)
```

### After

```
192.168.1.103 (acktng)
└── MUD game servers + API (ports 8080, 18890, 18891, 18892)  ← unchanged

192.168.1.113 (web container)
├── nginx (ports 80, 443, 9890, 8891, 8892)
│   ├── HTTP → HTTPS redirect + ACME webroot
│   ├── HTTPS reverse proxy → Python app (127.0.0.1:8080)
│   └── WSS proxies → game servers (192.168.1.103:18890/18891/18892)
├── Python web server (port 8080, systemd: web-server.service)
│   └── game API calls → http://192.168.1.103:8080/gsgp, /who
└── certbot + Let's Encrypt certs
```

---

## Changes Required

### 1. `nginx/ackmud.conf` — WSS backend IPs
WSS proxy blocks change from `127.0.0.1` to `192.168.1.103`:

| Port | Before | After |
|------|--------|-------|
| 9890 | `http://127.0.0.1:18890` | `http://192.168.1.103:18890` |
| 8891 | `http://127.0.0.1:18891` | `http://192.168.1.103:18891` |
| 8892 | `http://127.0.0.1:18892` | `http://192.168.1.103:18892` |

HTTP/HTTPS proxy blocks are unchanged (still `http://127.0.0.1:8080`).

### 2. `systemd/web-server.service` — `ACKTNG_GAME_URL`
Set the game API URL to the acktng host so `/gsgp` and `/who` work over LAN:

```ini
Environment=ACKTNG_GAME_URL=http://192.168.1.103:8080
```

### 3. CI/CD — GitHub Actions secret
Update the repository secret `DEPLOY_HOST` from `192.168.1.103` to
`192.168.1.113`. No workflow file changes needed.

---

## Deliverables in This Branch

| File | Change |
|------|--------|
| `nginx/ackmud.conf` | WSS backends updated to `192.168.1.103` |
| `systemd/web-server.service` | `ACKTNG_GAME_URL` env var added |
| `scripts/setup-web-container.sh` | **New** — full setup script for 192.168.1.113 |
| `scripts/cleanup-acktng-web.sh` | **New** — teardown script for 192.168.1.103 |
| `docs/proposals/migrate-web-to-container.md` | This document |

---

## Migration Procedure

### Phase 1 — Prepare new container (192.168.1.113)

1. Provision the container; ensure it can reach 192.168.1.103 over the LAN.
2. Open port 22 for SSH (needed for GitHub Actions deployment).
3. Copy your SSH public key: `ssh-copy-id user@192.168.1.113`
4. Clone this repo and run the setup script as root:
   ```bash
   git clone <repo-url> ~/web
   sudo bash ~/web/scripts/setup-web-container.sh
   ```

### Phase 2 — Verify new container

Before cutting over, test against the new container directly:

```bash
# From a machine on the LAN
curl -k --resolve ackmud.com:443:192.168.1.113    https://ackmud.com/
curl -k --resolve aha.ackmud.com:443:192.168.1.113 https://aha.ackmud.com/
curl -k --resolve ackmud.com:443:192.168.1.113    https://ackmud.com/gsgp
curl -k --resolve ackmud.com:443:192.168.1.113    https://ackmud.com/who
```

### Phase 3 — Cut over

1. Update the `DEPLOY_HOST` GitHub Actions secret to `192.168.1.113`.
2. Re-point router/firewall port forwarding for ports 80, 443, 9890, 8891,
   8892 from 192.168.1.103 → 192.168.1.113.
3. Trigger a test deploy by pushing to `main`.

### Phase 4 — Clean up acktng (192.168.1.103)

Once the new container is confirmed healthy:

```bash
sudo bash ~/web/scripts/cleanup-acktng-web.sh
```

---

## Rollback Plan

The cleanup script asks for confirmation before removing anything. Until
Phase 4 runs, the old setup on 192.168.1.103 remains intact. To roll back
after cutover simply re-point the router port forwarding back to 192.168.1.103
and revert the `DEPLOY_HOST` secret.

---

## Assumptions

- The network router/firewall forwards public ports 80, 443, 9890, 8891, 8892
  to a single internal IP. That forwarding rule needs updating from
  192.168.1.103 → 192.168.1.113 at cutover.
- 192.168.1.103 allows inbound connections from 192.168.1.113 on port 8080
  (game API) and ports 18890/18891/18892 (game servers). If a host firewall
  is active on 192.168.1.103, these ports must be open to 192.168.1.113.
