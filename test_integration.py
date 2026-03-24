#!/usr/bin/env python3
"""Integration tests for web_who_server.py and deployment tooling."""

from __future__ import annotations

import contextlib
import json
import os
import socket
import subprocess
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WEB_DIR))

import web_who_server  # noqa: E402  (import after sys.path modification)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """HTTP opener that does not follow redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


_no_redirect_opener = urllib.request.build_opener(_NoRedirect())


# ── Mock MUD server ────────────────────────────────────────────────────────────

_mock_gsgp_data: dict = {"name": "ACK!MUD TNG", "active_players": 0, "leaderboards": []}
_mock_wholist_html: str = "<h2>Players Online</h2>\n<ul>\n</ul>"


class _MockMUDHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/gsgp":
            body = json.dumps(_mock_gsgp_data, separators=(",", ":")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/who":
            body = _mock_wholist_html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404, "Not Found")

    def log_message(self, fmt: str, *args: object) -> None:
        return


class _MockMUDServer:
    """Context manager that runs a mock MUD server and patches ACKTNG_GAME_URL."""

    def __init__(self) -> None:
        self.port = _free_port()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._original_url: str = ""

    def __enter__(self) -> "_MockMUDServer":
        self._server = ThreadingHTTPServer(("127.0.0.1", self.port), _MockMUDHandler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        self._original_url = web_who_server.ACKTNG_GAME_URL
        web_who_server.ACKTNG_GAME_URL = f"http://127.0.0.1:{self.port}"
        return self

    def __exit__(self, *_: object) -> None:
        web_who_server.ACKTNG_GAME_URL = self._original_url
        if self._server is not None:
            self._server.shutdown()


# ── Main test class ────────────────────────────────────────────────────────────

class ServerIntegrationTest(unittest.TestCase):
    """Spin up the real server on a random port and exercise every route."""

    port: int
    server: ThreadingHTTPServer
    _thread: threading.Thread

    @classmethod
    def setUpClass(cls) -> None:
        cls.port = _free_port()
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", cls.port), web_who_server.WhoRequestHandler
        )
        cls._thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get(self, path: str, host: str = "ackmud.com") -> tuple[int, str]:
        """Return (status_code, body) without following redirects."""
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, headers={"Host": host})
        try:
            resp = _no_redirect_opener.open(req)
            return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", errors="replace")

    def _get_aha(self, path: str) -> tuple[int, str]:
        """Fetch a path from the AHA site (aha.ackmud.com)."""
        return self._get(path, host="aha.ackmud.com")

    def _assert_ok_contains(self, path: str, *fragments: str, host: str = "ackmud.com") -> None:
        status, body = self._get(path, host=host)
        self.assertEqual(status, 200, f"Expected 200 for {path}, got {status}")
        for fragment in fragments:
            self.assertIn(
                fragment, body, f"Expected {fragment!r} in response body for {path}"
            )

    def _assert_redirect(self, path: str, location: str, host: str = "ackmud.com") -> None:
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, headers={"Host": host})
        try:
            _no_redirect_opener.open(req)
            self.fail(f"Expected redirect for {path} but got 200")
        except urllib.error.HTTPError as exc:
            self.assertEqual(
                exc.code, 302, f"Expected 302 for {path}, got {exc.code}"
            )
            self.assertEqual(
                exc.headers.get("Location"),
                location,
                f"Wrong redirect Location for {path}",
            )

    # ------------------------------------------------------------------
    # World of Lore site (ackmud.com)
    # ------------------------------------------------------------------

    def test_wol_home_page_200(self) -> None:
        self._assert_ok_contains("/", "AHA: World of Lore")

    def test_wol_home_redirect(self) -> None:
        self._assert_redirect("/home", "/")

    def test_wol_home_slash_redirect(self) -> None:
        self._assert_redirect("/home/", "/")

    def test_wol_players_404(self) -> None:
        status, _ = self._get("/players")
        self.assertEqual(status, 404)

    def test_wol_who_404(self) -> None:
        status, _ = self._get("/who")
        self.assertEqual(status, 404)

    def test_wol_mud_404(self) -> None:
        status, _ = self._get("/mud")
        self.assertEqual(status, 404)

    def test_wol_map_404(self) -> None:
        status, _ = self._get("/map")
        self.assertEqual(status, 404)

    def test_wol_world_map_404(self) -> None:
        status, _ = self._get("/world-map")
        self.assertEqual(status, 404)

    def test_wol_stories_404(self) -> None:
        status, _ = self._get("/stories")
        self.assertEqual(status, 404)

    def test_wol_reference_404(self) -> None:
        status, _ = self._get("/reference/")
        self.assertEqual(status, 404)

    def test_wol_no_github_link(self) -> None:
        _, body = self._get("/")
        self.assertNotIn("github.com/ackmudhistoricalarchive", body)

    def test_wol_has_aha_link(self) -> None:
        _, body = self._get("/")
        self.assertIn("aha.ackmud.com", body)

    # ------------------------------------------------------------------
    # AHA site (aha.ackmud.com)
    # ------------------------------------------------------------------

    def test_aha_home_page_200(self) -> None:
        self._assert_ok_contains("/", "ACKmud Historical Archive", host="aha.ackmud.com")

    def test_aha_acktng_200(self) -> None:
        self._assert_ok_contains("/acktng/", "ACK!TNG", host="aha.ackmud.com")

    def test_aha_acktng_map_200(self) -> None:
        self._assert_ok_contains("/acktng/map", "World Map", host="aha.ackmud.com")

    def test_aha_acktng_stories_200(self) -> None:
        self._assert_ok_contains("/acktng/stories", "Tales from the Age of Monuments", host="aha.ackmud.com")

    def test_aha_acktng_reference_200(self) -> None:
        status, body = self._get("/acktng/reference/", host="aha.ackmud.com")
        self.assertEqual(status, 200)
        self.assertIn("Help", body)

    def test_aha_acktng_reference_help_200(self) -> None:
        status, _ = self._get("/acktng/reference/help/", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_aha_acktng_reference_shelp_200(self) -> None:
        status, _ = self._get("/acktng/reference/shelp/", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_aha_acktng_reference_lore_200(self) -> None:
        status, _ = self._get("/acktng/reference/lore/", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_aha_top_level_map_404(self) -> None:
        status, _ = self._get_aha("/map")
        self.assertEqual(status, 404)

    def test_aha_top_level_reference_404(self) -> None:
        status, _ = self._get_aha("/reference/")
        self.assertEqual(status, 404)

    def test_aha_has_github_link(self) -> None:
        _, body = self._get_aha("/")
        self.assertIn("github.com/ackmudhistoricalarchive", body)

    def test_aha_has_wol_link(self) -> None:
        _, body = self._get_aha("/")
        self.assertIn("ackmud.com", body)

    def test_aha_acktng_who_200(self) -> None:
        status, _ = self._get("/acktng/who", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_aha_top_level_who_404(self) -> None:
        status, _ = self._get_aha("/who")
        self.assertEqual(status, 404)

    def test_aha_acktng_mud_200(self) -> None:
        status, _ = self._get("/acktng/mud", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_aha_top_level_mud_404(self) -> None:
        status, _ = self._get_aha("/mud")
        self.assertEqual(status, 404)

    # ------------------------------------------------------------------
    # Legacy URL redirects (AHA site)
    # ------------------------------------------------------------------

    def test_help_redirects_to_reference(self) -> None:
        self._assert_redirect("/acktng/help/", "/acktng/reference/help/", host="aha.ackmud.com")

    def test_shelp_redirects_to_reference(self) -> None:
        self._assert_redirect("/acktng/shelp/", "/acktng/reference/shelp/", host="aha.ackmud.com")

    def test_lore_redirects_to_reference(self) -> None:
        self._assert_redirect("/acktng/lore/", "/acktng/reference/lore/", host="aha.ackmud.com")

    def test_helps_redirects_to_reference(self) -> None:
        self._assert_redirect("/acktng/helps/", "/acktng/reference/help/", host="aha.ackmud.com")

    def test_shelps_redirects_to_reference(self) -> None:
        self._assert_redirect("/acktng/shelps/", "/acktng/reference/shelp/", host="aha.ackmud.com")

    def test_lores_redirects_to_reference(self) -> None:
        self._assert_redirect("/acktng/lores/", "/acktng/reference/lore/", host="aha.ackmud.com")

    # ------------------------------------------------------------------
    # Static image serving (both sites)
    # ------------------------------------------------------------------

    def test_logo_image_200_wol(self) -> None:
        status, _ = self._get("/img/ackmud_logo_transparent.png")
        self.assertEqual(status, 200)

    def test_logo_image_200_aha(self) -> None:
        status, _ = self._get_aha("/img/ackmud_logo_transparent.png")
        self.assertEqual(status, 200)

    def test_missing_image_404(self) -> None:
        status, _ = self._get("/img/does_not_exist.png")
        self.assertEqual(status, 404)

    # ------------------------------------------------------------------
    # 404 handling
    # ------------------------------------------------------------------

    def test_unknown_route_404_wol(self) -> None:
        status, _ = self._get("/this-does-not-exist")
        self.assertEqual(status, 404)

    def test_unknown_route_404_aha(self) -> None:
        status, _ = self._get_aha("/this-does-not-exist")
        self.assertEqual(status, 404)

    def test_post_returns_404(self) -> None:
        url = f"http://127.0.0.1:{self.port}/"
        req = urllib.request.Request(url, data=b"x", method="POST")
        try:
            urllib.request.urlopen(req)
            self.fail("Expected 404 for POST /")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)

    def test_post_update_gsgp_returns_404(self) -> None:
        """The /update/gsgp endpoint no longer exists."""
        url = f"http://127.0.0.1:{self.port}/update/gsgp"
        req = urllib.request.Request(
            url, data=b'{"active_players":1}', method="POST",
            headers={"Host": "ackmud.com"},
        )
        try:
            urllib.request.urlopen(req)
            self.fail("Expected 404 for POST /update/gsgp")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)

    def test_post_update_who_returns_404(self) -> None:
        """The /update/who endpoint no longer exists."""
        url = f"http://127.0.0.1:{self.port}/update/who"
        req = urllib.request.Request(
            url, data=b'{"who_html":"<li>A</li>"}', method="POST",
            headers={"Host": "ackmud.com"},
        )
        try:
            urllib.request.urlopen(req)
            self.fail("Expected 404 for POST /update/who")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)

    # ------------------------------------------------------------------
    # GSGP endpoint — fetches from MUD's /gsgp HTTP endpoint
    # ------------------------------------------------------------------

    def _get_json(self, path: str, host: str = "ackmud.com") -> tuple[int, dict]:
        """Return (status_code, parsed_json) for a JSON endpoint."""
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, headers={"Host": host})
        try:
            resp = _no_redirect_opener.open(req)
            return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, {}

    def test_gsgp_returns_200(self) -> None:
        status, _ = self._get("/acktng/gsgp", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_gsgp_slash_returns_200(self) -> None:
        status, _ = self._get("/acktng/gsgp/", host="aha.ackmud.com")
        self.assertEqual(status, 200)

    def test_gsgp_content_type_json(self) -> None:
        url = f"http://127.0.0.1:{self.port}/acktng/gsgp"
        req = urllib.request.Request(url, headers={"Host": "aha.ackmud.com"})
        resp = _no_redirect_opener.open(req)
        self.assertIn("application/json", resp.headers.get("Content-Type", ""))

    def test_gsgp_cors_header(self) -> None:
        url = f"http://127.0.0.1:{self.port}/acktng/gsgp"
        req = urllib.request.Request(url, headers={"Host": "aha.ackmud.com"})
        resp = _no_redirect_opener.open(req)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")

    def test_gsgp_fallback_structure(self) -> None:
        """When the MUD is unreachable the response must be valid JSON with required keys."""
        # Point at a port with nothing listening to simulate MUD being down
        original = web_who_server.ACKTNG_GAME_URL
        web_who_server.ACKTNG_GAME_URL = "http://127.0.0.1:1"
        try:
            status, data = self._get_json("/acktng/gsgp", host="aha.ackmud.com")
            self.assertEqual(status, 200)
            self.assertIn("name", data)
            self.assertIn("active_players", data)
            self.assertIn("leaderboards", data)
            self.assertEqual(data["name"], "ACK!MUD TNG")
            self.assertIsInstance(data["active_players"], int)
            self.assertIsInstance(data["leaderboards"], list)
        finally:
            web_who_server.ACKTNG_GAME_URL = original

    def test_gsgp_serves_mud_data(self) -> None:
        """When the MUD is reachable, /acktng/gsgp proxies the MUD's /gsgp response."""
        global _mock_gsgp_data
        original_data = _mock_gsgp_data.copy()
        _mock_gsgp_data = {
            "name": "ACK!MUD TNG",
            "active_players": 3,
            "leaderboards": [
                {"name": "Top Players by Level", "entries": [{"name": "Hero", "value": 50}]}
            ],
        }
        try:
            with _MockMUDServer():
                status, data = self._get_json("/acktng/gsgp", host="aha.ackmud.com")
                self.assertEqual(status, 200)
                self.assertEqual(data["active_players"], 3)
                self.assertEqual(len(data["leaderboards"]), 1)
        finally:
            _mock_gsgp_data = original_data

    def test_gsgp_not_on_wol_site(self) -> None:
        """The /gsgp endpoint is not exposed on the WOL site."""
        status, _ = self._get("/acktng/gsgp", host="ackmud.com")
        self.assertEqual(status, 404)

    # ------------------------------------------------------------------
    # Who page — fetches from MUD's /who HTTP endpoint
    # ------------------------------------------------------------------

    def test_who_fallback_shows_zero_players(self) -> None:
        """When the MUD is unreachable, /acktng/who shows 0 players online."""
        original = web_who_server.ACKTNG_GAME_URL
        web_who_server.ACKTNG_GAME_URL = "http://127.0.0.1:1"
        try:
            status, body = self._get("/acktng/who", host="aha.ackmud.com")
            self.assertEqual(status, 200)
            self.assertIn("Players online: 0", body)
        finally:
            web_who_server.ACKTNG_GAME_URL = original

    def test_who_serves_mud_who(self) -> None:
        """When the MUD is reachable, /acktng/who proxies the MUD's /who response."""
        global _mock_wholist_html
        original_html = _mock_wholist_html
        _mock_wholist_html = "<ul><li>Hero</li><li>Villain</li></ul>"
        try:
            with _MockMUDServer():
                status, body = self._get("/acktng/who", host="aha.ackmud.com")
                self.assertEqual(status, 200)
                self.assertIn("Hero", body)
                self.assertIn("Villain", body)
                self.assertIn("Players online: 2", body)
        finally:
            _mock_wholist_html = original_html

    # ------------------------------------------------------------------
    # Security: path traversal rejected
    # ------------------------------------------------------------------

    def test_path_traversal_in_img_404(self) -> None:
        status, _ = self._get("/img/../../etc/passwd")
        self.assertEqual(status, 404)

    def test_path_traversal_in_helps_404(self) -> None:
        status, _ = self._get("/helps/../../etc/passwd")
        self.assertEqual(status, 404)

    # ------------------------------------------------------------------
    # HTML content sanity checks
    # ------------------------------------------------------------------

    def test_wol_home_has_aha_nav_link(self) -> None:
        _, body = self._get("/")
        self.assertIn("aha.ackmud.com", body)

    def test_aha_home_has_wol_nav_link(self) -> None:
        _, body = self._get_aha("/")
        self.assertIn("ackmud.com", body)

    def test_aha_mud_client_contains_world_options(self) -> None:
        _, body = self._get("/acktng/mud", host="aha.ackmud.com")
        self.assertIn("ackmud.com", body)
        self.assertIn("18890", body)  # ACK!TNG WSS port (proxied via nginx)

    def test_wol_mud_client_no_game_servers(self) -> None:
        # WOL /mud/ is 404; ACK!TNG servers live on AHA
        status, _ = self._get("/mud")
        self.assertEqual(status, 404)

    def test_reference_search_form_present(self) -> None:
        _, body = self._get("/acktng/reference/help/", host="aha.ackmud.com")
        self.assertIn("<form", body)
        self.assertIn("name='q'", body)

    def test_reference_search_query_filters(self) -> None:
        """Searching for a nonexistent term should say no matches."""
        _, body = self._get("/acktng/reference/help/?q=zzzznonexistenttopiczzz", host="aha.ackmud.com")
        # Either "No topics match" or "No topics available" — both are fine
        self.assertTrue(
            "No topics" in body,
            "Expected a no-results message for bogus search query",
        )


class MakefileTest(unittest.TestCase):
    """Verify that the Makefile is syntactically valid and uses systemctl."""

    MAKEFILE = WEB_DIR / "Makefile"

    def test_makefile_exists(self) -> None:
        self.assertTrue(self.MAKEFILE.exists(), "Makefile not found")

    def test_make_dry_run_succeeds(self) -> None:
        """make -n must exit 0 (Makefile is parseable and target exists)."""
        result = subprocess.run(
            ["make", "-n"],
            cwd=str(WEB_DIR),
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"make -n failed:\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_make_uses_systemctl_restart(self) -> None:
        """The default make target must invoke systemctl restart."""
        result = subprocess.run(
            ["make", "-n"],
            cwd=str(WEB_DIR),
            capture_output=True,
            text=True,
        )
        self.assertIn(
            "systemctl restart",
            result.stdout,
            "Expected 'systemctl restart' in Makefile default target",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
