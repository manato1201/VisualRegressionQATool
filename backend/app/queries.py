"""Phase 4 history queries: first-bad-commit and run listings.

``first_bad_commit`` is deliberately a plain SQL query, not an inference
step — it answers "which build_version first failed", not "why".
"""

from __future__ import annotations

import sqlite3

from . import models

FIRST_BAD_COMMIT_SQL = """
SELECT ci.instruction_id AS instruction_id,
       cap.build_version AS build_version,
       er.evaluated_at AS evaluated_at
FROM evaluation_result er
JOIN diff_image di ON er.diff_image_id = di.diff_image_id
JOIN captured_image cap ON di.captured_image_id = cap.captured_image_id
JOIN capture_instruction ci ON cap.instruction_id = ci.instruction_id
WHERE er.verdict = 'fail' AND ci.instruction_id = ?
ORDER BY cap.captured_at ASC
LIMIT 1;
"""

RUNS_SQL = """
SELECT er.evaluation_result_id AS evaluation_result_id,
       er.verdict AS verdict,
       er.evaluated_at AS evaluated_at,
       di.diff_image_id AS diff_image_id,
       di.diff_pixel_count AS diff_pixel_count,
       di.diff_percentage AS diff_percentage,
       di.reference_image_id AS reference_image_id,
       di.resolution_note AS resolution_note,
       cap.captured_image_id AS captured_image_id,
       cap.build_version AS build_version,
       ci.instruction_id AS instruction_id,
       ci.scene_or_level_id AS scene_or_level_id
FROM evaluation_result er
JOIN diff_image di ON er.diff_image_id = di.diff_image_id
JOIN captured_image cap ON di.captured_image_id = cap.captured_image_id
JOIN capture_instruction ci ON cap.instruction_id = ci.instruction_id
{where}
ORDER BY cap.captured_at DESC
"""


def first_bad_commit(
    conn: sqlite3.Connection, instruction_id: str
) -> models.FirstBadCommitOut | None:
    row = conn.execute(FIRST_BAD_COMMIT_SQL, (instruction_id,)).fetchone()
    if not row:
        return None
    return models.FirstBadCommitOut(
        instruction_id=row["instruction_id"],
        build_version=row["build_version"],
        evaluated_at=row["evaluated_at"],
    )


def list_runs(
    conn: sqlite3.Connection, instruction_id: str | None = None
) -> list[models.RunRow]:
    if instruction_id:
        sql = RUNS_SQL.format(where="WHERE ci.instruction_id = ?")
        rows = conn.execute(sql, (instruction_id,)).fetchall()
    else:
        sql = RUNS_SQL.format(where="")
        rows = conn.execute(sql).fetchall()
    return [
        models.RunRow(
            evaluation_result_id=r["evaluation_result_id"],
            verdict=r["verdict"],
            evaluated_at=r["evaluated_at"],
            diff_image_id=r["diff_image_id"],
            diff_pixel_count=r["diff_pixel_count"],
            diff_percentage=r["diff_percentage"],
            captured_image_id=r["captured_image_id"],
            build_version=r["build_version"],
            instruction_id=r["instruction_id"],
            scene_or_level_id=r["scene_or_level_id"],
            reference_image_id=r["reference_image_id"],
            resolution_note=r["resolution_note"],
        )
        for r in rows
    ]


DASHBOARD_SQL = """
WITH ranked_runs AS (
    SELECT
        ci.instruction_id AS instruction_id,
        er.verdict AS verdict,
        er.evaluated_at AS evaluated_at,
        cap.build_version AS build_version,
        di.diff_pixel_count AS diff_pixel_count,
        di.diff_percentage AS diff_percentage,
        ROW_NUMBER() OVER (PARTITION BY ci.instruction_id ORDER BY cap.captured_at DESC) AS rn
    FROM evaluation_result er
    JOIN diff_image di ON er.diff_image_id = di.diff_image_id
    JOIN captured_image cap ON di.captured_image_id = cap.captured_image_id
    JOIN capture_instruction ci ON cap.instruction_id = ci.instruction_id
)
SELECT
    ci.instruction_id AS instruction_id,
    ci.scene_or_level_id AS scene_or_level_id,
    ci.created_at AS created_at,
    rr.verdict AS latest_verdict,
    rr.evaluated_at AS latest_evaluated_at,
    rr.build_version AS latest_build_version,
    rr.diff_pixel_count AS latest_diff_pixel_count,
    rr.diff_percentage AS latest_diff_percentage,
    (SELECT COUNT(*) FROM evaluation_result er2
       JOIN diff_image di2 ON er2.diff_image_id = di2.diff_image_id
       JOIN captured_image cap2 ON di2.captured_image_id = cap2.captured_image_id
       WHERE cap2.instruction_id = ci.instruction_id) AS total_runs,
    EXISTS(SELECT 1 FROM reference_image ri WHERE ri.instruction_id = ci.instruction_id AND ri.is_active = 1) AS has_active_reference,
    (SELECT COUNT(*) FROM alert_issue ai WHERE ai.instruction_id = ci.instruction_id AND ai.status = 'open') AS open_alert_count
FROM capture_instruction ci
LEFT JOIN ranked_runs rr ON rr.instruction_id = ci.instruction_id AND rr.rn = 1
ORDER BY
    CASE rr.verdict WHEN 'fail' THEN 0 WHEN 'flaky' THEN 1 WHEN 'pass' THEN 2 ELSE 3 END,
    ci.scene_or_level_id;
"""


def dashboard_summary(conn: sqlite3.Connection) -> list[models.DashboardRow]:
    """One row per CaptureInstruction with its latest verdict, ordered so
    the most urgent scenes (currently failing, then flaky) surface first --
    a health-at-a-glance view across every tracked scene, not just the one
    currently selected in the tool."""
    rows = conn.execute(DASHBOARD_SQL).fetchall()
    return [
        models.DashboardRow(
            instruction_id=r["instruction_id"],
            scene_or_level_id=r["scene_or_level_id"],
            created_at=r["created_at"],
            latest_verdict=r["latest_verdict"],
            latest_build_version=r["latest_build_version"],
            latest_evaluated_at=r["latest_evaluated_at"],
            latest_diff_pixel_count=r["latest_diff_pixel_count"],
            latest_diff_percentage=r["latest_diff_percentage"],
            total_runs=r["total_runs"],
            has_active_reference=bool(r["has_active_reference"]),
            open_alert_count=r["open_alert_count"],
        )
        for r in rows
    ]


def latest_verdict_for_instruction(
    conn: sqlite3.Connection, instruction_id: str
) -> str | None:
    row = conn.execute(
        """
        SELECT er.verdict AS verdict
        FROM evaluation_result er
        JOIN diff_image di ON er.diff_image_id = di.diff_image_id
        JOIN captured_image cap ON di.captured_image_id = cap.captured_image_id
        WHERE cap.instruction_id = ?
        ORDER BY cap.captured_at DESC
        LIMIT 1
        """,
        (instruction_id,),
    ).fetchone()
    return row["verdict"] if row else None
