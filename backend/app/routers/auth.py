"""ログイン状態の確認と、ブラウザ UI 用のログイン(API キー → HttpOnly クッキー)。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import auth

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
    if user is None:
        raise HTTPException(401, "API キーが正しくありません。")
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
def logout(response: Response) -> None:
    response.delete_cookie(auth.COOKIE_NAME, path="/")
