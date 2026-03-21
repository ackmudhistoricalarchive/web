# Web Client: Message Tagging System & Multi-Panel UI Specification

## Overview

This document defines the message tagging protocol and multi-panel UI layout for the
ACKMUD web client. The TNG codebase sends all output to the web client over a WebSocket
connection as JSON-encoded messages. Every message **must** carry a `tag` field that
identifies its semantic category so the client can route it to the correct panel,
apply correct rendering, and enforce retention policy.

---

## 1. Message Tagging Protocol

### 1.1 Wire Format

All messages sent to the web client over the WebSocket **must** be JSON objects. Plain
text (non-JSON) is illegal in the tagged protocol version.

```json
{
  "v": 2,
  "tag": "<category>[:<subcategory>]",
  "data": "<ansi-or-plain-text | structured object>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `v` | integer | yes | Protocol version. Must be `2` for the tagged protocol. |
| `tag` | string | yes | Semantic tag (see §1.2). |
| `data` | string \| object | yes | Payload. Strings may contain ANSI escape sequences. Objects are tag-specific (see §1.3). |

The legacy untagged plain-text path (protocol v1) remains supported for backwards
compatibility with non-TNG worlds, but all TNG output must use v2.

### 1.2 Tag Taxonomy

Tags follow the pattern `Category` or `Category:Subcategory`. The colon is a
**hard separator** — routing rules match on the full tag or on the category prefix.

#### Top-level categories

| Tag | Description | Target panel |
|-----|-------------|--------------|
| `System` | Internal client/server lifecycle messages (connect, disconnect, errors, mode changes) | Main I/O |
| `Communication:Tell` | Tells directed at the player | Main I/O |
| `Communication:Say` | Speech in the current room | Main I/O |
| `Communication:Yell` | Yells (cross-zone) | Main I/O |
| `Communication:Shout` | Shouts (world-wide) | Main I/O |
| `Communication:Gossip` | Gossip channel | Main I/O |
| `Communication:Channel` | Named OOC channels (pray, clan, etc.) | Main I/O |
| `Communication:Emote` | Emote / social actions | Main I/O |
| `Combat` | Combat round output | Main I/O |
| `Combat:Death` | Death message (player or mob) | Main I/O |
| `Skill` | Skill / spell cast output not part of a combat round | Main I/O |
| `Room` | Output derived from `look` (room name, description, exits, contents) | Room panel (live-data) |
| `Room:Enter` | A mob or player entered the room | Room panel (live-data) |
| `Room:Leave` | A mob or player left the room | Room panel (live-data) |
| `Room:ObjectAppear` | An object appeared in the room | Room panel (live-data) |
| `Room:ObjectVanish` | An object left the room | Room panel (live-data) |
| `Map` | Automapper / scan data for the graphical map panel | Map panel |
| `Map:Scan` | Result of `scan` command (mob counts per direction) | Map panel |
| `Map:Scout` | Extended visibility data available because player has `scout` | Map panel |
| `Inventory` | Player inventory listing | Main I/O |
| `Score` | Score / stats screen | Main I/O |
| `Music` | Background music control (existing v1 compat — keep `type:"music"` inside `data`) | — (no display) |
| `Help` | Help/shelp/lore page content | Main I/O |
| `Prompt` | The MUD prompt line (hp/mana/move) | Main I/O (prompt bar) |

Any unrecognised tag **must** be routed to the Main I/O panel as a fallback, and the
client should log a warning to the browser console.

### 1.3 Structured Payloads

Certain tags carry a structured `data` object instead of a plain string.

#### `Room` (full look)

Sent once after entering a room or issuing `look` with no arguments.

```json
{
  "v": 2,
  "tag": "Room",
  "data": {
    "name": "The Town Square",
    "description": "A broad cobblestone plaza...",
    "exits": ["north", "south", "east", "west"],
    "mobs": [
      { "id": "guard_1", "name": "a town guard", "keywords": ["guard", "town"], "actions": ["look", "attack", "consider"] }
    ],
    "players": [
      { "name": "Kelthas", "actions": ["look", "tell"] }
    ],
    "objects": [
      { "id": "sword_3", "name": "a rusty sword", "keywords": ["sword", "rusty"], "actions": ["look", "get", "examine"] }
    ],
    "extras": [
      { "keyword": "fountain", "actions": ["look", "examine", "drink"] }
    ]
  }
}
```

#### `Room:Enter` / `Room:Leave`

Delta events — the room panel applies these without a full redraw.

```json
{
  "v": 2,
  "tag": "Room:Enter",
  "data": {
    "entity_type": "mob",
    "id": "wolf_7",
    "name": "a grey wolf",
    "keywords": ["wolf", "grey"],
    "actions": ["look", "attack", "consider"],
    "direction": "north"
  }
}
```

`entity_type` is one of `"mob"`, `"player"`, or `"object"`.
`direction` is optional and indicates which exit the entity came from.

#### `Room:ObjectAppear` / `Room:ObjectVanish`

Same shape as `Room:Enter`/`Room:Leave` with `entity_type: "object"`.

#### `Map` (base automapper state)

```json
{
  "v": 2,
  "tag": "Map",
  "data": {
    "current_room_id": "4201",
    "terrain": "city",
    "rooms": [
      {
        "id": "4201",
        "rel_x": 0,
        "rel_y": 0,
        "terrain": "city",
        "exits": { "north": "4202", "south": "4200", "east": "4205" }
      },
      {
        "id": "4202",
        "rel_x": 0,
        "rel_y": -1,
        "terrain": "road",
        "exits": { "north": "4203", "south": "4201" },
        "mob_count": 2
      }
    ]
  }
}
```

`rel_x` / `rel_y` are room offsets from the current room in grid steps.
`mob_count` on a non-current room is what `scan` would report for that direction.

#### `Map:Scan`

Updates mob counts for directly adjacent rooms without a full map rebuild. Sent after
an explicit `scan` command or when the server detects the counts have changed.

```json
{
  "v": 2,
  "tag": "Map:Scan",
  "data": {
    "north": { "room_id": "4202", "count": 3 },
    "south": { "room_id": "4200", "count": 0 },
    "east":  { "room_id": "4205", "count": 1 },
    "west":  null
  }
}
```

`null` for a direction means no exit (or no change). The client updates `mob_count` on
the named room object in `mapState.rooms` and schedules a canvas redraw.

#### `Map:Scout`

Extends the map payload with additional rooms visible only to a player with `scout`.
The client merges this into the existing map state — it does not replace it.

```json
{
  "v": 2,
  "tag": "Map:Scout",
  "data": {
    "rooms": [
      {
        "id": "4204",
        "rel_x": 0,
        "rel_y": -3,
        "terrain": "forest",
        "exits": { "north": "4204a", "south": "4203" },
        "mob_count": 4
      }
    ]
  }
}
```

---

## 2. Three-Panel UI Layout

On successful WebSocket connection to a TNG world, the client switches to a three-panel
layout. The layout is responsive; on narrow viewports the panels stack vertically in the
order: Map → Room → Main I/O (bottom).

```
┌───────────────────────────────────────────────────────────────────┐
│  [World selector]  [Connect]  [Disconnect]  ...           [⛶ FS] │
├──────────────────────┬─────────────────────┬──────────────────────┤
│                      │                     │                      │
│    GRAPHICAL MAP     │   ROOM DESCRIPTION  │     MAIN  I/O        │
│      (§ 2.1)         │      (§ 2.2)        │      (§ 2.3)         │
│                      │                     │                      │
│                      │                     │                      │
│                      │                     │                      │
│                      │                     ├──────────────────────┤
│                      │                     │  [command input] [↵] │
└──────────────────────┴─────────────────────┴──────────────────────┘
```

The three panels are resizable (drag dividers). Sizes are persisted to `localStorage`.

---

### 2.1 Graphical Map Panel (live-data)

**Accepts tags:** `Map`, `Map:Scan`, `Map:Scout`

**Window state: live-data.** The map panel holds no history. A `Map` message
completely replaces all grid state. `Map:Scan` and `Map:Scout` update the current
state in-place. There is no concept of a "previous map" — the canvas always reflects
only the current room's surroundings.

#### 2.1.1 Rendering

- Implemented as an HTML `<canvas>` element sized to fill the panel.
- Each room is drawn as a **tile** using a terrain-specific PNG loaded from
  `img/terrain/<terrain>.png`. If the image is absent or fails to load, a solid
  colour fill is used instead (see fallback colours in §2.1.4), with a 4-character
  terrain label abbreviation overlaid when the tile is ≥ 28 px wide.
- Exit connections between tiles are drawn as semi-transparent lines between tile
  centres, rendered before tiles so they appear underneath.
- The current room is centred in the grid, highlighted with a `#5b9cf6` border, and
  has a small player dot drawn at its centre.
