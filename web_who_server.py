#!/usr/bin/env python3
"""Simple web server for exposing ACKMUD project and game reference webpages."""

from __future__ import annotations

import os
import base64
import json
import mimetypes
import sys
import urllib.request
import urllib.error
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, unquote, urlparse

HOST = "0.0.0.0"
PORT = int(os.environ.get("ACK_WEB_PORT", "8080"))
WEB_DIR = Path(__file__).resolve().parent
ACKTNG_DIR = Path.home() / "acktng"
ACKTNG_GAME_URL = os.environ.get("ACKTNG_GAME_URL", "http://localhost:8080")
HELP_DIR = ACKTNG_DIR / "help"
SHELP_DIR = ACKTNG_DIR / "shelp"
LORE_DIR = ACKTNG_DIR / "lore"
TEMPLATE_DIR = WEB_DIR / "templates"
IMG_DIR = WEB_DIR / "img"
MP3_DIR = WEB_DIR / "mp3"
_AHA_WORLD_TARGETS = [
    {"id": "acktng", "name": "ACK!TNG", "host": "ackmud.com", "port": 18890, "scheme": "wss"},
    {"id": "ack431", "name": "ACK! 4.3.1", "host": "ackmud.com", "port": 8891, "scheme": "ws"},
    {"id": "ack42", "name": "ACK! 4.2", "host": "ackmud.com", "port": 8892, "scheme": "ws"},
]
_WOL_WORLD_TARGETS: list[dict] = []

_template_cache: dict[str, tuple[int, str]] = {}
_template_lock = Lock()

_topic_names_cache: dict[Path, tuple[int, list[str]]] = {}
_topic_names_lock = Lock()

_topic_content_cache: dict[Path, tuple[int, str]] = {}
_topic_content_lock = Lock()

_logo_data_uri_cache: tuple[int, str] | None = None
_logo_data_uri_lock = Lock()

# ── Site constants ─────────────────────────────────────────────────────────────

_WOL_TAGLINE = "AHA: World of Lore &mdash; A living world forged in text and tradition."
_AHA_TAGLINE = "ACKmud Historical Archive &mdash; Preservation and interpretation of an enduring text-world tradition."

_WOL_NAV = (
    "<nav>"
    "<a href='/'>Home</a>"
    "<a href='https://discord.gg/T24UQV8h' target='_blank' rel='noopener noreferrer'>Discord</a>"
    "<a href='https://aha.ackmud.com/' target='_blank' rel='noopener noreferrer'>Historical Archive</a>"
    "</nav>"
)

_AHA_NAV = (
    "<nav>"
    "<a href='/'>Home</a>"
    "<a href='/acktng/'>ACK!TNG</a>"
    "<a href='/acktng/who/'>Who</a>"
    "<a href='/acktng/mud/'>MUD Client</a>"
    "<a href='/acktng/map/'>Map</a>"
    "<a href='/acktng/stories/'>Stories</a>"
    "<a href='/acktng/reference/'>Reference</a>"
    "<a href='https://discord.gg/T24UQV8h' target='_blank' rel='noopener noreferrer'>Discord</a>"
    "<a href='https://github.com/ackmudhistoricalarchive' target='_blank' rel='noopener noreferrer'>Github</a>"
    "<a href='https://ackmud.com/' target='_blank' rel='noopener noreferrer'>World of Lore</a>"
    "</nav>"
)


def _get_site(headers: object) -> str:
    """Return 'aha' for aha.ackmud.com, 'wol' for everything else."""
    host = (headers.get("Host", "") or "").lower().split(":")[0]  # type: ignore[attr-defined]
    return "aha" if host.startswith("aha.") else "wol"


class WhoRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler interface)
        parsed_url = urlparse(self.path)
        route = unquote(parsed_url.path)
        query = parse_qs(parsed_url.query)
        help_query = query.get("q", [""])[0].strip()
        site = _get_site(self.headers)

        if route in ("/home", "/home/"):
            self._redirect_to("/")
            return

        # Static assets — available on both sites
        if route.startswith("/img/"):
            self._send_static_image(route[len("/img/"):])
            return

        if route.startswith("/web/mp3/"):
            self._send_static_audio(route[len("/web/mp3/"):])
            return

        if site == "wol":
            self._handle_wol_route(route, help_query)
        else:
            self._handle_aha_route(route, help_query)

    def _handle_wol_route(self, route: str, help_query: str = "") -> None:
        """Routes served on ackmud.com — AHA: World of Lore (coming soon)."""
        if route in ("/",):
            self._send_html(
                _build_wol_home_page(),
                title="AHA: World of Lore",
                site="wol",
            )
            return

        self.send_error(404, "Not Found")

    def _handle_aha_route(self, route: str, help_query: str) -> None:
        """Routes served on aha.ackmud.com — ACKmud Historical Archive."""
        _PFX = "/acktng"

        if route in ("/",):
            self._send_html(
                _build_home_page(),
                title="ACKmud Historical Archive",
                site="aha",
            )
            return

        if route in ("/acktng", "/acktng/"):
            self._send_html(
                _build_acktng_page(),
                title="ACK!TNG — ACKmud Historical Archive",
                site="aha",
            )
            return

        if route in ("/acktng/gsgp", "/acktng/gsgp/"):
            self._send_gsgp()
            return

        if route in ("/acktng/players", "/acktng/players/", "/acktng/who", "/acktng/who/"):
            self._send_html(
                self._build_players_page(),
                title="Who's Online",
                site="aha",
            )
            return

        if route in ("/acktng/mud", "/acktng/mud/"):
            self._send_html(
                _build_mud_client_page(_AHA_WORLD_TARGETS),
                title="ACK!TNG — MUD Client",
                site="aha",
            )
            return

        if route in ("/acktng/map", "/acktng/map/", "/acktng/world-map", "/acktng/world-map/"):
            self._send_html(_build_world_map_page(), title="World Map", site="aha")
            return

        if route in ("/acktng/stories", "/acktng/stories/"):
            self._send_html(
                _build_stories_page(),
                title="Tales from the Age of Monuments",
                site="aha",
            )
            return

        if route in ("/acktng/help", "/acktng/help/", "/acktng/helps", "/acktng/helps/"):
            self._redirect_to("/acktng/reference/help/")
            return

        if route in ("/acktng/shelp", "/acktng/shelp/", "/acktng/shelps", "/acktng/shelps/"):
            self._redirect_to("/acktng/reference/shelp/")
            return

        if route in ("/acktng/lore", "/acktng/lore/", "/acktng/lores", "/acktng/lores/"):
            self._redirect_to("/acktng/reference/lore/")
            return

        if route in ("/acktng/reference", "/acktng/reference/"):
            self._send_html(
                _build_reference_page("help", help_query, prefix=_PFX),
                title="Help Topics",
                site="aha",
            )
            return

        if route in ("/acktng/reference/help", "/acktng/reference/help/"):
            self._send_html(
                _build_reference_page("help", help_query, prefix=_PFX),
                title="Help Topics",
                site="aha",
            )
            return

        if route in ("/acktng/reference/shelp", "/acktng/reference/shelp/"):
            self._send_html(
                _build_reference_page("shelp", help_query, prefix=_PFX),
                title="Spell Help Topics",
                site="aha",
            )
            return

        if route in ("/acktng/reference/lore", "/acktng/reference/lore/"):
            self._send_html(
                _build_reference_page("lore", help_query, prefix=_PFX),
                title="Lore Topics",
                site="aha",
            )
            return

        if route.startswith("/acktng/helps/"):
            topic = route[len("/acktng/helps/"):]
            self._send_topic_page("Help", HELP_DIR, topic, "reference/help", site="aha", prefix=_PFX)
            return

        if route.startswith("/acktng/shelps/"):
            topic = route[len("/acktng/shelps/"):]
            self._send_topic_page("Spell Help", SHELP_DIR, topic, "reference/shelp", site="aha", prefix=_PFX)
            return

        if route.startswith("/acktng/lores/"):
            topic = route[len("/acktng/lores/"):]
            self._send_lore_topic_page(topic, site="aha", prefix=_PFX)
            return

        self.send_error(404, "Not Found")

    def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler interface)
        self.send_error(404, "Not Found")

    def _redirect_to(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _send_lore_topic_page(self, topic: str, site: str = "aha", prefix: str = "") -> None:
        topic_path = _safe_topic_path(LORE_DIR, topic)
        if topic_path is None:
            self.send_error(404, "Not Found")
            return

        first_entry = _extract_first_lore_entry(_read_cached_topic(topic_path))
        body = (
            f"<h1>Lore: {escape(topic_path.name)}</h1>"
            f"<p><a href='{prefix}/reference/lore/'>Back to Lore index</a></p>"
            f"<pre>{escape(first_entry)}</pre>"
        )
        self._send_html(body, title=f"Lore: {topic_path.name}", site=site)

    def _send_topic_page(
        self, page_name: str, base_dir: Path, topic: str, base_route: str, site: str = "aha", prefix: str = ""
    ) -> None:
        topic_path = _safe_topic_path(base_dir, topic)
        if topic_path is None:
            self.send_error(404, "Not Found")
            return

        body = (
            f"<h1>{escape(page_name)}: {escape(topic_path.name)}</h1>"
            f"<p><a href='{prefix}/{escape(base_route)}/'>Back to {escape(page_name)} index</a></p>"
            f"<pre>{escape(_read_cached_topic(topic_path))}</pre>"
        )
        self._send_html(body, title=f"{page_name}: {topic_path.name}", site=site)

    def _send_html(self, body: str, title: str, site: str = "wol") -> None:
        page = _build_full_page(title=title, body=body, site=site)
        body_bytes = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def _send_static_image(self, image_name: str) -> None:
        image_path = _safe_topic_path(IMG_DIR, image_name)
        if image_path is None:
            self.send_error(404, "Not Found")
            return

        image_bytes = image_path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(image_path))
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(image_bytes)))
        self.end_headers()
        self.wfile.write(image_bytes)

    def _send_static_audio(self, filename: str) -> None:
        audio_path = _safe_topic_path(MP3_DIR, filename)
        if audio_path is None:
            self.send_error(404, "Not Found")
            return

        audio_bytes = audio_path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(audio_path))
        self.send_response(200)
        self.send_header("Content-Type", content_type or "audio/mpeg")
        self.send_header("Content-Length", str(len(audio_bytes)))
        self.end_headers()
        self.wfile.write(audio_bytes)

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _send_gsgp(self) -> None:
        try:
            with urllib.request.urlopen(f"{ACKTNG_GAME_URL}/gsgp", timeout=3) as resp:
                body_bytes = resp.read()
        except Exception as exc:
            print(f"[gsgp] fetch failed: {exc!r}", file=sys.stderr, flush=True)
            body_bytes = json.dumps(
                {"name": "ACK!MUD TNG", "active_players": 0, "leaderboards": []},
                separators=(",", ":"),
            ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body_bytes)

    def _build_players_page(self) -> str:
        who_html: str | None = None
        try:
            with urllib.request.urlopen(f"{ACKTNG_GAME_URL}/who", timeout=3) as resp:
                who_html = resp.read().decode("utf-8", errors="replace")
        except Exception as exc:
            print(f"[who] fetch failed: {exc!r}", file=sys.stderr, flush=True)

        content = ["<h1>Who's Online</h1>", "<p class='muted'>Live snapshot from in-game WHO output.</p>"]
        if who_html is not None:
            count = who_html.count("<li>")
            content.append(f"<p>Players online: {count}</p>")
            content.append(who_html)
        else:
            content.append("<p>Players online: 0</p>")
            content.append("<h2>Players Online</h2>\n<ul>\n</ul>")

        return "\n".join(content)


