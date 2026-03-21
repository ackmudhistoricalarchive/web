#!/usr/bin/env python3
"""Integration tests for web_who_server.py and deployment tooling."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
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

    def test_wol_players_page_200(self) -> None:
        self._assert_ok_contains("/players", "Who's Online")

    def test_wol_who_alias_200(self) -> None:
        status, _ = self._get("/who")
        self.assertEqual(status, 200)

    def test_wol_mud_client_200(self) -> None:
        self._assert_ok_contains("/mud", "AHA: World of Lore")

    def test_wol_map_200(self) -> None:
        self._assert_ok_contains("/map", "World Map")

    def test_wol_world_map_alias_200(self) -> None:
        status, _ = self._get("/world-map")
        self.assertEqual(status, 200)

    def test_wol_stories_200(self) -> None:
        self._assert_ok_contains("/stories", "Tales from the Age of Monuments")

    def test_wol_reference_200(self) -> None:
        status, body = self._get("/reference/")
        self.assertEqual(status, 200)
        self.assertIn("Help", body)

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

    def test_aha_map_404(self) -> None:
        status, _ = self._get_aha("/map")
        self.assertEqual(status, 404)

    def test_aha_stories_404(self) -> None:
        status, _ = self._get_aha("/stories")
        self.assertEqual(status, 404)

    def test_aha_reference_404(self) -> None:
        status, _ = self._get_aha("/reference/")
        self.assertEqual(status, 404)

    def test_aha_reference_help_404(self) -> None:
        status, _ = self._get_aha("/reference/help/")
        self.assertEqual(status, 404)

    def test_aha_reference_shelp_404(self) -> None:
        status, _ = self._get_aha("/reference/shelp/")
        self.assertEqual(status, 404)

    def test_aha_reference_lore_404(self) -> None:
        status, _ = self._get_aha("/reference/lore/")
        self.assertEqual(status, 404)

    def test_aha_has_github_link(self) -> None:
        _, body = self._get_aha("/")
        self.assertIn("github.com/ackmudhistoricalarchive", body)

    def test_aha_has_wol_link(self) -> None:
        _, body = self._get_aha("/")
        self.assertIn("ackmud.com", body)

    def test_aha_who_404(self) -> None:
        status, _ = self._get_aha("/who")
        self.assertEqual(status, 404)

    def test_aha_mud_404(self) -> None:
        status, _ = self._get_aha("/mud")
        self.assertEqual(status, 404)

    # ------------------------------------------------------------------
    # Legacy URL redirects (WOL site)
    # ------------------------------------------------------------------

    def test_help_redirects_to_reference(self) -> None:
        self._assert_redirect("/help/", "/reference/help/")

    def test_shelp_redirects_to_reference(self) -> None:
        self._assert_redirect("/shelp/", "/reference/shelp/")

    def test_lore_redirects_to_reference(self) -> None:
        self._assert_redirect("/lore/", "/reference/lore/")

    def test_helps_redirects_to_reference(self) -> None:
        self._assert_redirect("/helps/", "/reference/help/")

    def test_shelps_redirects_to_reference(self) -> None:
        self._assert_redirect("/shelps/", "/reference/shelp/")

    def test_lores_redirects_to_reference(self) -> None:
        self._assert_redirect("/lores/", "/reference/lore/")

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

    def test_wol_home_has_nav_links(self) -> None:
        _, body = self._get("/")
        self.assertIn("/mud", body)
        self.assertIn("/who", body)
        self.assertIn("/map", body)
        self.assertIn("/stories", body)
        self.assertIn("/reference", body)

    def test_aha_home_has_wol_nav_link(self) -> None:
        _, body = self._get_aha("/")
        self.assertIn("ackmud.com", body)

    def test_mud_client_contains_world_options(self) -> None:
        _, body = self._get("/mud")
        self.assertIn("ackmud.com", body)
        self.assertIn("9890", body)  # ACK!TNG port

    def test_reference_search_form_present(self) -> None:
        _, body = self._get("/reference/help/")
        self.assertIn("<form", body)
        self.assertIn("name='q'", body)

    def test_reference_search_query_filters(self) -> None:
        """Searching for a nonexistent term should say no matches."""
        _, body = self._get("/reference/help/?q=zzzznonexistenttopiczzz")
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
