# Proposal: Migrate Web Server to Dedicated Container

**Date:** 2026-03-22
**Branch:** `claude/migrate-web-server-container-7F8Ta`
**Status:** Proposed

## Summary

Move the Python web server (`web_who_server.py`) and its nginx reverse proxy off the `acktng` game server host (192.168.1.103) onto a dedicated container at 192.168.1.113. Clean up all web-related software from 192.168.1.103 so it only runs MUD game processes.

---

## Current Architecture

```
192.168.1.103 (acktng)
├── nginx (ports 80, 443, 9890, 8891, 8892)
│   ├── HTTP → HTTPS redirect
│   ├── HTTPS reverse proxy → Python app (127.0.0.1:8081)
│   └── WSS proxies → game servers (127.0.0.1:18890/18891/18892)
├── Python web server (port 8081, systemd: web-server.service)
│   ├── reads ~/acktng/help, shelp, lore  (filesystem)
│   └── calls http://localhost:8080/gsgp,/who  (game API)
├── MUD game servers (ports 18890, 18891, 18892)
├── MUD game API (port 8080)
├── certbot + Let's Encrypt certs (/etc/letsencrypt/)
└── ~/web  (this repo)
```

## Target Architecture

```
192.168.1.103 (acktng)  ←──────────────────────────────────────┐
├── MUD game servers (ports 18890, 18891, 18892)                │  NFS
├── MUD game API (port 8080)                                     │  mount
└── NFS export: /home/user/acktng  ───────────────────────────────┘

192.168.1.113 (web container)
├── nginx (ports 80, 443, 9890, 8891, 8892)
│   ├── HTTP → HTTPS redirect + ACME webroot
│   ├── HTTPS reverse proxy → Python app (127.0.0.1:8081)
│   └── WSS proxies → game servers (192.168.1.103:18890/18891/18892)
├── Python web server (port 8081, systemd: web-server.service)
│   ├── reads /home/user/acktng/help, shelp, lore  (NFS mount)
│   └── calls http://192.168.1.103:8080/gsgp,/who  (game API over LAN)
├── certbot + Let's Encrypt certs
└── ~/web  (this repo, cloned fresh)
```

---

## Changes Required

### 1. nginx/ackmud.conf — WSS backend IPs
The WSS proxy blocks currently target `127.0.0.1`; after migration they must
target the acktng host over the LAN:

| Port | Before | After |
|------|--------|-------|
| 9890 | `http://127.0.0.1:18890` | `http://192.168.1.103:18890` |
| 8891 | `http://127.0.0.1:18891` | `http://192.168.1.103:18891` |
| 8892 | `http://127.0.0.1:18892` | `http://192.168.1.103:18892` |

HTTP/HTTPS proxy blocks remain unchanged (still `http://127.0.0.1:8081`).

### 2. systemd/web-server.service — ACKTNG_GAME_URL
Add the environment variable so the Python app calls the game API over the LAN
instead of localhost:

```ini
Environment=ACKTNG_GAME_URL=http://192.168.1.103:8080
```

### 3. NFS — acktng data for reference pages
`web_who_server.py` reads `~/acktng/help/`, `shelp/`, `lore/` from the
filesystem. On the new container this directory does not exist locally, so
192.168.1.103 must export it via NFS and 192.168.1.113 must mount it.

- **On 192.168.1.103** (`cleanup-acktng-web.sh` handles this):
  - Install `nfs-kernel-server`
  - Export `/home/user/acktng` read-only to 192.168.1.113
- **On 192.168.1.113** (`setup-web-container.sh` handles this):
  - Install `nfs-common`
  - Mount `192.168.1.103:/home/user/acktng` → `/home/user/acktng`
  - Add entry to `/etc/fstab` for persistence

### 4. CI/CD — GitHub Actions secrets
Update the repository secret `DEPLOY_HOST` from 192.168.1.103 to
192.168.1.113. No workflow file changes needed.

### 5. certbot renewal hooks
On the new container only `certbot-post-renew.sh` (nginx reload) is needed.
The `certbot-post-renew-acktng.sh` hook (restarts MUD processes) belongs on
192.168.1.103 — but since nginx will no longer run there, there is no cert
renewal on the old host and this hook can be removed entirely from acktng.

---

## Deliverables in This Branch

