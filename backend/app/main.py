from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .alert_sink import build_alert_sink_from_env
from .routers import captures, diffs, instructions, references, runs
from .storage import DEFAULT_BLOB_ROOT, BlobStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_path = os.environ.get("VRQA_DB_PATH", db.DEFAULT_DB_PATH)
    blob_root = os.environ.get("VRQA_BLOB_ROOT", DEFAULT_BLOB_ROOT)
    conn = db.connect(db_path)
    db.init_db(conn)
    app.state.conn = conn
    app.state.blob_store = BlobStore(blob_root)
    app.state.alert_sink = build_alert_sink_from_env()
    yield
    conn.close()


app = FastAPI(title="VisualRegressionQATool API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(instructions.router)
app.include_router(captures.router)
app.include_router(references.router)
app.include_router(diffs.router)
app.include_router(runs.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
