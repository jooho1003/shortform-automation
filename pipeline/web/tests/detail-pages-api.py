import json
import os
import threading
import unittest
import uuid
from pathlib import Path
from urllib.parse import urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor, build_opener

BASE = os.environ.get("DETAIL_PAGES_BASE_URL", "http://localhost:3123").rstrip("/")
if urlparse(BASE).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise RuntimeError("DETAIL_PAGES_BASE_URL must target localhost")
OPENER = build_opener(HTTPCookieProcessor(CookieJar()))


def call(method, path, body=None, origin=None, raw=None):
    data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    headers = {"Content-Type": "application/json"}
    headers["Origin"] = origin or BASE
    req = Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=60) as res:
            return res.status, json.loads(res.read().decode())
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode())
        except Exception:
            payload = {}
        return exc.code, payload


class DetailPagesAPI(unittest.TestCase):
    project_id = None

    def setUp(self):
        if not getattr(type(self), "_logged_in", False):
            key = (Path.home() / "AppData" / "Local" / "ShortformAutomation" / "detail-admin-key.txt").read_text(encoding="utf-8").strip()
            status, _ = call("POST", "/api/detail-admin", {"key": key}, origin=BASE)
            self.assertEqual(status, 200)
            type(self)._logged_in = True
        status, self.project = call("POST", "/api/detail-pages", {"title": "자동검증 임시 프로젝트", "client": "테스트", "product": "테스트"})
        self.assertEqual(status, 201)
        self.project_id = self.project["id"]

    def tearDown(self):
        if not self.project_id or not isinstance(self.project_id, str):
            return
        try:
            configured = os.environ.get("SHORTFORM_ROOT")
            root = ((Path(configured).resolve() if configured else Path(__file__).resolve().parents[3]) / "상세페이지").resolve()
            if uuid.UUID(self.project_id).version != 4:
                return
            target = (root / self.project_id / "프로젝트.json").resolve()
            if target.parent.parent != root or target.name != "프로젝트.json":
                return
            if target.is_file():
                target.unlink()
            if target.parent.is_dir() and not any(target.parent.iterdir()):
                target.parent.rmdir()
        except (OSError, ValueError):
            pass

    def payload(self, **changes):
        p = dict(self.project)
        p.update(changes)
        return p

    def test_lifecycle_revision_and_validation(self):
        status, got = call("GET", f"/api/detail-pages/{self.project_id}")
        self.assertEqual(status, 200); self.assertEqual(got["id"], self.project_id)
        status, got = call("PUT", f"/api/detail-pages/{self.project_id}", self.payload(title="변경된 제목", revision=1))
        self.assertEqual(status, 200); self.assertEqual(got["revision"], 2)
        status, _ = call("PUT", f"/api/detail-pages/{self.project_id}", self.payload(revision=1))
        self.assertEqual(status, 409)
        cases = [
            ({"deliveryUrl": "javascript:alert(1)"}, 400),
            ({"deadline": "2026-02-30"}, 400),
            ({"sections": [self.project["sections"][0], self.project["sections"][0]]}, 400),
            ({"status": "delivered"}, 400),
        ]
        for change, expected in cases:
            status, _ = call("PUT", f"/api/detail-pages/{self.project_id}", self.payload(revision=2, **change))
            self.assertEqual(status, expected)
        ready = [dict(s, review="ready") for s in self.project["sections"]]
        status, got = call("PUT", f"/api/detail-pages/{self.project_id}", self.payload(status="delivered", sections=ready, checks={"facts": True, "labels": True, "mobile": True, "rights": True}, deliveryUrl="https://example.com/final", revision=2))
        self.assertEqual(status, 200); self.assertEqual(got["status"], "delivered")

    def test_request_and_id_errors(self):
        status, _ = call("PUT", "/api/detail-pages/not-a-uuid", self.payload(revision=1)); self.assertEqual(status, 400)
        status, _ = call("GET", f"/api/detail-pages/{uuid.uuid4()}"); self.assertEqual(status, 404)
        status, _ = call("POST", "/api/detail-pages", raw=b"{"); self.assertEqual(status, 400)
        status, _ = call("PUT", f"/api/detail-pages/{self.project_id}", self.payload(revision=2), origin="https://evil.example"); self.assertEqual(status, 403)

    def test_concurrent_put_same_revision(self):
        results = []
        barrier = threading.Barrier(2)
        def worker(title):
            barrier.wait()
            try:
                results.append(call("PUT", f"/api/detail-pages/{self.project_id}", self.payload(title=title, revision=1))[0])
            except Exception:
                results.append(None)
        a = threading.Thread(target=worker, args=("동시 A",)); b = threading.Thread(target=worker, args=("동시 B",))
        a.start(); b.start(); a.join(); b.join()
        self.assertEqual(sorted(results), [200, 409])


if __name__ == "__main__":
    unittest.main(verbosity=2)
OPENER = build_opener(HTTPCookieProcessor(CookieJar()))