| File | Change |
|------|--------|
| `nginx/ackmud.conf` | WSS backends updated to 192.168.1.103 |
| `systemd/web-server.service` | `ACKTNG_GAME_URL` env var added |
| `scripts/setup-web-container.sh` | **New** — full setup script for 192.168.1.113 |
| `scripts/cleanup-acktng-web.sh` | **New** — teardown + NFS export script for 192.168.1.103 |
| `docs/proposals/migrate-web-to-container.md` | This document |

---

## Migration Procedure

Run these steps in order to achieve zero-downtime cutover.

### Phase 1 — Prepare new container (192.168.1.113)

1. Provision the container and ensure it can reach 192.168.1.103 over the LAN.
2. Ensure port 22 is open for SSH (needed for GitHub Actions deployment).
3. Copy your SSH public key to the container (`ssh-copy-id user@192.168.1.113`).
4. Clone this repo onto the container:
   ```bash
   git clone <repo-url> ~/web
   cd ~/web
   ```
5. Run the setup script **as root**:
   ```bash
   sudo bash scripts/setup-web-container.sh
   ```
   This will:
   - Install nginx, certbot, python3, nfs-common
   - Mount the acktng data directory via NFS (requires Phase 2 NFS export first)
   - Obtain TLS certificates via Let's Encrypt
   - Install and start the systemd web service
   - Install and enable nginx with the updated config

### Phase 2 — Configure NFS export on acktng (192.168.1.103)

This can be done before or in parallel with Phase 1. On 192.168.1.103, run:

```bash
sudo bash ~/web/scripts/cleanup-acktng-web.sh --nfs-only
```

Or run the full cleanup in one shot once the new container is verified (Phase 3).

### Phase 3 — Verify new container

Before cutting over DNS or updating CI/CD, verify the new container works:

```bash
# From a machine on the LAN, test both virtual hosts
curl -k --resolve ackmud.com:443:192.168.1.113 https://ackmud.com/
curl -k --resolve aha.ackmud.com:443:192.168.1.113 https://aha.ackmud.com/
# Check the game API bridge
curl -k --resolve ackmud.com:443:192.168.1.113 https://ackmud.com/gsgp
# Check reference pages (exercises the NFS mount)
curl -k --resolve ackmud.com:443:192.168.1.113 https://ackmud.com/reference/help/
```

Run the integration test suite against the new host:
```bash
ACK_TEST_HOST=192.168.1.113 python3 test_integration.py
```

### Phase 4 — Cut over

1. Update the `DEPLOY_HOST` GitHub Actions secret to `192.168.1.113`.
2. If DNS or a local resolver maps `ackmud.com` to the old IP, update it to
   192.168.1.113 (or ensure the router/firewall forwards ports 80/443/9890/8891/8892
   to 192.168.1.113 instead of 192.168.1.103).
3. Trigger a test deploy by pushing to `main`.

### Phase 5 — Clean up acktng (192.168.1.103)

Once the new container is confirmed healthy and receiving traffic, run the
full cleanup on the old host:

```bash
sudo bash ~/web/scripts/cleanup-acktng-web.sh
```

This will:
- Stop and disable `web-server.service`
- Remove nginx, certbot, and all associated configuration
- Remove TLS certificates
- Remove `/var/www/certbot`
- Remove `~/web`
- Set up (or preserve) the NFS export for the game data directory

---

## Rollback Plan

If the new container has problems after cutover:

1. Re-point the router/firewall port forwarding back to 192.168.1.103.
2. On 192.168.1.103: `sudo systemctl start nginx web-server` (the cleanup
   script does not run until you explicitly trigger Phase 5, so the old setup
   remains intact until then).
3. Revert the `DEPLOY_HOST` secret.

---

## Open Questions / Assumptions

- **Firewall**: Assumes the network router/firewall forwards public ports
  80, 443, 9890, 8891, 8892 to a single internal IP. That forwarding rule
  needs updating from 192.168.1.103 → 192.168.1.113 at cutover.
- **NFS security**: The NFS export is restricted to 192.168.1.113 and
  read-only. The acktng directory contains no secrets.
- **acktng port 8080**: Assumes the MUD game API on 192.168.1.103:8080 is
  accessible from 192.168.1.113 without firewall restrictions. If a host
  firewall is active on 192.168.1.103, port 8080 must be allowed from
  192.168.1.113.
- **acktng WSS ports 18890/18891/18892**: Same assumption — these must be
  reachable from 192.168.1.113 for the nginx WSS proxies to function.