- The canvas is resized to match the panel's pixel dimensions via `ResizeObserver`,
  with a pixel-accurate redraw scheduled via `requestAnimationFrame` (coalesced).
- The map is never populated from `look` output — it uses only `Map`/`Map:Scout` data.

#### 2.1.2 Visibility radius — without `scout`

| Direction | Rooms visible |
|-----------|--------------|
| North | 2 (current + 1 step N, current + 2 steps N) |
| South | 2 |
| East | 2 |
| West | 2 |

Each visible adjacent room displays a **mob count badge** derived from `Map:Scan` data
(what `scan` would report for that direction). The badge is shown in the corner of the
tile; `0` mobs → badge hidden.

#### 2.1.3 Visibility radius — with `scout`

| Direction | Rooms visible |
|-----------|--------------|
| North | 3 (one extra step N) |
| South | 3 |
| East | 3 |
| West | 3 |

The extra (third) room in each direction is rendered with reduced opacity to indicate
it is scouted-but-not-seen. Mob counts on the scouted rooms come from `Map:Scout` data.

#### 2.1.4 Terrain tile mapping

| Terrain string | Tile description |
|----------------|-----------------|
| `city` | Stone/cobblestone |
| `road` | Dirt road |
| `forest` | Tree canopy |
| `deep_forest` | Dense tree canopy |
| `field` | Grassy field |
| `hills` | Rolling hills |
| `mountain` | Mountain peak |
| `water_swim` | Water (swimmable) |
| `water_noswim` | Deep water |
| `desert` | Sand/dune |
| `cave` | Dark cave floor |
| `inside` | Interior floor |
| `air` | Sky/cloud |
| `underground` | Underground stone |

