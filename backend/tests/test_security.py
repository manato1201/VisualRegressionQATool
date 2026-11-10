"""app/security.py: Host の許可リスト(DNS rebinding)と、変更操作の Origin 検査(CSRF)。"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.security import ALLOWED_HOSTS_ENV, host_only, origin_allowed, resolve_allowed_hosts


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "s.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")
    from app.main import app

    with TestClient(app) as c:
        yield c


BODY = {"name": "x"}  # 中身は問わない(ガードは検証より前に動く)


def test_host_only():
    assert host_only("127.0.0.1:8000") == "127.0.0.1"
    assert host_only("[::1]:8000") == "::1"
    assert host_only("Evil.Example:80") == "evil.example"


def test_unknown_host_is_refused(client):
    r = client.get("/api/health", headers={"Host": "evil.example"})
    assert r.status_code == 403
    assert ALLOWED_HOSTS_ENV in r.json()["detail"]


def test_loopback_host_is_allowed(client):
    assert client.get("/api/health", headers={"Host": "127.0.0.1:8000"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "localhost:8000"}).status_code == 200


def test_cross_site_post_is_refused(client):
    r = client.post("/api/instructions", json=BODY, headers={"Host": "127.0.0.1:8000", "Origin": "https://evil.example"})
    assert r.status_code == 403
    assert "Origin" in r.json()["detail"]


def test_null_origin_is_refused(client):
    r = client.post("/api/instructions", json=BODY, headers={"Host": "127.0.0.1:8000", "Origin": "null"})
    assert r.status_code == 403


def test_cors_listed_ui_origin_passes_the_guard(client):
    # 開発の UI(5173)から API(8000)へ。ガードを通れば、中身の検証で 422 になる(403 ではない)
    r = client.post("/api/instructions", json=BODY, headers={"Host": "127.0.0.1:8000", "Origin": "http://localhost:5173"})
    assert r.status_code != 403


def test_post_without_origin_passes_the_guard(client):
    # curl・Unity の撮影エージェント・CI はブラウザではないので Origin を付けない
    assert client.post("/api/instructions", json=BODY, headers={"Host": "127.0.0.1:8000"}).status_code != 403


def test_get_with_foreign_origin_is_not_blocked_by_the_guard(client):
    # 読み取りは CORS(応答を読ませない)で守る。ガードは変更操作だけ見る
    assert client.get("/api/health", headers={"Host": "127.0.0.1:8000", "Origin": "https://evil.example"}).status_code == 200


def test_env_can_add_a_host(client, monkeypatch):
    monkeypatch.setenv(ALLOWED_HOSTS_ENV, "testserver, qa.lan")
    assert "qa.lan" in resolve_allowed_hosts()
    assert client.get("/api/health", headers={"Host": "qa.lan:8000"}).status_code == 200


def test_origin_allowed_unit():
    assert origin_allowed("http://127.0.0.1:8000", "127.0.0.1:8000", [])
    assert not origin_allowed("http://127.0.0.1:9999", "127.0.0.1:8000", [])
    assert origin_allowed("http://localhost:5173/", "127.0.0.1:8000", ["http://localhost:5173"])
