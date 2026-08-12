"""SQLite persistence layer.

Schema follows VisualRegressionQATool_DESIGN.md Phase 4 verbatim for the four
chain tables (capture_instruction -> captured_image -> diff_image ->
evaluation_result). ``reference_image`` is an additive table required by the
Phase 3 ReferenceStore promotion workflow; it was not part of the Phase 4 SQL
block but is needed so ``diff_image.reference_image_id`` never references an
unapproved image. No foreign key in the chain is nullable, per the Phase 0
anti-pattern ("DBスキーマにNULL可の外部キーを増やしてチェーンを曖昧にしない").
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "vrqa.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS capture_instruction (
    instruction_id TEXT PRIMARY KEY,
    scene_or_level_id TEXT NOT NULL,
    camera_pose_json TEXT NOT NULL,
    frame_rate INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    jitter REAL NOT NULL,
    warmup_frames INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captured_image (
    captured_image_id TEXT PRIMARY KEY,
    instruction_id TEXT NOT NULL REFERENCES capture_instruction(instruction_id),
    build_version TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    checksum TEXT NOT NULL,
    image_path TEXT NOT NULL,
    resolution_width INTEGER NOT NULL,
    resolution_height INTEGER NOT NULL,
    color_space TEXT NOT NULL DEFAULT 'sRGB'
);

CREATE TABLE IF NOT EXISTS reference_image (
    reference_image_id TEXT PRIMARY KEY,
    captured_image_id TEXT NOT NULL REFERENCES captured_image(captured_image_id),
    instruction_id TEXT NOT NULL REFERENCES capture_instruction(instruction_id),
    approved_at TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS diff_image (
    diff_image_id TEXT PRIMARY KEY,
    captured_image_id TEXT NOT NULL REFERENCES captured_image(captured_image_id),
    reference_image_id TEXT NOT NULL REFERENCES reference_image(reference_image_id),
    diff_image_path TEXT NOT NULL,
    diff_pixel_count INTEGER NOT NULL,
    diff_percentage REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_result (
    evaluation_result_id TEXT PRIMARY KEY,
    diff_image_id TEXT NOT NULL REFERENCES diff_image(diff_image_id),
    verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail','flaky')),
    evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_issue (
    alert_issue_id TEXT PRIMARY KEY,
    instruction_id TEXT NOT NULL REFERENCES capture_instruction(instruction_id),
    evaluation_result_id TEXT NOT NULL REFERENCES evaluation_result(evaluation_result_id),
    sink_kind TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','closed')),
    opened_at TEXT NOT NULL,
    closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_captured_image_instruction ON captured_image(instruction_id);
CREATE INDEX IF NOT EXISTS idx_captured_image_checksum ON captured_image(checksum);
CREATE INDEX IF NOT EXISTS idx_reference_image_instruction_active ON reference_image(instruction_id, is_active);
CREATE INDEX IF NOT EXISTS idx_diff_image_captured ON diff_image(captured_image_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_result_diff ON evaluation_result(diff_image_id);
CREATE INDEX IF NOT EXISTS idx_alert_issue_instruction_status ON alert_issue(instruction_id, status);
"""


def connect(db_path: Path | str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


@contextmanager
def session(db_path: Path | str = DEFAULT_DB_PATH) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        init_db(conn)
        yield conn
    finally:
        conn.close()