Unknown terrain falls back to a generic dark tile (`#2a2a3a`).

When a tile image is unavailable the client falls back to solid fill colours:

| Terrain | Fallback colour |
|---------|----------------|
| `city` | `#4a5568` |
| `road` | `#8b7355` |
| `forest` | `#2d6a4f` |
| `deep_forest` | `#1b4332` |
| `field` | `#52b788` |
| `hills` | `#74c69d` |
| `mountain` | `#6c757d` |
| `water_swim` | `#4895ef` |
| `water_noswim` | `#023e8a` |
| `desert` | `#e9c46a` |
| `cave` | `#343a40` |
| `inside` | `#495057` |
| `air` | `#90e0ef` |
| `underground` | `#212529` |

A 4-character terrain abbreviation is overlaid on the fill when the tile is ≥ 28 px wide.

---

### 2.2 Room Description Panel (live-data)

**Accepts tags:** `Room`, `Room:Enter`, `Room:Leave`, `Room:ObjectAppear`,
`Room:ObjectVanish`

#### 2.2.1 Window state: live-data

The Room panel has the `live-data` retention policy:

- **No scrollback / no history.** The panel always shows exactly what is currently in
  the room.
- On a full `Room` message, all live state (`name`, `description`, `exits`, `mobs`,
  `players`, `objects`, `extras`) is replaced and `renderRoom()` re-renders from scratch.
