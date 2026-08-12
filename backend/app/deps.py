from __future__ import annotations

import sqlite3

from fastapi import Request

from .alert_sink import IAlertSink
from .storage import BlobStore


def get_conn(request: Request) -> sqlite3.Connection:
    return request.app.state.conn


def get_blob_store(request: Request) -> BlobStore:
    return request.app.state.blob_store


def get_alert_sink(request: Request) -> IAlertSink:
    return request.app.state.alert_sink
