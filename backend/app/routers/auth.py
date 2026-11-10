"""ログイン状態の確認と、ブラウザ UI 用のログイン(API キー → HttpOnly クッキー)。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import audit, auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    api_key: str


class Me(BaseModel):
    mode: str  # off | required
    authenticated: bool
    name: str | None = None
    role: str | None = None
    source: str | None = None


@router.get("/me", response_model=Me)
def me(request: Request) -> Me:
    """UI が最初に呼ぶ。未ログインでも 401 にせず、authenticated=false を返す。"""
    mode = auth.auth_mode()
    principal = auth.current_principal(request)
    if principal is None:
        return Me(mode=mode, authenticated=False)
    return Me(mode=mode, authenticated=True, name=principal.name, role=principal.role, source=principal.source)


@router.post("/login", response_model=Me)
def login(body: LoginRequest, request: Request, response: Response) -> Me:
    if auth.auth_mode() == "off":
        return Me(mode="off", authenticated=True, name=auth.ANONYMOUS.name, role=auth.ANONYMOUS.role,
                  source=auth.ANONYMOUS.source)
    user = auth.find_by_key(body.api_key.strip(), auth.load_users())
    ip = request.client.host if request.client else None
    if user is None:
        audit.record("login_failed", method="POST", path="/api/auth/login", status=401, ip=ip)
        raise HTTPException(401, "API キーが正しくありません。")
    audit.record("login", actor=user["name"], role=user["role"], source="key", method="POST",
                 path="/api/auth/login", status=200, ip=ip)
    # JS から読めないクッキー。別サイトからは送られない(SameSite=Strict)。画像(<img>)の読み込みにも付く。
    response.set_cookie(
        auth.COOKIE_NAME,
        body.api_key.strip(),
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        path="/",
    )
    return Me(mode="required", authenticated=True, name=user["name"], role=user["role"], source="key")


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    principal = auth.current_principal(request) if auth.auth_mode() == "required" else None
    if principal is not None:
        audit.record("logout", actor=principal.name, role=principal.role, source=principal.source, method="POST",
                     path="/api/auth/logout", status=204, ip=request.client.host if request.client else None)
    response.delete_cookie(auth.COOKIE_NAME, path="/")


@router.get("/audit", dependencies=[auth.admin])
def audit_log(limit: int = 100) -> dict:
    """監査ログ(新しい順)。admin だけ。本文・キー・クッキーは記録されていない。"""
    limit = max(1, min(limit, 500))
    return {"entries": audit.read_recent(limit)}
