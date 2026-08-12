from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import db as db_module
from app.storage import BlobStore


@pytest.fixture()
def conn(tmp_path: Path) -> sqlite3.Connection:
    connection = db_module.connect(tmp_path / "test.sqlite3")
    db_module.init_db(connection)
    yield connection
    connection.close()


@pytest.fixture()
def blob_store(tmp_path: Path) -> BlobStore:
    return BlobStore(tmp_path / "blobs")