def _safe_topic_path(base_dir: Path, topic: str) -> Path | None:
    cleaned_topic = topic.strip().strip("/")
    if not cleaned_topic:
        return None

    candidate = (base_dir / cleaned_topic).resolve()
    if not candidate.is_file():
        return None

    if base_dir.resolve() not in candidate.parents:
        return None

    return candidate


def _extract_first_lore_entry(content: str) -> str:
    """Return only the first (unflagged) entry from a lore file.

    Lore files are structured as:
        keywords ...
        ---
        [first entry — universal prose]
        flags ...
        ---
        [subsequent city/faction-specific entries]

    This function skips the keywords header block and returns the text of
    the first entry only, stripping any trailing whitespace.
    """
    blocks = content.split("\n---\n")
    for i, block in enumerate(blocks):
        stripped = block.strip()
        if stripped.startswith("keywords "):
            # The next block is the first entry
            if i + 1 < len(blocks):
                return blocks[i + 1].strip()
            return ""
    # Fallback: no keywords header found — return the whole content
    return content.strip()


_REFERENCE_TABS = [
    ("help",  "Help",       "helps",  HELP_DIR,  "topic"),
    ("shelp", "Spell Help", "shelps", SHELP_DIR, "spell / skill"),
    ("lore",  "Lore",       "lores",  LORE_DIR,  "topic"),
]

