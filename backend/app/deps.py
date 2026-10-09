from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from fastapi import Request

from . import db
from .alert_sink import IAlertSink
from .storage import BlobStore


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    """One SQLite connection per request.

    Endpoints are sync functions, which FastAPI runs on a thread pool. A single
    sqlite3.Connection shared by those threads is not safe for concurrent use:
    a page that fires several requests at once (the dashboard board loads one
    thumbnail per screen) intermittently failed with "sqlite3.InterfaceError:
    bad parameter or other API misuse", surfacing as HTTP 500s. Separate
    connections let SQLite do its own locking (WAL mode allows concurrent
    readers alongside a writer); multi-statement read-then-write sequences are
    still serialised in-process by repository.db_write_lock.
    """
    conn = db.connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_blob_store(request: Request) -> BlobStore:
    return request.app.state.blob_store


def get_alert_sink(request: Request) -> IAlertSink:
    return request.app.state.alert_sink
