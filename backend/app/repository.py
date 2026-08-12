"""CRUD access to the capture_instruction -> captured_image -> diff_image ->
evaluation_result chain (plus reference_image / alert_issue)."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from . import models


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# --- capture_instruction ---------------------------------------------------


def create_capture_instruction(
    conn: sqlite3.Connection, body: models.CaptureInstructionCreate
) -> models.CaptureInstructionOut:
    instruction_id = new_id()
    created_at = _now()
    conn.execute(
        """INSERT INTO capture_instruction
           (instruction_id, scene_or_level_id, camera_pose_json, frame_rate, seed, jitter, warmup_frames, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            instruction_id,
            body.scene_or_level_id,
            body.camera_pose.model_dump_json(),
            body.frame_rate,
            body.seed,
            body.jitter,
            body.warmup_frames,
            created_at,
        ),
    )
    conn.commit()
    return _row_to_instruction(
        conn.execute(
            "SELECT * FROM capture_instruction WHERE instruction_id = ?",
            (instruction_id,),
        ).fetchone()
    )


def get_capture_instruction(
    conn: sqlite3.Connection, instruction_id: str
) -> models.CaptureInstructionOut | None:
    row = conn.execute(
        "SELECT * FROM capture_instruction WHERE instruction_id = ?", (instruction_id,)
    ).fetchone()
    return _row_to_instruction(row) if row else None


def list_capture_instructions(
    conn: sqlite3.Connection,
) -> list[models.CaptureInstructionOut]:
    rows = conn.execute(
        "SELECT * FROM capture_instruction ORDER BY created_at DESC"
    ).fetchall()
    return [_row_to_instruction(r) for r in rows]


def _row_to_instruction(row: sqlite3.Row) -> models.CaptureInstructionOut:
    return models.CaptureInstructionOut(
        instruction_id=row["instruction_id"],
        scene_or_level_id=row["scene_or_level_id"],
        camera_pose=models.CameraPose(**json.loads(row["camera_pose_json"])),
        frame_rate=row["frame_rate"],
        seed=row["seed"],
        jitter=row["jitter"],
        warmup_frames=row["warmup_frames"],
        created_at=row["created_at"],
    )


# --- captured_image ----------------------------------------------------------


