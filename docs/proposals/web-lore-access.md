# Proposal: Web Access to Help/Lore Content After DB Migration

**Status:** Draft
**Date:** 2026-03-21
**Related:** [database-schema-areas.md](https://github.com/ackmudhistoricalarchive/acktng/blob/main/docs/proposals/database-schema-areas.md)

---

## Problem

The game server is migrating from flat files to PostgreSQL for all game content, including `help_entries`, `shelp_entries`, `lore_topics`, and `lore_entries`. The web server currently reads directly from `~/acktng/help/`, `~/acktng/shelp/`, and `~/acktng/lore/` on the local filesystem. Once the migration completes, those directories will no longer be the authoritative source of truth.

The web server has an explicit design constraint: **zero external Python dependencies** (standard library only). This rules out psycopg2 or any PostgreSQL client library as a direct solution.

---

## Options Considered

### Option A — Keep Flat Files via Periodic Export

The DB migration proposal already includes `db_to_files.c` for regenerating flat files from PostgreSQL. A cron job (or post-write trigger) could export help/shelp/lore directories on a schedule.

**Pros:**
- No changes to web server whatsoever
- Zero additional dependencies on either side
- Web server degrades gracefully if game server is down

**Cons:**
- Data staleness: exports run on a schedule, not on write
- Two sources of truth to keep synchronized
- Export cron is operational overhead with failure modes (stale files, partial writes)
- Contradicts the goal of PostgreSQL as the single authoritative source

---

### Option B — Direct PostgreSQL via Raw Socket (Wire Protocol)

Python's standard library `socket` module can speak the PostgreSQL frontend/backend wire protocol without any third-party packages. This is theoretically possible but complex.

**Pros:**
- Zero external dependencies maintained
- Real-time, authoritative reads

**Cons:**
- Implementing the PostgreSQL wire protocol in pure Python is high-effort and fragile
- Authentication (MD5, SCRAM-SHA-256) adds further complexity
- Ongoing maintenance burden when the protocol or auth method changes
- Not a realistic path

---

### Option C — Lightweight HTTP Content API (Recommended)

A small, dedicated HTTP read API is added on the game server side (or as a standalone Python service collocated with the database) that exposes the help/shelp/lore content over HTTP. The web server replaces its filesystem reads with HTTP calls to this API using Python's built-in `urllib`.

**Pros:**
- Clean separation of concerns: game server owns content, web server queries it
- Real-time reads — no staleness
- `urllib` is standard library — zero new dependencies on the web server
- The API can be used by other consumers (Discord bots, future tools) without coupling them to the DB schema
- Authentication and rate-limiting can be layered onto the API endpoint

**Cons:**
- Requires building and running the API service
- Web server becomes dependent on API availability — needs graceful degradation

---

### Option D — PostgreSQL via psycopg2 (Accept the Dependency)

Relax the zero-dependency constraint and install `psycopg2-binary` alongside the web server. The web server queries PostgreSQL directly.

**Pros:**
- Direct, real-time access with full SQL power
- No intermediary service to operate

**Cons:**
- Breaks the explicit security design choice (supply chain risk)
- Requires PostgreSQL credentials on the web server host
- Schema changes in the game server require matching changes in the web server's queries
- Tighter coupling between two independent components

---

## Recommended Approach: Option C (HTTP Content API)

### Architecture

```
web_who_server.py
    │
    └─ HTTP GET ──▶  Content API  ──▶  PostgreSQL
                     (port 8080)       (port 5432)
```

The Content API is a lightweight, read-only HTTP service. It can be:

- A standalone Python script (standard library only, mirroring the web server's own approach), or
- A minimal endpoint added to the game server's existing HTTP infrastructure if one exists.

It runs on the same host as PostgreSQL (or has direct LAN access to it), so credentials never traverse the network to the web host.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/helps` | List all help topic keywords |
| `GET` | `/api/helps/<topic>` | Full text of a help entry |
| `GET` | `/api/shelps` | List all spell help keywords |
| `GET` | `/api/shelps/<topic>` | Full text of a spell help entry |
| `GET` | `/api/lores` | List all lore topic keywords |
| `GET` | `/api/lores/<topic>` | First universal lore entry for a topic |
| `GET` | `/api/search?q=<keyword>&type=help\|shelp\|lore` | Cross-content keyword search |

All responses are JSON. Example for `/api/helps/backstab`:

```json
{
  "keyword": "BACKSTAB",
  "level": 0,
  "text": "Syntax: backstab <victim>\n\nBackstab is a rogue skill..."
}
```

Example listing response for `/api/helps`:

```json
{
  "topics": ["BACKSTAB", "BASH", "BERSERK", "..."]
}
```

### Web Server Changes

The web server's data access layer is cleanly isolated in three methods that need updating:

| Current Method | Change |
|----------------|--------|
| `_build_reference_page()` — lists `~/acktng/help\|shelp\|lore/` | Replace `os.listdir()` with `GET /api/helps\|shelps\|lores` |
| `_build_topic_page()` — reads `~/acktng/help\|shelp\|lore/<topic>` | Replace file read with `GET /api/helps\|shelps\|lores/<topic>` |
| `_extract_first_lore_entry()` — parses raw lore block format | Keep as fallback; API returns pre-parsed JSON so parsing may be skipped |

The existing `_topic_names_cache` and `_topic_content_cache` caches remain valid — they switch from `(mtime, content)` to `(timestamp, content)` with a configurable TTL (e.g., 60 seconds).

**Configuration** (`web_who_server.py`):

```python
CONTENT_API_URL = os.environ.get("ACK_CONTENT_API_URL", "http://localhost:8080")
CONTENT_API_TTL = int(os.environ.get("ACK_CONTENT_API_TTL", "60"))  # seconds
```

### Graceful Degradation

If the Content API is unreachable, the web server should:

1. Return a user-visible error on individual topic pages ("Content temporarily unavailable")
2. Return an empty topic list on reference/index pages with a notice
3. Log the error server-side
4. **Not** crash or return a 500 to the user

The existing try/except patterns in `_build_topic_page()` already handle missing files — these extend naturally to handle HTTP errors.

### Content API Implementation Notes

The Content API lives in the **DB repo** (`ackmudhistoricalarchive/acktng` alongside the schema and migration tooling), not in the game server repo. The schema and the API are tightly coupled — a column rename or table restructure should prompt an API update in the same PR, and that co-location enforces it. The game server has no stake in this service.

The Content API queries the tables from the DB schema proposal:

| Web Route | SQL Source |
|-----------|-----------|
| `/api/helps/<topic>` | `SELECT keyword, level, text FROM help_entries WHERE keyword ILIKE $1` |
| `/api/shelps/<topic>` | `SELECT keyword, level, text FROM shelp_entries WHERE keyword ILIKE $1` |
| `/api/lores/<topic>` | `SELECT lt.keywords, le.text FROM lore_topics lt JOIN lore_entries le ON lt.id = le.topic_id WHERE lt.keywords ILIKE $1 AND le.faction IS NULL LIMIT 1` |

The API should be **read-only** and bind to localhost or a private network interface only — not exposed to the public internet.

---

## Migration Path

1. **Phase 1 (parallel):** Stand up the Content API alongside existing flat files. Add an `ACK_CONTENT_API_URL` environment variable to the web server; when set, prefer API over filesystem. Default remains filesystem. Both paths work simultaneously.

2. **Phase 2 (cutover):** After the game server completes its DB migration, set `ACK_CONTENT_API_URL` in the web server's environment. Verify all help/shelp/lore content is accessible.

3. **Phase 3 (cleanup):** Remove the filesystem fallback code path and the `~/acktng/help|shelp|lore/` directories from the web server's expected layout. Update `docs/architecture.md`.

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Content API exposed publicly | Bind to localhost or private network only; firewall to web host IP only |
| SQL injection via topic names | Content API uses parameterized queries only |
| Path traversal | Already handled by `_safe_topic_path()`; API variant validates topic names against allowlist pattern `[A-Za-z0-9 '_-]+` |
| Credentials on web host | Web server holds no DB credentials; only the Content API does |
| Supply chain | Web server still has zero external Python dependencies |

---

## Open Questions

1. **Who owns the Content API?** Resolved: lives in the DB repo (`ackmudhistoricalarchive/acktng`) alongside the schema migrations and tooling.
2. **Authentication between web server and Content API?** For now, network isolation (localhost/LAN) is sufficient. A shared secret header can be added later if the API needs to be routable across untrusted networks.
3. **Should the API support full-text search?** PostgreSQL supports `tsvector` full-text search across help/lore content. This could power a richer `/reference?q=` experience than the current substring match. Out of scope for initial implementation but worth planning the endpoint for.
