"""app/security.py

認証を持たないローカルの API を、ブラウザ経由の攻撃から守る最小限の検査
(ToolOrchestrationHub の hub/security.py と同じ考え方。2026-11-10 に移植)。

ブラウザで別のサイトを開いているだけで、そのページのスクリプトが localhost の API を操作できてしまう:

1. **別サイトからの変更操作(CSRF)**: 基準画像の昇格・撮影指示の登録など、本文が単純な POST は
   プリフライトなしで送られ、実行される。
2. **DNS rebinding**: 攻撃者のドメインが 127.0.0.1 に解決されるようにして、応答を読む。

対策(どちらもブラウザが必ず付けるヘッダを見るだけ):
- **Host ヘッダの許可リスト**: 既定はループバックのみ。別のホスト名で開くときは環境変数
  ``VRQA_ALLOWED_HOSTS``(カンマ区切り。ポートは無視)に足す。
- **変更操作(POST/PUT/PATCH/DELETE)の Origin** が、(a) このリクエスト自身の Host と一致する、または
  (b) ``VRQA_CORS_ORIGINS`` に挙げた UI のオリジン(開発では http://localhost:5173)であること。
  Origin を付けないクライアント(curl・Unity の撮影エージェント・CI)はブラウザではないので通す。
  ``Origin: null`` は弾く。

これは**認証ではない**。複数人で使う場合は、この上に認証と役割(基準画像を昇格できる人など)が要る。
"""
from __future__ import annotations

import os
from collections.abc import Callable, Iterable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

ALLOWED_HOSTS_ENV = "VRQA_ALLOWED_HOSTS"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def host_only(host_header: str) -> str:
    """Host ヘッダからポートを除いたホスト名を小文字で返す(``[::1]:8000`` → ``::1``)。"""
    host = host_header.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host[1:end] if end != -1 else host
    if host.count(":") == 1:
        host = host.split(":", 1)[0]
    return host


def resolve_allowed_hosts(extra: Iterable[str] | None = None) -> frozenset[str]:
    """ループバック + 環境変数 VRQA_ALLOWED_HOSTS + 引数の許可ホスト。"""
    allowed = set(LOOPBACK_HOSTS)
    for item in [*os.environ.get(ALLOWED_HOSTS_ENV, "").split(","), *(extra or [])]:
        item = item.strip()
        if item:
            allowed.add(host_only(item))
    return frozenset(allowed)


def origin_allowed(origin: str, host_header: str, allowed_origins: Iterable[str]) -> bool:
    """Origin が自分の Host と同じ、または許可した UI のオリジンか。``null`` は常に不許可。"""
    value = origin.strip().lower().rstrip("/")
    if value == "null":
        return False
    if value.split("://", 1)[-1] == host_header.strip().lower():
        return True
    return value in {o.strip().lower().rstrip("/") for o in allowed_origins}


def install_request_guard(
    app: FastAPI, *, allowed_origins: Callable[[], Iterable[str]] | Iterable[str] = ()
) -> None:
    """全リクエストの Host と、変更操作の Origin を検査するミドルウェアを入れる。

    許可リストはリクエストごとに環境変数から引く(起動後に変えられるようにし、テストもしやすくする)。
    """

    def _origins() -> Iterable[str]:
        return allowed_origins() if callable(allowed_origins) else allowed_origins

    @app.middleware("http")
    async def request_guard(request: Request, call_next):
        host_header = request.headers.get("host", "")
        if host_only(host_header) not in resolve_allowed_hosts():
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        f"この Host では受け付けません: {host_header!r}。"
                        f"127.0.0.1 / localhost 以外のホスト名で開く場合は、環境変数 {ALLOWED_HOSTS_ENV} に追加してください"
                    )
                },
            )
        if request.method in UNSAFE_METHODS:
            origin = request.headers.get("origin")
            if origin is not None and not origin_allowed(origin, host_header, _origins()):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "他のサイトからの変更操作は受け付けません(Origin が一致しません)"},
                )
        return await call_next(request)
