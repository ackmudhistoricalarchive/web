# ACKMUD Historical Archive — Project Architecture

> **Auto-generated:** This document is automatically updated by a git pre-commit hook whenever architecture-relevant files are modified (see [Keeping This Doc Updated](#keeping-this-doc-updated)).

---

## Overview

The **ACKMUD Historical Archive and Live Reference Web Server** is a Python-based web application that preserves and presents the history of the ACK! MUD (Multi-User Dungeon) game system. It serves:

- Archival content (historical game documentation, lore, stories)
- A searchable reference interface (help topics, spell help, lore entries)
- A real-time browser-based MUD client
- Live player activity from connected game servers

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3 (standard library only — no external dependencies) |
| HTTP Server | `http.server.ThreadingHTTPServer` |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| WebSocket Client | Browser-native WebSocket API |
| Styling | CSS variables, CSS Grid/Flexbox, dark theme |
| Build | GNU Make |
| CI/CD | GitHub Actions (SSH-based remote deploy) |

---

## Directory Structure

```
web/
├── .github/
│   └── workflows/
│       └── deploy-web-on-merge.yml   # CI/CD: push to main → SSH deploy
├── .git/hooks/
│   └── pre-commit                    # Auto-updates this architecture doc
├── Makefile                          # Build script (sets execute permissions)
├── web_who_server.py                 # Main application server (~450 lines)
├── docs/
│   └── architecture.md              # This file
├── templates/
│   ├── base.html                     # Master layout (embedded CSS + nav)
│   ├── home.html                     # Landing page
│   ├── mud_client.html               # Browser-based MUD client
│   ├── stories.html                  # Stories container with aggregation logic
│   ├── world_map.html                # World map display page
│   └── stories/                      # Individual story HTML fragments
│       ├── 01-name-eater.html
│       ├── 02-dry-meridian.html
│       ├── 03-wrong-shadows.html
│       └── 04-continuance-doctrine.html
├── img/
│   ├── ackmud_logo_transparent.png   # Site logo (served as data URI for caching)
│   └── acktng.png                    # World map image (4.4 MB)
├── area/
│   └── forest_preserve.are           # Sample game area file
└── docs/
    ├── architecture.md               # This file
    └── proposals/
        └── wss-mud-client.md         # Design proposal for WebSocket Secure support
```

**External data** (expected at `~/acktng/` on the host, not in this repo):

```
~/acktng/
├── soewholist.html     # Live player list (written by game server)
├── whocount.html       # Live player count
├── help/               # Help topic files (one file per topic)
├── shelp/              # Spell help topic files
└── lore/               # Lore entry files (special block format)
```

---

## Server Architecture (`web_who_server.py`)

### Entry Point

```
ThreadingHTTPServer("0.0.0.0", PORT)
    └─→ WhoRequestHandler (one thread per request)
        ├─ do_GET()   — handles all page and asset routes
        └─ do_POST()  — returns 404 (not supported)
```

**Configuration:**

| Setting | Default | Override |
|---------|---------|---------|
| Host | `0.0.0.0` | — |
| Port | `80` | `ACK_WEB_PORT` env var |
| Web dir | directory of `web_who_server.py` | — |
| Game data dir | `~/acktng/` | — |

### Routing Table

All routing is handled in `do_GET()` via string matching on the URL path:

| Path(s) | Handler | Description |
|---------|---------|-------------|
| `/` | `_build_home_page()` | Landing page |
| `/who`, `/players` | `_build_who_page()` | Live player snapshot |
| `/mud` | `_build_mud_client_page()` | Browser MUD client |
| `/map`, `/world-map` | `_build_world_map_page()` | World map image page |
| `/stories` | `_build_stories_page()` | Aggregated story fragments |
| `/reference`, `/reference/help`, `/reference/shelp`, `/reference/lore` | `_build_reference_page()` | Searchable topic index (tabbed) |
| `/helps/<topic>` | `_build_topic_page()` | Individual help topic |
| `/shelps/<topic>` | `_build_topic_page()` | Individual spell help topic |
| `/lores/<topic>` | `_build_topic_page()` | Individual lore entry |
| `/img/<file>` | Static file handler | PNG/JPG images |
| `/web/mp3/<file>` | Static file handler | MP3 audio files |
| `/help/` → `/reference/help/` | Redirect | Backwards compatibility |

Query string `?q=<keyword>` on reference routes filters the topic list by substring match.

### Caching Layer

All caches use threading locks and invalidate on file modification time:

| Cache | Contents | Key |
|-------|----------|-----|
| `_template_cache` | Rendered HTML templates | File path → `(mtime, content)` |
| `_topic_names_cache` | Directory file listings | Dir path → `(mtime, [names])` |
| `_topic_content_cache` | Topic file text | File path → `(mtime, text)` |
| `_logo_data_uri_cache` | Base64 logo data URI | File path → `(mtime, data_uri)` |

### Path Safety

`_safe_topic_path(base_dir, topic_name)` validates that the resolved path stays within `base_dir`, preventing directory traversal attacks.

### Lore Parser

`_extract_first_lore_entry(text)` parses lore files which use a `\n---\n`-delimited block format with a `keywords` header. It returns only the first universal (non-faction-specific) prose entry.

---

## Frontend Architecture

### Base Layout (`templates/base.html`)

All pages extend the base layout via Python string substitution of `__TITLE__`, `__NAV__`, and `__BODY__` placeholders:

```
<header>   — logo + site title
<nav>      — navigation links (Home, Who's On, Reference, Stories, Map, Play)
<main>     — page-specific content (injected by each _build_*_page() function)
```

The base template embeds all global CSS using a CSS variable design system:

```css
--bg: #0d1117          /* page background */
--surface: #161b22     /* card/panel background */
--accent: #5b9cf6      /* interactive elements */
--text: #e6edf3        /* primary text */
--muted: #8b949e       /* secondary text */
```

### MUD Web Client (`templates/mud_client.html`)

A fully self-contained JavaScript WebSocket terminal client:

**UI Components:**
- World selector dropdown (populated from `WORLD_TARGETS` in server config)
- Connect / Disconnect buttons
- Scrollable terminal output pane with ANSI color rendering
- Command input + Send button
- Fullscreen toggle
- Music player (play/stop/volume/loop with crossfade)

**Networking:**
- Uses native `WebSocket` API
- Automatically selects `wss://` (HTTPS) or `ws://` (HTTP) based on page protocol
- 1-hour server-side `socket_timeout` for long play sessions

**ANSI Rendering:**
- Parses SGR escape codes (codes 0–97)
- Supports foreground/background colors, bold, underline
- HTML entity escapes all output to prevent XSS

**Music System:**
- Game server sends JSON frames: `{"type": "music", "action": "play"|"stop", "url": "..."}`
- Two `<audio>` elements for crossfade (2-second transition)
- Loop and volume controls

### Stories Page (`templates/stories.html`)

The server collects all `*.html` fragments from `templates/stories/` in sorted order and replaces the `__STORIES__` placeholder. Each fragment is an independent HTML snippet with an expandable header + body controlled by inline JavaScript.

### Reference Pages

Dynamically rendered listing of topic files from game data directories with:
- Tab navigation (Help / Spell Help / Lore)
- Live substring search via `?q=` query parameter
- Links to individual topic pages

---

## World Targets (MUD Server Connections)

Defined in `web_who_server.py` and injected into the MUD client template:

| ID | Name | Host | Port |
|----|------|------|------|
| `acktng` | ACK!TNG | ackmud.com | 9890 |
| `ack431` | ACK! 4.3.1 | ackmud.com | 8891 |
| `ack42` | ACK! 4.2 | ackmud.com | 8892 |

---

## Deployment

### CI/CD Pipeline (`.github/workflows/deploy-web-on-merge.yml`)

Triggers on push to `main` when files under `web/**` change:

1. GitHub Actions runner connects via SSH using stored secrets
2. On the deploy host: `git stash && git pull origin main && make`
3. `make` runs `chmod a+x web_who_server.py`

**Required GitHub Secrets:**

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | Server hostname/IP |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_KEY` | Private SSH key |
| `DEPLOY_PATH` | Root deployment path on server |

### Build (`Makefile`)

```makefile
all:
    chmod a+x web_who_server.py
```

---

## Security Design

| Concern | Mitigation |
|---------|-----------|
| Path traversal | `_safe_topic_path()` validates all resolved paths stay within allowed base dirs |
| XSS | All MUD output HTML-entity-escaped before DOM insertion |
| SQL injection | No database; no SQL |
| Supply chain | Zero external Python dependencies |
| POST abuse | All POST requests return 404 |

---

## Component Relationship Map

```
web_who_server.py
│
├─ _load_template()          ──reads──▶  templates/*.html
├─ _build_home_page()        ──uses──▶   base.html + home.html
├─ _build_who_page()         ──reads──▶  ~/acktng/soewholist.html
├─ _build_mud_client_page()  ──uses──▶   base.html + mud_client.html
│                            ──injects─▶ WORLD_TARGETS JSON
├─ _build_stories_page()     ──reads──▶  templates/stories/*.html
├─ _build_world_map_page()   ──uses──▶   base.html + world_map.html
├─ _build_reference_page()   ──lists──▶  ~/acktng/help|shelp|lore/
├─ _build_topic_page()       ──reads──▶  ~/acktng/help|shelp|lore/<topic>
│
└─ Static handlers           ──serves──▶ img/*.png, web/mp3/*.mp3
```

---

## Future Work

See `docs/proposals/wss-mud-client.md` for a detailed design on adding TLS-encrypted WebSocket (WSS) support via a reverse proxy in front of the game servers. No web server code changes are required — the client already auto-selects `wss://` when served over HTTPS.

---

## Keeping This Doc Updated

A git pre-commit hook at `.git/hooks/pre-commit` automatically re-timestamps and flags this document for review whenever any of the following architecture-relevant files are staged for commit:

- `web_who_server.py`
- `templates/*.html`
- `templates/stories/*.html`
- `.github/workflows/*.yml`
- `Makefile`

The hook appends a `Last architecture change:` line to this file and stages it alongside the commit. If you make architectural changes, review and update the relevant sections of this document before committing.