- On delta events, the relevant in-memory map is updated and `renderRoom()` re-renders.
- Text from tags other than `Room*` is **never** written to this panel.
- The panel scrolls only when content overflows; it never grows beyond its allocated height.

#### 2.2.2 Panel structure

```
┌─────────────────────────────────────────────────┐
│ The Town Square                                  │  ← room name (h2)
│                                                  │
│ A broad cobblestone plaza bustles with trade...  │  ← room description
│                                                  │
│ Exits: [north] [south] [east] [west]             │  ← exit chips (clickable, send "go <dir>")
│                                                  │
│ ── Mobs ──────────────────────────────────────── │
│   ▸ a town guard                        [▼]      │  ← clickable entity row
│   ▸ a wounded soldier                   [▼]      │
│                                                  │
│ ── Players ───────────────────────────────────── │
│   ▸ Kelthas                             [▼]      │
│                                                  │
│ ── Objects ───────────────────────────────────── │
│   ▸ a rusty sword                       [▼]      │
│                                                  │
│ ── Extras ────────────────────────────────────── │
│   ▸ fountain                            [▼]      │
└─────────────────────────────────────────────────┘
```

#### 2.2.3 Clickable entity dropdowns

Each entity row has a `[▼]` button that opens a context dropdown. The dropdown items
are rendered from the `actions` array in the `Room` message for that entity. Clicking
an action sends the corresponding MUD command.

Standard action-to-command mappings:

| Action string | Command sent | Notes |
|---------------|-------------|-------|
| `look` | `look <keyword>` | Uses first keyword |
| `examine` | `examine <keyword>` | |
| `attack` | `kill <keyword>` | |
| `consider` | `consider <keyword>` | |
| `get` | `get <keyword>` | |
| `tell` | Pre-fills the command input with `tell <name> ` and focuses it | For players only |
| `group` | `group <name>` | For players only |
| `drink` | `drink <keyword>` | For objects with drink action |

The server may include additional or custom actions; the client renders these as-is and
sends `<action> <keyword>` verbatim.

#### 2.2.4 Extra descriptions

`extras` entries follow the same clickable row pattern. The only standard action for
extras is `look`, which sends `look <keyword>`. If the server provides additional
actions they are rendered in the dropdown.

#### 2.2.5 Exit chips

Each exit direction is rendered as a small chip/pill button labelled with its
abbreviation (`N`, `S`, `E`, `W`, `U`, `D`, `NE`, etc.). Clicking sends the direction
abbreviation as a MUD command (`n`, `s`, `e`, `w`, `u`, `d`, `ne`, etc.). Exits are
derived from the `Room.exits` array — they are not parsed from look text.

---

### 2.3 Main I/O Panel

**Accepts tags:** Everything **except** `Room*` and `Map*` (those go to their
dedicated panels). Also accepts unrecognised tags as a fallback.

- Standard scrollback history — all output is appended, never replaced.
- ANSI escape codes are rendered as coloured spans (existing behaviour).
- The command input bar lives at the bottom of this panel.
- `System` tagged messages are displayed with a distinct muted style (e.g. grey
  italic) to visually separate them from game content.
- `Communication:Tell` messages are displayed with a highlight colour (e.g. bright
  cyan) to make them easy to spot in the scroll.

---

## 3. Client-Side Routing Logic

```
onWebSocketMessage(event):
  if event.data is not valid JSON  →  treat as legacy v1 plain text, route to Main I/O
  msg = JSON.parse(event.data)
  if msg.v !== 2  →  handle as v1 (music, plain text), route to Main I/O

  category = msg.tag.split(':')[0]

  switch category:
    case 'Room'   →  routeRoom(msg)
    case 'Map'    →  routeMap(msg)
    case 'Music'  →  musicController.apply(msg)   // no display
    default       →  ioPanel.append(msg)
```

The `routeRoom` function drives Room-panel live-data updates:

```
routeRoom(msg):
  switch msg.tag:
    case 'Room':
      replace roomState.{name, description, exits, mobs, players, objects, extras}
      call renderRoom()
    case 'Room:Enter' | 'Room:ObjectAppear':
      add entity to appropriate roomState map
      call renderRoom()
    case 'Room:Leave' | 'Room:ObjectVanish':
      delete entity from appropriate roomState map
      call renderRoom()
```