_SEARCH_FORM_META: dict[str, tuple[str, str, str, str]] = {
    "helps":  ("Help:",  "help-q",  "topic",         "/reference/help/"),
    "shelps": ("SHelp:", "shelp-q", "spell / skill", "/reference/shelp/"),
    "lores":  ("Lore:",  "lore-q",  "topic",         "/reference/lore/"),
}


def _build_topic_index_page(title: str, route_base: str, base_dir: Path, query: str = "", prefix: str = "") -> str:
    label_text, input_id, placeholder, action = _SEARCH_FORM_META.get(
        route_base, (title + ":", route_base + "-q", "topic", f"/{route_base}/")
    )
    action = prefix + action
    search_form = (
        f"<section class='help-forms'>"
        f"<form method='get' action='{action}'>"
        f"<label for='{input_id}'>{escape(label_text)}</label>"
        f"<input id='{input_id}' name='q' placeholder='{escape(placeholder)}' value='{escape(query)}'>"
        f"<button type='submit'>Search</button>"
        f"</form>"
        f"</section>"
    )

    if not base_dir.exists() or not base_dir.is_dir():
        return f"{search_form}<h1>{escape(title)}</h1><p>No topics available.</p>"

    normalized_query = query.strip().lower()
    topic_names = _get_topic_names(base_dir)
    links = [
        f"<li><a href='{prefix}/{escape(route_base)}/{escape(name)}'>{escape(name)}</a></li>"
        for name in topic_names
        if not normalized_query or normalized_query in name.lower()
    ]

    if not links:
        if normalized_query:
            return f"{search_form}<h1>{escape(title)}</h1><p>No topics match <strong>{escape(query)}</strong>.</p>"
        return f"{search_form}<h1>{escape(title)}</h1><p>No topics available.</p>"

    query_blurb = ""
    if normalized_query:
        query_blurb = f"<p>Filtered by <strong>{escape(query)}</strong>.</p>"

    return f"{search_form}<h1>{escape(title)}</h1>{query_blurb}<ul>{''.join(links)}</ul>"


def _build_reference_page(active_tab: str, query: str = "", prefix: str = "") -> str:
    """Build the unified Reference page with Help / Spell Help / Lore sub-nav."""
    tab_parts = []
    for slug, label, _route, _dir, _ph in _REFERENCE_TABS:
        css_class = "active" if slug == active_tab else ""
        tab_parts.append(f"<a href='{prefix}/reference/{slug}/' class='{css_class}'>{label}</a>")
    sub_nav = f"<nav class='sub-nav'>{''.join(tab_parts)}</nav>"

    for slug, label, route_base, base_dir, placeholder in _REFERENCE_TABS:
        if slug == active_tab:
            index_html = _build_topic_index_page(f"{label} Topics", route_base, base_dir, query, prefix=prefix)
            return f"{sub_nav}{index_html}"

    # Fallback (should not happen)
    return sub_nav


