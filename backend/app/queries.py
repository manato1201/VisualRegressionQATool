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
