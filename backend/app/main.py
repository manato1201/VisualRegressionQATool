from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, db
from .alert_sink import build_alert_sink_from_env
from .config import cors_origins_from_env
from .routers import alerts, analysis, captures, diffs, instructions, references, runs
from .routers import auth as auth_router
from .security import install_request_guard
from .storage import DEFAULT_BLOB_ROOT, BlobStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_path = os.environ.get("VRQA_DB_PATH", db.DEFAULT_DB_PATH)
    blob_root = os.environ.get("VRQA_BLOB_ROOT", DEFAULT_BLOB_ROOT)
    # Schema/migrations run once here on a throwaway connection; requests open
    # their own (see deps.get_conn).
    init_conn = db.connect(db_path)
    try:
        db.init_db(init_conn)
    finally:
        init_conn.close()
    auth.ensure_auth_configured()  # VRQA_AUTH=required でユーザーが居なければ、ここで起動を止める
    app.state.db_path = db_path
    app.state.blob_store = BlobStore(blob_root)
    app.state.alert_sink = build_alert_sink_from_env()
    yield


app = FastAPI(title="VisualRegressionQATool API", version="0.1.0", lifespan=lifespan)

# 認証の無い API を、別サイトのページ(CSRF)や DNS rebinding から守る(app/security.py)。
# 先に入れる=内側。CORS を外側にして、拒否の応答にも CORS ヘッダが付くようにする。
install_request_guard(app, allowed_origins=cors_origins_from_env)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_from_env(),
    # ログインのクッキー(auth.COOKIE_NAME)を、許可した origin の UI から送れるようにする。
    # origins は明示したものだけ("*" は config で拒否済み)なので、credentials を許してよい。
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 認証(app/auth.py)。既定は off(従来どおり)。VRQA_AUTH=required で、全 API が viewer 以上を要求する。
# 変更系は各エンドポイントで operator / admin を足している。/api/health と /api/auth/* は認証なし。
app.include_router(auth_router.router)
for _router in (instructions, captures, references, diffs, runs, alerts, analysis):
    app.include_router(_router.router, dependencies=[auth.viewer])


@app.get("/api/health")
def health():
    return {"status": "ok"}
