"""Single-repository metadata, legacy Pages deadlines and loopback route checks."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

import deploy
import legacy_pages
import suite_release as suite
import update


def source(sha, site, identifier):
    return {"repository": suite.REPOSITORY, "gitSha": sha, "ci": {
        "artifactName": site, "artifactDigest": "sha256:" + "b" * 64, "artifactId": identifier,
        "headSha": sha, "runId": 41, "conclusion": "success"}}


class SuiteTests(unittest.TestCase):
    def test_accepts_single_sha_and_rejects_mixed_release(self):
        sha = "a" * 40
        manifest = {"schemaVersion": 2, "version": "test", "cliRunId": 101,
                    "archive": {"fileName": "wisplab-test.tar.gz", "sha256": "3" * 64},
                    "sources": {site: source(sha, "web-dist-" + site, i + 1)
                                for i, site in enumerate(suite.WEB_APPS)},
                    "blotlens": {**source(sha, "blotlens-linux", 4), "sha256": "f" * 64}}
        self.assertEqual(update.validate_manifest(manifest, suite.REPOSITORY), manifest)
        with self.assertRaises(update.UpdateError):
            update.validate_manifest(manifest, update.REPOSITORY)
        manifest["sources"]["pcr"]["ci"]["runId"] += 1
        with self.assertRaises(update.UpdateError):
            update.validate_manifest(manifest, suite.REPOSITORY)

    def test_origin_export_window_and_redirect(self):
        cutover = datetime(2026, 1, 1, tzinfo=timezone.utc)
        csp = """<meta http-equiv="Content-Security-Policy" content="script-src 'self'">"""
        frozen = f"<html><head>{csp}</head><body><main>saved</main></body></html>"

        def unpack(archive, sha, version, destination):
            for site in suite.WEB_APPS:
                (destination / site).mkdir()
                (destination / site / "index.html").write_text(frozen)
                (destination / site / "app.js").write_bytes(b"original")

        with tempfile.TemporaryDirectory() as temp, \
                patch.object(legacy_pages, "load_release", return_value=({"schemaVersion": 1, "version": "v1",
                    "archive": {"sha256": "a" * 64}}, Path("test.tar.gz"), {})), \
                patch.object(deploy, "read_archive", side_effect=unpack):
            root = Path(temp).resolve()
            for site, project in legacy_pages.PROJECTS.items():
                for days, mode in ((-1, "frozen"), (0, "export-window"), (29, "export-window"), (30, "redirect")):
                    with self.subTest(site=site, days=days):
                        out = root / site / str(days)
                        result = legacy_pages.build(site, root, cutover, out, cutover + timedelta(days=days))
                        self.assertEqual(result["mode"], mode)
                        index = (out / "index.html").read_text()
                        if days < 30:
                            self.assertIn(csp, index)
                            self.assertIn("<main>saved", index)
                            self.assertEqual((out / "app.js").read_bytes(), b"original")
                        if days < 0:
                            self.assertEqual(index, frozen)
                            self.assertEqual({f.name for f in out.iterdir()}, {"index.html", "app.js"})
                            continue

                        # The same absolute project URL works for 404s at any nesting depth.
                        missing = (out / "404.html").read_text()
                        tag = f'<script src="/{project}/legacy-redirect.js" data-target="https://{site}.wisplab.top/"'
                        for html in (index, missing):
                            self.assertIn(tag, html)
                            self.assertNotIn("location.replace(", html)
                            self.assertEqual("data-deadline=" in html, days < 30)
                        self.assertEqual((out / "legacy-redirect.js").read_bytes(), legacy_pages.REDIRECT_SCRIPT.read_bytes())
                        if days < 30:
                            self.assertIn(f'href="/{project}/"', missing)
                            self.assertIn('data-deadline="1769817600000"', index)
                        else:
                            self.assertEqual(index, missing)
                            self.assertFalse((out / "app.js").exists())

    @unittest.skipUnless(shutil.which("caddy"), "Set PATH to a Caddy binary for the HTTP rehearsal")
    def test_real_caddy_preserves_origin_and_api_path(self):
        class Backend(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                received = json.loads(self.rfile.read(length))
                body = json.dumps([self.path, self.headers["Origin"], received]).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass

        with tempfile.TemporaryDirectory() as temp, ThreadingHTTPServer(("127.0.0.1", 0), Backend) as backend:
            root = Path(temp).resolve()
            threading.Thread(target=backend.serve_forever, daemon=True).start()
            current = root / "current"
            config = deploy.caddy_snippet(root).decode()
            addresses = {}
            for site, host in deploy.SITES.items():
                folder = current / site
                folder.mkdir(parents=True)
                (folder / "index.html").write_text(site)
                with closing(socket.socket()) as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                addresses[site] = f"http://127.0.0.1:{port}"
                config = config.replace(host + " {", addresses[site] + " {", 1)
            embedded = current / "wb/blotlens"
            embedded.mkdir()
            (embedded / "index.html").write_text("manual-review")
            config = config.replace("/etc/caddy/wisplab-cloud/*.caddy", str(root / "cloud/*.caddy"))
            config = config.replace("127.0.0.1:4319", "127.0.0.1:" + str(backend.server_port))
            config_file = root / "Caddyfile"
            config_file.write_text("{\n admin off\n auto_https off\n}\n" + config)
            env = {**os.environ, "XDG_DATA_HOME": str(root / "data"), "XDG_CONFIG_HOME": str(root / "config")}
            with tempfile.TemporaryFile() as log:
                process = subprocess.Popen(["caddy", "run", "--config", str(config_file), "--adapter", "caddyfile"],
                                           stdout=log, stderr=log, env=env)
                try:
                    for _ in range(100):
                        if process.poll() is not None:
                            log.seek(0)
                            self.fail(log.read().decode())
                        try:
                            with urlopen(addresses["wb"], timeout=.5) as response:
                                self.assertEqual(response.read(), b"wb")
                            break
                        except OSError:
                            time.sleep(.05)
                    for site, addr in addresses.items():
                        with urlopen(addr, timeout=3) as response:
                            self.assertEqual(response.read().decode(), site)
                    with urlopen(addresses["wb"] + "/blotlens/") as response:
                        self.assertEqual(response.read(), b"manual-review")
                    request = Request(addresses["wb"] + "/blotlens/api/mock", data=b'{"example":"synthetic"}',
                                      headers={"Origin": addresses["wb"], "Content-Type": "application/json"})
                    with urlopen(request, timeout=3) as response:
                        self.assertEqual(json.load(response), ["/api/mock", addresses["wb"], {"example": "synthetic"}])
                finally:
                    process.terminate()
                    process.wait(timeout=10)
                    backend.shutdown()
