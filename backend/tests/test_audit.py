"""app/audit.py: 監査ログ(誰が・いつ・何をしたか)。本文・キー・クッキーは記録しない。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import audit, auth


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "a.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")
    monkeypatch.setenv("VRQA_AUTH_FILE", str(tmp_path / "auth_users.json"))
    monkeypatch.delenv("VRQA_AUTH", raising=False)
    return tmp_path


def client_for():
    from app.main import app

    return TestClient(app)


@pytest.fixture()
def keys(env, monkeypatch):
    made = {role: auth.add_user(role, role) for role in auth.ROLES}
    monkeypatch.setenv("VRQA_AUTH", "required")
    with client_for() as c:
        yield c, made


def h(key: str) -> dict:
    return {"X-API-Key": key}


def entries() -> list[dict]:
    p = audit.audit_path()
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def test_successful_write_is_recorded_with_who_and_what(keys):
    client, k = keys
    r = client.post("/api/instructions", json={"scene_or_level_id": "scene-1"}, headers=h(k["operator"]))
    assert r.status_code == 200
    e = [x for x in entries() if x.get("method") == "POST"][-1]
    assert (e["event"], e["actor"], e["role"], e["source"], e["path"], e["status"]) == (
        "http", "operator", "operator", "key", "/api/instructions", 200)
    assert e["ts"].endswith("+00:00") and e.get("ip")


def test_reads_and_health_are_not_recorded(keys):
    client, k = keys
    client.get("/api/instructions", headers=h(k["viewer"]))
    client.get("/api/health")
    client.get("/api/auth/me")
    assert entries() == []


def test_denied_writes_are_recorded_with_the_actor(keys):
    client, k = keys
    assert client.post("/api/references/promote", json={}, headers=h(k["operator"])).status_code == 403
    e = entries()[-1]
    assert (e["event"], e["actor"], e["role"], e["status"], e["path"]) == ("denied", "operator", "operator", 403, "/api/references/promote")


def test_unauthenticated_and_wrong_key_attempts_are_recorded_as_anonymous(keys):
    client, _ = keys
    client.get("/api/instructions")  # 読み取りでも、401 は記録する
    client.get("/api/instructions", headers=h("vrqa_wrong"))
    es = entries()
    assert [e["status"] for e in es] == [401, 401]
    assert all(e["actor"] == "anonymous" and e["event"] == "denied" for e in es)


def test_login_and_logout_are_recorded_once_with_the_name(keys):
    client, k = keys
    client.post("/api/auth/login", json={"api_key": "vrqa_wrong"})
    client.post("/api/auth/login", json={"api_key": k["viewer"]})
    client.post("/api/auth/logout")
    got = [(e["event"], e["actor"], e["status"]) for e in entries()]
    assert got == [("login_failed", "anonymous", 401), ("login", "viewer", 200), ("logout", "viewer", 204)]


def test_nothing_secret_is_written(keys, env):
    client, k = keys
    client.post("/api/auth/login", json={"api_key": k["admin"]})
    client.post("/api/instructions", json={"scene_or_level_id": "SECRET-BODY-TEXT"}, headers=h(k["operator"]))
    client.get("/api/instructions?token=SECRET-QUERY", headers=h("vrqa_secret_wrong_key_value"))
    text = audit.audit_path().read_text(encoding="utf-8")
    for secret in (*k.values(), "SECRET-BODY-TEXT", "SECRET-QUERY", "vrqa_secret_wrong_key_value"):
        assert secret not in text
    assert "?" not in "".join(json.loads(l)["path"] for l in text.splitlines()), "no query strings"


def test_foreign_origin_login_blocked_by_the_guard_is_recorded(keys):
    client, k = keys
    r = client.post("/api/auth/login", json={"api_key": k["viewer"]}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    e = entries()[-1]
    assert (e["event"], e["status"], e["path"]) == ("denied", 403, "/api/auth/login")


def test_audit_endpoint_is_admin_only_and_newest_first(keys):
    client, k = keys
    client.post("/api/instructions", json={"scene_or_level_id": "a"}, headers=h(k["operator"]))
    client.post("/api/instructions", json={"scene_or_level_id": "b"}, headers=h(k["operator"]))
    assert client.get("/api/auth/audit", headers=h(k["viewer"])).status_code == 403
    assert client.get("/api/auth/audit", headers=h(k["operator"])).status_code == 403
    assert client.get("/api/auth/audit").status_code == 401
    r = client.get("/api/auth/audit?limit=2", headers=h(k["admin"]))
    assert r.status_code == 200
    es = r.json()["entries"]
    assert len(es) == 2 and es[0]["ts"] >= es[1]["ts"]
    # 監査ログの読み出し自体は(読み取りなので)記録されない
    assert not any(e["path"].startswith("/api/auth/audit") and e["event"] == "http" for e in entries())


def test_failure_to_write_does_not_break_the_request(keys, monkeypatch):
    client, k = keys
    monkeypatch.setenv("VRQA_AUDIT_LOG", str(Path(audit.audit_path()).parent))  # ディレクトリを指す = 書けない
    assert client.post("/api/instructions", json={"scene_or_level_id": "x"}, headers=h(k["operator"])).status_code == 200


def test_rotation_keeps_one_backup(env, monkeypatch):
    p = env / "audit.jsonl"
    monkeypatch.setenv("VRQA_AUDIT_LOG", str(p))
    monkeypatch.setattr(audit, "MAX_BYTES", 200)
    for i in range(20):
        audit.record("http", actor=f"u{i}", method="POST", path="/api/x", status=200)
    assert p.exists() and p.with_suffix(".jsonl.1").exists()
    assert len(audit.read_recent(500)) >= 1


def test_read_recent_skips_broken_lines(env, monkeypatch):
    p = env / "audit.jsonl"
    monkeypatch.setenv("VRQA_AUDIT_LOG", str(p))
    p.write_text('{"event":"a"}\nnot json\n{"event":"b"}\n', encoding="utf-8")
    assert [e["event"] for e in audit.read_recent(10)] == ["b", "a"]


def test_off_mode_still_records_writes_as_anonymous(env):
    with client_for() as client:
        client.post("/api/instructions", json={"scene_or_level_id": "s"})
    e = entries()[-1]
    assert (e["actor"], e["role"], e["source"]) == ("anonymous", "admin", "anonymous")