`renderRoom()` always replaces `#room-content` innerHTML from scratch using the
current `roomState`. Because `roomState` is the single source of truth and has no
history, the panel always shows only what is currently in the room.

The `routeMap` function drives Map-panel live-data updates:

```
routeMap(msg):
  switch msg.tag:
    case 'Map':
      clear mapState.rooms, set currentId, hasScouted=false
      populate rooms from payload, schedule canvas redraw
    case 'Map:Scan':
      update mob_count on named rooms, schedule canvas redraw
    case 'Map:Scout':
      set hasScouted=true, merge additional rooms, schedule canvas redraw
```

The canvas is redrawn via `requestAnimationFrame` (coalesced — only one frame is
queued at a time regardless of how many map messages arrive per tick).

### 3.1 I/O panel styling by tag

| Tag | CSS class applied | Visual effect |
|-----|------------------|---------------|
| `System` | `io-system` | Muted grey italic |
| `Communication:Tell` | `io-tell` | Bright cyan (`#a5f3fc`) |
| All other tags | — | Default monospace colour |

---

## 4. TNG Codebase Integration Notes

The following summarises what the TNG server must do to support this specification.
(Full server-side implementation details are outside the scope of this document.)

1. **Wrap all output** in the JSON envelope described in §1.1 before sending over the
   WebSocket.
2. **Tag every output path.** A tagging table should be maintained in the server
   codebase mapping each `send_to_char`/`send_room`/etc. call site to an appropriate
   tag.
3. **Emit `Room` messages** after any command that produces look output: `look` (no
   arg), room entry (walk, teleport, portal, etc.), and any game event that changes the
   room description.
4. **Emit `Room:Enter` / `Room:Leave`** from the mob/player arrive/depart hooks so the
   room panel can update without a full re-look.
5. **Emit `Map` messages** whenever the player moves to a new room. Include the
   surrounding rooms up to 2 steps in each cardinal direction, with `mob_count` for
   each adjacent room derived from scan logic.
6. **Emit `Map:Scout`** (in addition to `Map`) when the player has the `scout` skill,
   extending coverage to 3 steps in each cardinal direction.
7. **Include `actions` arrays** on all entities in `Room` messages. The server knows
   which actions are legal for each entity type and the current player's class/level.
8. **Never send look output as plain `Communication` or `System` text** — look output
   must only appear in `Room`-tagged messages so it is correctly isolated to the room
   panel.

---

## 5. Terrain Tile Assets

Tile images live under `img/terrain/<terrain>.png` (or `.svg`). Each tile is 32 × 32
pixels. A sprite sheet (`img/terrain/sheet.png`) may be provided as an optimisation;
if present, the client uses CSS `background-position` to slice it.

Tile filenames match the terrain strings in §2.1.4 exactly
(e.g. `img/terrain/deep_forest.png`).

---

## 6. localStorage Keys

| Key | Type | Description |
|-----|------|-------------|
| `ack.panel.map.width` | px string | Map panel width |
| `ack.panel.room.width` | px string | Room panel width |
| `ack.panel.io.width` | px string | Main I/O panel width |
| `ack.panel.layout` | `"horizontal"` \| `"vertical"` | Current layout mode |
| `ack.map.scout` | `"true"` \| `"false"` | Whether the client has received scout data (mirrors server state) |

---

## 7. Versioning & Backwards Compatibility

- Worlds that do not send v2 JSON (legacy Telnet-only or v1 WebSocket worlds) continue
  to work as before: all output is routed to the Main I/O panel only, the Room and Map
  panels display a placeholder message ("No room data — legacy connection").
- The client detects the protocol version from the first valid JSON message received
  with `v: 2`. Until that message arrives, the client operates in v1 mode.
- The `v` field is reserved for future breaking changes. Minor, backwards-compatible
  additions (new tags, new fields in existing payloads) do not require a version bump.