def _build_home_page() -> str:
    return _load_template("home.html")


def _build_acktng_page() -> str:
    return _load_template("acktng.html")


def _build_wol_home_page() -> str:
    return _load_template("home_wol.html")


def _build_world_map_page() -> str:
    return _load_template("world_map.html")


def _build_stories_page() -> str:
    stories_dir = TEMPLATE_DIR / "stories"
    fragments = sorted(stories_dir.glob("*.html"))
    stories_html = "\n\n".join(p.read_text(encoding="utf-8", errors="replace") for p in fragments)
    return _load_template("stories.html").replace("__STORIES__", stories_html)


def _build_mud_client_page(world_targets: list[dict]) -> str:
    world_options = "".join(
        (
            f"<option value='{world['id']}' data-host='{world['host']}' data-port='{world['port']}' data-scheme='{world['scheme']}'>{world['name']} ({world['host']}:{world['port']})</option>"
        )
        for world in world_targets
    )
    return _load_template("mud_client.html").replace("__WORLD_OPTIONS__", world_options)


def _load_template(name: str) -> str:
    template_path = TEMPLATE_DIR / name
    mtime_ns = template_path.stat().st_mtime_ns

    with _template_lock:
        cached = _template_cache.get(name)
        if cached is not None and cached[0] == mtime_ns:
            return cached[1]

        content = template_path.read_text(encoding="utf-8", errors="replace")
        _template_cache[name] = (mtime_ns, content)
        return content


def _get_topic_names(base_dir: Path) -> list[str]:
    resolved_dir = base_dir.resolve()
    mtime_ns = resolved_dir.stat().st_mtime_ns

    with _topic_names_lock:
        cached = _topic_names_cache.get(resolved_dir)
        if cached is not None and cached[0] == mtime_ns:
            return cached[1]

        topic_names = sorted(path.name for path in resolved_dir.iterdir() if path.is_file())
        _topic_names_cache[resolved_dir] = (mtime_ns, topic_names)
        return topic_names


def _read_cached_topic(path: Path) -> str:
    resolved_path = path.resolve()
    mtime_ns = resolved_path.stat().st_mtime_ns

    with _topic_content_lock:
        cached = _topic_content_cache.get(resolved_path)
        if cached is not None and cached[0] == mtime_ns:
            return cached[1]

        content = resolved_path.read_text(encoding="utf-8", errors="replace")
        _topic_content_cache[resolved_path] = (mtime_ns, content)
        return content


def _build_full_page(title: str, body: str, site: str = "wol") -> str:
    tagline = _WOL_TAGLINE if site == "wol" else _AHA_TAGLINE
    nav = _WOL_NAV if site == "wol" else _AHA_NAV
    template = _load_template("base.html")
    return (
        template.replace("__TITLE__", escape(title))
        .replace("__BODY__", body)
        .replace("__SITE_LOGO_SRC__", _site_logo_src())
        .replace("__TAGLINE__", tagline)
        .replace("__NAV__", nav)
    )


def _site_logo_src() -> str:
    logo_path = IMG_DIR / "ackmud_logo_transparent.png"
    if not logo_path.exists() or not logo_path.is_file():
        return ""

    mtime_ns = logo_path.stat().st_mtime_ns

    global _logo_data_uri_cache
    with _logo_data_uri_lock:
        if _logo_data_uri_cache is not None and _logo_data_uri_cache[0] == mtime_ns:
            return _logo_data_uri_cache[1]

        encoded = base64.b64encode(logo_path.read_bytes()).decode("ascii")
        data_uri = f"data:image/png;base64,{encoded}"
        _logo_data_uri_cache = (mtime_ns, data_uri)
        return data_uri


def main() -> None:
    ThreadingHTTPServer((HOST, PORT), WhoRequestHandler).serve_forever()


if __name__ == "__main__":
    main()