def create_captured_image(
    conn: sqlite3.Connection,
    *,
    instruction_id: str,
    build_version: str,
    checksum: str,
    image_path: str,
    width: int,
    height: int,
    color_space: str,
) -> models.CapturedImageOut:
    captured_image_id = new_id()
    captured_at = _now()
    conn.execute(
        """INSERT INTO captured_image
           (captured_image_id, instruction_id, build_version, captured_at, checksum, image_path,
            resolution_width, resolution_height, color_space)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            captured_image_id,
            instruction_id,
            build_version,
            captured_at,
            checksum,
            image_path,
            width,
            height,
            color_space,
        ),
    )
    conn.commit()
    return get_captured_image(conn, captured_image_id)


def get_captured_image(
    conn: sqlite3.Connection, captured_image_id: str
) -> models.CapturedImageOut | None:
    row = conn.execute(
        "SELECT * FROM captured_image WHERE captured_image_id = ?", (captured_image_id,)
    ).fetchone()
    return _row_to_captured_image(row) if row else None


def list_captured_images(
    conn: sqlite3.Connection, instruction_id: str | None = None
) -> list[models.CapturedImageOut]:
    if instruction_id:
        rows = conn.execute(
            "SELECT * FROM captured_image WHERE instruction_id = ? ORDER BY captured_at DESC",
            (instruction_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM captured_image ORDER BY captured_at DESC"
        ).fetchall()
    return [_row_to_captured_image(r) for r in rows]


def _row_to_captured_image(row: sqlite3.Row) -> models.CapturedImageOut:
    return models.CapturedImageOut(
        captured_image_id=row["captured_image_id"],
        instruction_id=row["instruction_id"],
        build_version=row["build_version"],
        captured_at=row["captured_at"],
        checksum=row["checksum"],
        image_path=row["image_path"],
        resolution_width=row["resolution_width"],
        resolution_height=row["resolution_height"],
        color_space=row["color_space"],
    )


class CapturedImageInUseError(Exception):
    """Raised when deletion would break the append-only chain
    (CaptureInstruction -> CapturedImage -> DiffImage -> EvaluationResult)."""

    def __init__(self, reasons: list[str]) -> None:
        self.reasons = reasons
        super().__init__("; ".join(reasons))


def delete_captured_image(conn: sqlite3.Connection, captured_image_id: str) -> str:
    """Delete a CapturedImage row and, if no other row shares its checksum,
    the underlying BLOB. Refuses to delete an image that is part of the
    history chain (promoted to a ReferenceImage, or already diffed) so the
    chain never dangles.

    Returns the ``image_path`` if the caller should also remove the BLOB
    file, otherwise an empty string (another CapturedImage still points at
    the same checksum).
    """
    row = conn.execute(
        "SELECT * FROM captured_image WHERE captured_image_id = ?", (captured_image_id,)
    ).fetchone()
    if not row:
        raise KeyError(captured_image_id)

    reasons = []
    if conn.execute(
        "SELECT 1 FROM reference_image WHERE captured_image_id = ? LIMIT 1", (captured_image_id,)
    ).fetchone():
        reasons.append("この画像はReferenceに昇格済みです")
    if conn.execute(
        "SELECT 1 FROM diff_image WHERE captured_image_id = ? LIMIT 1", (captured_image_id,)
    ).fetchone():
        reasons.append("この画像は差分評価履歴に含まれています")
    if reasons:
        raise CapturedImageInUseError(reasons)

    conn.execute("DELETE FROM captured_image WHERE captured_image_id = ?", (captured_image_id,))
    conn.commit()

    remaining = conn.execute(
        "SELECT COUNT(*) AS n FROM captured_image WHERE checksum = ?", (row["checksum"],)
    ).fetchone()["n"]
    return row["image_path"] if remaining == 0 else ""


# --- reference_image ---------------------------------------------------------


def promote_reference_image(
    conn: sqlite3.Connection,
    *,
    captured_image_id: str,
    instruction_id: str,
    approved_by: str,
) -> models.ReferenceImageOut:
    """Promote a CapturedImage to be the active ReferenceImage for its instruction.

    Deactivates any previously-active reference for the same instruction so
    exactly one active reference exists per instruction at a time.
    """
    reference_image_id = new_id()
    approved_at = _now()
    conn.execute(
        "UPDATE reference_image SET is_active = 0 WHERE instruction_id = ? AND is_active = 1",
        (instruction_id,),
    )
    conn.execute(
        """INSERT INTO reference_image
           (reference_image_id, captured_image_id, instruction_id, approved_at, approved_by, is_active)
           VALUES (?, ?, ?, ?, ?, 1)""",
        (
            reference_image_id,
            captured_image_id,
            instruction_id,
            approved_at,
            approved_by,
        ),
    )
    conn.commit()
    return get_reference_image(conn, reference_image_id)


def get_reference_image(
    conn: sqlite3.Connection, reference_image_id: str
) -> models.ReferenceImageOut | None:
    row = conn.execute(
        "SELECT * FROM reference_image WHERE reference_image_id = ?",
        (reference_image_id,),
    ).fetchone()
    return _row_to_reference(row) if row else None


def get_active_reference_image(
    conn: sqlite3.Connection, instruction_id: str
) -> models.ReferenceImageOut | None:
    row = conn.execute(
        "SELECT * FROM reference_image WHERE instruction_id = ? AND is_active = 1",
        (instruction_id,),
    ).fetchone()
    return _row_to_reference(row) if row else None


def _row_to_reference(row: sqlite3.Row) -> models.ReferenceImageOut:
    return models.ReferenceImageOut(
        reference_image_id=row["reference_image_id"],
        captured_image_id=row["captured_image_id"],
        instruction_id=row["instruction_id"],
        approved_at=row["approved_at"],
        approved_by=row["approved_by"],
        is_active=bool(row["is_active"]),
    )


# --- diff_image / evaluation_result ------------------------------------------


def create_diff_image(
    conn: sqlite3.Connection,
    *,
    captured_image_id: str,
    reference_image_id: str,
    diff_image_path: str,
    diff_pixel_count: int,
    diff_percentage: float,
) -> models.DiffImageOut:
    diff_image_id = new_id()
    created_at = _now()
    conn.execute(
        """INSERT INTO diff_image
           (diff_image_id, captured_image_id, reference_image_id, diff_image_path, diff_pixel_count, diff_percentage, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            diff_image_id,
            captured_image_id,
            reference_image_id,
            diff_image_path,
            diff_pixel_count,
            diff_percentage,
            created_at,
        ),
    )
    conn.commit()
    return get_diff_image(conn, diff_image_id)


