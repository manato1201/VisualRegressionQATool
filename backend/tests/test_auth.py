"""app/auth.py: API キー+役割、Cloudflare Access、fail-closed、ログイン(クッキー)、CLI。"""
from __future__ import annotations

import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "a.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")
    users_file = tmp_path / "auth_users.json"
    monkeypatch.setenv("VRQA_AUTH_FILE", str(users_file))
    monkeypatch.delenv("VRQA_AUTH", raising=False)
    monkeypatch.delenv(auth.TEAM_DOMAIN_ENV, raising=False)
    monkeypatch.delenv(auth.AUD_ENV, raising=False)
    return users_file


def make_client():
    from app.main import app

    return TestClient(app)


@pytest.fixture()
def keys(env, monkeypatch):
    """viewer / operator / admin の 3 人を作り、認証を required にして起動する。"""
    made = {role: auth.add_user(role, role) for role in auth.ROLES}
    monkeypatch.setenv("VRQA_AUTH", "required")
    with make_client() as client:
        yield client, made


def h(key: str) -> dict:
    return {"X-API-Key": key}


# ── off(既定)と fail-closed ────────────────────────────────────────────────────
def test_off_is_the_default_and_needs_no_key(env):
    with make_client() as client:
        assert client.get("/api/instructions").status_code == 200
        me = client.get("/api/auth/me").json()
        assert me["mode"] == "off" and me["role"] == "admin"


def test_required_without_users_refuses_to_start(env, monkeypatch):
    monkeypatch.setenv("VRQA_AUTH", "required")
    with pytest.raises(RuntimeError, match="ユーザーが 1 人もいません"):
        with make_client():
            pass


def test_invalid_mode_is_an_error(env, monkeypatch):
    monkeypatch.setenv("VRQA_AUTH", "yes")
    with pytest.raises(RuntimeError):
        auth.auth_mode()


# ── 役割 ──────────────────────────────────────────────────────────────────────
def test_health_and_login_state_are_open(keys):
    client, _ = keys
    assert client.get("/api/health").status_code == 200
    me = client.get("/api/auth/me").json()
    assert me == {"mode": "required", "authenticated": False, "name": None, "role": None, "source": None}


def test_no_key_and_wrong_key_are_401(keys):
    client, _ = keys
    assert client.get("/api/instructions").status_code == 401
    assert client.get("/api/instructions", headers=h("vrqa_wrong")).status_code == 401


def test_viewer_can_read_but_not_write(keys):
    client, k = keys
    assert client.get("/api/instructions", headers=h(k["viewer"])).status_code == 200
    assert client.post("/api/instructions", json={}, headers=h(k["viewer"])).status_code == 403


def test_operator_passes_auth_on_capture_endpoints_but_not_promote(keys):
    client, k = keys
    # 認証を通れば、中身の検証(422)に進む。403 ならここで止まっている。
    assert client.post("/api/instructions", json={}, headers=h(k["operator"])).status_code == 422
    assert client.post("/api/diffs/run", json={}, headers=h(k["operator"])).status_code == 422
    assert client.post("/api/references/promote", json={}, headers=h(k["operator"])).status_code == 403
    assert client.delete("/api/captures/none", headers=h(k["operator"])).status_code == 403


def test_admin_can_promote_and_delete(keys):
    client, k = keys
    assert client.post("/api/references/promote", json={}, headers=h(k["admin"])).status_code == 422
    assert client.delete("/api/captures/none", headers=h(k["admin"])).status_code == 404


def test_bearer_header_is_accepted(keys):
    client, k = keys
    r = client.get("/api/instructions", headers={"Authorization": f"Bearer {k['viewer']}"})
    assert r.status_code == 200


def test_image_endpoints_also_require_auth(keys):
    client, _ = keys
    assert client.get("/api/captures/x/image").status_code == 401
    assert client.get("/api/diffs/x/image").status_code == 401


# ── ログイン(クッキー)────────────────────────────────────────────────────────
def test_login_sets_httponly_strict_cookie_and_enables_session(keys):
    client, k = keys
    r = client.post("/api/auth/login", json={"api_key": k["operator"]})
    assert r.status_code == 200 and r.json()["role"] == "operator"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    # クッキーだけで(ヘッダー無しで)通る = <img src> でも読める
    assert client.get("/api/instructions").status_code == 200
    assert client.get("/api/auth/me").json()["name"] == "operator"
    client.post("/api/auth/logout")
    assert client.get("/api/instructions").status_code == 401


def test_login_with_wrong_key_is_401(keys):
    client, _ = keys
    assert client.post("/api/auth/login", json={"api_key": "nope"}).status_code == 401


