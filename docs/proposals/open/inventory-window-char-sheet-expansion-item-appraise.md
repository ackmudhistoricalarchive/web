# Proposal: Inventory Window, Character Sheet Expansion, and Universal Item Appraise

## Problem

Three related gaps in the web client's v2 UI:

1. **No inventory window.** The `Inventory` tag is currently routed to the Main I/O panel as raw text. There is no structured floating window for it analogous to the Equipment window.
2. **Thin character sheet.** The Character window shows HP/MP/MV bars, stats, classes, gold/exp/QP, and position — but omits many fields visible on the in-game `score` command (alignment, AC, hitroll/damroll, kills/deaths, age, etc.).
3. **Appraise popup is equipment-only.** Item stat tooltips (the appraise popup) only appear when hovering over items in the Equipment window. Items on the ground (Room panel), in inventory, and carried by mobs are not hoverable for stats.

---

## Approach

### 1. Inventory Window

Add a new floating window (`inv-window`) that mirrors the Equipment window pattern. It handles a new structured `Inventory` tag payload.

**Wire format change:** `Inventory` tag must carry a structured `data` object (not plain ANSI text) when targeting the window. The server emits this after the player types `inv`/`inventory`.

```json
{
  "v": 2,
  "tag": "Inventory",
  "data": {
    "items": [
      {
        "id": "sword_5",
        "short_descr": "@@Ga rusty sword@@N",
        "type": "weapon",
        "item_class": "one-hand sword",
        "level": 5,
        "weight": 3.0,
        "cost": 50,
        "damage_min": 2,
        "damage_max": 6,
        "damage_avg": 4,
        "armor_class": null,
        "affects": [{"stat": "hitroll", "modifier": 1}],
        "keywords": ["sword", "rusty"]
      }
    ]
  }
}
```

Each item in `items` has the same shape as equipment slot items (used by the existing appraise popup). The inventory window renders a simple list: `short_descr` per row, hoverable for the appraise popup. Unlike the equipment window there are no slot labels — just item name rows.

**Toolbar button:** `Inv` added next to `Equip`. Hidden on v1 / disconnected, shown on v2 connect (like Equip and Char).

**localStorage keys added:**
- `ack.win.inv.pos`
- `ack.win.inv.size`

**Default position:** offset slightly from the equip window default so they don't stack exactly.

---

### 2. Expanded Character Sheet

The `Score` tag payload is extended with additional fields. All new fields are optional — the client renders them when present and omits the section when absent, so older servers that don't send them continue to work.

**New fields added to `Score` payload:**

| Field | Type | Description |
|-------|------|-------------|
| `alignment` | integer | Raw alignment value (-1000 to 1000) |
| `alignment_label` | string | Human-readable label, e.g. `"Good"` |
| `age` | integer | Character age in game-years |
| `ac` | integer | Armor class |
| `hitroll` | integer | Hit roll bonus |
| `damroll` | integer | Damage roll bonus |
| `kills` | integer | Total kill count |
| `deaths` | integer | Total death count |
| `pkills` | integer | PvP kill count |
| `pdeaths` | integer | PvP death count |
| `saves_spell` | integer | Saving throw vs. spell |
| `saves_breath` | integer | Saving throw vs. breath |
| `saves_rod` | integer | Saving throw vs. rod |
| `bank_gold` | integer | Gold in bank |

**Rendered layout additions (below existing content):**

```
Combat       HR:+5  DR:+8  AC:-42
Saves        Spell:-3  Breath:-5  Rod:-2
Alignment    Good (430)
Age          42 years
KD           Kills:120  Deaths:4  PK:2  PKD:0
Bank         42,000 gold
```

These sections are appended after the existing content in `renderScorePanel`. They use `char-row` styled `div` elements (new CSS class, small monospace label + value pairs).

---

### 3. Appraise Popup on Room Objects and Inventory Items

**Room objects:** The `Room` payload's `objects` array is extended to optionally carry the same item-stats fields as equipment items (same shape as the `Inventory` items above). When an object entry includes these fields, hovering over it in the Room panel shows the appraise popup using inline data (no server roundtrip).

Objects without inline stats (e.g. legacy server or unknown items) continue to behave as before — no popup, just clickable action dropdown.

**Inventory items:** Items in the inventory window include full stats by construction (see §1 payload above). Hover → appraise popup, same as equipment items.

**Mob-carried items:** Out of scope for this proposal. Mobs do not expose carried item data in the `Room` payload. A future `MobLook` tag could provide this when the player explicitly looks at a mob.

**Implementation:** The `buildEntityRow` function gains an optional `itemData` parameter. When non-null, it attaches `mouseenter`/`mouseleave`/`mousemove` listeners on the entity name span (same pattern as equipment items). The appraise popup reuses the existing `renderAppraisePopup` function unchanged.

---

## Affected Files

- `web/templates/mud_client.html` — all changes are here:
  - HTML: new `inv-window` block, new `toggle-inv-btn`
  - JS: `renderInventoryPanel()`, extended `renderScorePanel()`, extended `buildEntityRow()`, updated `handleMessage()`, `showV2Windows()`, `hideV2Windows()`, `loadWindowPositions()`, ResizeObserver block, init block
  - CSS (in `base.html`): `.inv-content` (same as `.equip-content`), `.char-row` / `.char-row-label` / `.char-row-val`, no other new classes needed

---

## Trade-offs

| Decision | Alternative | Reason chosen |
|----------|-------------|---------------|
| Inline item stats in `Room.objects` | Server roundtrip `appraise` on hover | Avoids spamming the server on every mouseover; consistent with how equipment stats work |
| `Inventory` as structured object | Keep routing to Main I/O as text | Enables hover stats, consistent with Equipment window pattern |
| New `Score` fields all optional | Require them | Server-side migration is independent; client degrades gracefully |
| Mob-carried items out of scope | Include via extended `Room` mob payload | Significantly more complex; mob inventory is not always knowable without a look command |

---

## Out of Scope

- Server-side implementation of any of these tag payloads (separate acktng/tngdb work)
- Changes to the tagging spec document (the spec should be updated as a follow-on once the approach is confirmed)
- Mob-carried item appraise
