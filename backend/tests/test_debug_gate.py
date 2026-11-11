"""開発者・デバッグ向けの機能(しきい値ラボ・フレーム連続性の検査)は、本番で既定で無効、有効にしても admin だけ(QL6)。

- off(ローカルの単独利用): 従来どおり使える
- required(本番): VRQA_DEBUG が無ければ、**ログインしている人は誰でも 404**(存在しない扱い。未認証は、ほかの /api/* と同じく先に 401)
- required + VRQA_DEBUG=1: viewer / operator は 403、admin は入口を通る、未認証は 401
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import audit, auth

PREVIEW = ("/api/diffs/preview", {"captured_image_id": "none"})
CONTINUITY = ("/api/analysis/continuity", {"captured_image_ids": ["a", "b", "c"]})
DEBUG_ROUTES = (PREVIEW, CONTINUITY)


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "a.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")
    monkeypatch.setenv("VRQA_AUTH_FILE", str(tmp_path / "auth_users.json"))
    monkeypatch.delenv("VRQA_AUTH", raising=False)
    monkeypatch.delenv(auth.DEBUG_ENV, raising=False)
    monkeypatch.delenv(auth.TEAM_DOMAIN_ENV, raising=False)
    monkeypatch.delenv(auth.AUD_ENV, raising=False)
    return tmp_path


def make_client():
    from app.main import app

    return TestClient(app)


@pytest.fixture()
def required(env, monkeypatch):
    """viewer / operator / admin の 3 人を作り、認証を required にして起動する(VRQA_DEBUG は未設定)。"""
    made = {role: auth.add_user(role, role) for role in auth.ROLES}
    monkeypatch.setenv("VRQA_AUTH", "required")
    with make_client() as client:
        yield client, made


def h(key: str) -> dict:
    return {"X-API-Key": key}


def passes_the_gate(response) -> bool:
    """入口(認証・権限・デバッグの有効化)を通ったか。通れば、あとは中身の都合(画像が無い 404 など)で返る。"""
    return response.status_code not in (401, 403) and response.json().get("detail") != "Not Found"


# ---- off(ローカルの単独利用)
def test_off_keeps_the_debug_features_available(env):
    with make_client() as client:
        for path, body in DEBUG_ROUTES:
            assert passes_the_gate(client.post(path, json=body)), path
        me = client.get("/api/auth/me").json()
        assert me["mode"] == "off" and me["debug"] is True


# ---- required + VRQA_DEBUG 未設定 = 既定で無効
def test_disabled_by_default_in_required_mode_even_for_admin(required):
    client, k = required
    for path, body in DEBUG_ROUTES:
        for role in auth.ROLES:
            r = client.post(path, json=body, headers=h(k[role]))
            assert (r.status_code, r.json()["detail"]) == (404, "Not Found"), (path, role)


def test_anonymous_gets_401_like_every_other_api_route(required):
    client, _ = required
    for path, body in DEBUG_ROUTES:
        assert client.post(path, json=body).status_code == 401  # /api/* 全体が viewer 以上を要求する(main.py)


def test_ui_is_told_debug_is_unavailable_to_everyone(required):
    client, k = required
    for role in auth.ROLES:
        assert client.get("/api/auth/me", headers=h(k[role])).json()["debug"] is False
    assert client.get("/api/auth/me").json()["debug"] is False
    assert client.post("/api/auth/login", json={"api_key": k["admin"]}).json()["debug"] is False


def test_other_operator_routes_are_not_affected(required):
    client, k = required
    assert client.get("/api/instructions", headers=h(k["viewer"])).status_code == 200


# ---- required + VRQA_DEBUG=1 = 有効にしても admin だけ
@pytest.fixture()
def debug_on(required, monkeypatch):
    monkeypatch.setenv(auth.DEBUG_ENV, "1")
    return required


def test_enabled_debug_is_admin_only(debug_on):
    client, k = debug_on
    for path, body in DEBUG_ROUTES:
        assert client.post(path, json=body).status_code == 401, path
        assert client.post(path, json=body, headers=h(k["viewer"])).status_code == 403, path
        assert client.post(path, json=body, headers=h(k["operator"])).status_code == 403, path
        assert passes_the_gate(client.post(path, json=body, headers=h(k["admin"]))), path


def test_ui_is_told_debug_is_available_only_to_admin_when_enabled(debug_on):
    client, k = debug_on
    got = {role: client.get("/api/auth/me", headers=h(k[role])).json()["debug"] for role in auth.ROLES}
    assert got == {"viewer": False, "operator": False, "admin": True}


def test_refused_attempts_on_debug_routes_are_audited(debug_on, env):
    client, k = debug_on
    client.post(*[PREVIEW[0]], json=PREVIEW[1], headers=h(k["operator"]))  # 403
    entries = [json.loads(line) for line in audit.audit_path().read_text(encoding="utf-8").splitlines()]
    assert any(e["event"] == "denied" and e["actor"] == "operator" and e["path"] == PREVIEW[0] and e["status"] == 403 for e in entries)


# ---- 環境変数の読み方
@pytest.mark.parametrize("value,expected", [("1", True), ("true", True), ("YES", True), (" on ", True),
                                            ("0", False), ("", False), ("no", False), ("false", False)])
def test_debug_env_parsing(env, monkeypatch, value, expected):
    monkeypatch.setenv(auth.DEBUG_ENV, value)
    assert auth.debug_enabled() is expected