def test_login_from_another_site_is_refused_by_origin_guard(keys):
    client, k = keys
    r = client.post("/api/auth/login", json={"api_key": k["viewer"]}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


def test_removed_user_loses_access_immediately(keys):
    client, k = keys
    assert client.get("/api/instructions", headers=h(k["viewer"])).status_code == 200
    assert auth.remove_user("viewer")
    assert client.get("/api/instructions", headers=h(k["viewer"])).status_code == 401


def test_only_the_hash_is_stored(keys, env):
    _, k = keys
    text = env.read_text(encoding="utf-8")
    assert all(key not in text for key in k.values())
    assert auth.hash_key(k["admin"]) in text


# ── Cloudflare Access ─────────────────────────────────────────────────────────
TEAM = "myteam.cloudflareaccess.com"
AUD = "aud-123"


@pytest.fixture()
def access(env, monkeypatch):
    """Access を有効にし、署名鍵だけテスト用に差し替える(ネットワークを使わない)。"""
    auth.add_user("carol", "operator", email="carol@example.com", with_key=False)
    auth.add_user("root", "admin")  # required にはユーザーが 1 人は要る
    monkeypatch.setenv("VRQA_AUTH", "required")
    monkeypatch.setenv(auth.TEAM_DOMAIN_ENV, f"https://{TEAM}/")
    monkeypatch.setenv(auth.AUD_ENV, AUD)
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(auth, "_signing_key", lambda token: private.public_key())

    def token(**over):
        now = int(time.time())
        claims = {"email": "carol@example.com", "aud": AUD, "iss": f"https://{TEAM}", "iat": now, "exp": now + 300}
        claims.update(over)
        return jwt.encode(claims, private, algorithm="RS256")

    with make_client() as client:
        yield client, token, private


def acc(token: str) -> dict:
    return {"Cf-Access-Jwt-Assertion": token}


def test_access_maps_email_to_role(access):
    client, token, _ = access
    assert client.get("/api/instructions", headers=acc(token())).status_code == 200
    assert client.post("/api/instructions", json={}, headers=acc(token())).status_code == 422  # operator
    assert client.post("/api/references/promote", json={}, headers=acc(token())).status_code == 403


def test_access_unregistered_email_is_403_not_auto_created(access):
    client, token, _ = access
    r = client.get("/api/instructions", headers=acc(token(email="stranger@example.com")))
    assert r.status_code == 403


def test_access_rejects_wrong_audience_issuer_and_expired(access):
    client, token, _ = access
    assert client.get("/api/instructions", headers=acc(token(aud="other"))).status_code == 401
    assert client.get("/api/instructions", headers=acc(token(iss="https://evil.example"))).status_code == 401
    assert client.get("/api/instructions", headers=acc(token(exp=int(time.time()) - 10))).status_code == 401


def test_access_rejects_hs256_and_unsigned_tokens(access):
    client, token, _ = access
    now = int(time.time())
    claims = {"email": "carol@example.com", "aud": AUD, "iss": f"https://{TEAM}", "iat": now, "exp": now + 300}
    hs = jwt.encode(claims, "secret" * 8, algorithm="HS256")
    assert client.get("/api/instructions", headers=acc(hs)).status_code == 401
    none = jwt.encode(claims, key=None, algorithm="none")
    assert client.get("/api/instructions", headers=acc(none)).status_code == 401


def test_access_header_is_ignored_when_access_is_not_configured(keys, monkeypatch):
    client, _ = keys  # Access 用の環境変数なし
    assert client.get("/api/instructions", headers=acc("anything")).status_code == 401


def test_invalid_access_token_does_not_fall_back_to_api_key(access):
    client, token, _ = access
    r = client.get("/api/instructions", headers={**acc(token(aud="other"))})
    assert r.status_code == 401


# ── CLI ───────────────────────────────────────────────────────────────────────
def test_cli_add_list_remove(env, capsys):
    assert auth._cli(["add", "--name", "dave", "--role", "viewer"]) == 0
    out = capsys.readouterr().out
    assert "vrqa_" in out
    assert auth._cli(["list"]) == 0
    listed = capsys.readouterr().out
    assert "dave" in listed and "vrqa_" not in listed  # 一覧にキーは出ない
    assert auth._cli(["add", "--name", "dave", "--role", "admin"]) == 1  # 重複
    assert auth._cli(["remove", "--name", "dave"]) == 0
    assert auth._cli(["remove", "--name", "dave"]) == 1


def test_no_key_user_needs_an_email(env):
    with pytest.raises(ValueError):
        auth.add_user("erin", "viewer", with_key=False)
