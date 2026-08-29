from __future__ import annotations

import sqlite3
from pathlib import Path

from app import db as db_module


def test_init_db_adds_resolution_note_to_a_pre_existing_database(tmp_path: Path):
    """Simulates a database file created before diff_image.resolution_note
    existed: CREATE TABLE IF NOT EXISTS alone would silently do nothing for
    an already-existing table, so init_db must retrofit the column."""
    db_path = tmp_path / "legacy.sqlite3"
    legacy_conn = sqlite3.connect(db_path)
    legacy_conn.execute(
        """CREATE TABLE diff_image (
            diff_image_id TEXT PRIMARY KEY,
            captured_image_id TEXT NOT NULL,
            reference_image_id TEXT NOT NULL,
            diff_image_path TEXT NOT NULL,
            diff_pixel_count INTEGER NOT NULL,
            diff_percentage REAL NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    legacy_conn.commit()
    legacy_conn.close()

    conn = db_module.connect(db_path)
    db_module.init_db(conn)

    columns = {row["name"] for row in conn.execute("PRAGMA table_info(diff_image)")}
    assert "resolution_note" in columns

    # And the column is actually usable afterwards.
    conn.execute(
        """INSERT INTO diff_image
           (diff_image_id, captured_image_id, reference_image_id, diff_image_path,
            diff_pixel_count, diff_percentage, created_at, resolution_note)
           VALUES ('d1', 'c1', 'r1', 'blobs/d/d.png', 0, 0.0, '2026-01-01T00:00:00', 'note')"""
    )
    conn.commit()
    row = conn.execute(
        "SELECT resolution_note FROM diff_image WHERE diff_image_id = 'd1'"
    ).fetchone()
    assert row["resolution_note"] == "note"
    conn.close()


def test_init_db_is_idempotent_across_repeated_calls(tmp_path: Path):
    """Running init_db twice (e.g. across two app restarts against the same
    file) must not raise even though the migration column already exists."""
    db_path = tmp_path / "fresh.sqlite3"
    conn = db_module.connect(db_path)
    db_module.init_db(conn)
    db_module.init_db(conn)  # must not raise "duplicate column name"
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(diff_image)")}
    assert "resolution_note" in columns
    conn.close()