def get_diff_image(
    conn: sqlite3.Connection, diff_image_id: str
) -> models.DiffImageOut | None:
    row = conn.execute(
        "SELECT * FROM diff_image WHERE diff_image_id = ?", (diff_image_id,)
    ).fetchone()
    return _row_to_diff_image(row) if row else None


def _row_to_diff_image(row: sqlite3.Row) -> models.DiffImageOut:
    return models.DiffImageOut(
        diff_image_id=row["diff_image_id"],
        captured_image_id=row["captured_image_id"],
        reference_image_id=row["reference_image_id"],
        diff_image_path=row["diff_image_path"],
        diff_pixel_count=row["diff_pixel_count"],
        diff_percentage=row["diff_percentage"],
        created_at=row["created_at"],
    )


def create_evaluation_result(
    conn: sqlite3.Connection, *, diff_image_id: str, verdict: str
) -> models.EvaluationResultOut:
    evaluation_result_id = new_id()
    evaluated_at = _now()
    conn.execute(
        """INSERT INTO evaluation_result (evaluation_result_id, diff_image_id, verdict, evaluated_at)
           VALUES (?, ?, ?, ?)""",
        (evaluation_result_id, diff_image_id, verdict, evaluated_at),
    )
    conn.commit()
    return get_evaluation_result(conn, evaluation_result_id)


def get_evaluation_result(
    conn: sqlite3.Connection, evaluation_result_id: str
) -> models.EvaluationResultOut | None:
    row = conn.execute(
        "SELECT * FROM evaluation_result WHERE evaluation_result_id = ?",
        (evaluation_result_id,),
    ).fetchone()
    return _row_to_evaluation(row) if row else None


def _row_to_evaluation(row: sqlite3.Row) -> models.EvaluationResultOut:
    return models.EvaluationResultOut(
        evaluation_result_id=row["evaluation_result_id"],
        diff_image_id=row["diff_image_id"],
        verdict=row["verdict"],
        evaluated_at=row["evaluated_at"],
    )


# --- alert_issue ---------------------------------------------------------------


def find_open_alert_issue(
    conn: sqlite3.Connection, instruction_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM alert_issue WHERE instruction_id = ? AND status = 'open'",
        (instruction_id,),
    ).fetchone()


def create_alert_issue(
    conn: sqlite3.Connection,
    *,
    instruction_id: str,
    evaluation_result_id: str,
    sink_kind: str,
    external_ref: str,
) -> sqlite3.Row:
    alert_issue_id = new_id()
    opened_at = _now()
    conn.execute(
        """INSERT INTO alert_issue
           (alert_issue_id, instruction_id, evaluation_result_id, sink_kind, external_ref, status, opened_at, closed_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)""",
        (
            alert_issue_id,
            instruction_id,
            evaluation_result_id,
            sink_kind,
            external_ref,
            opened_at,
        ),
    )
    conn.commit()
    return conn.execute(
        "SELECT * FROM alert_issue WHERE alert_issue_id = ?", (alert_issue_id,)
    ).fetchone()


def close_open_alert_issues(
    conn: sqlite3.Connection, instruction_id: str
) -> list[sqlite3.Row]:
    rows = conn.execute(
        "SELECT * FROM alert_issue WHERE instruction_id = ? AND status = 'open'",
        (instruction_id,),
    ).fetchall()
    conn.execute(
        "UPDATE alert_issue SET status = 'closed', closed_at = ? WHERE instruction_id = ? AND status = 'open'",
        (_now(), instruction_id),
    )
    conn.commit()
    return rows
