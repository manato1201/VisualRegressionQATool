from __future__ import annotations

import sqlite3

from app import queries, repository


def _seed_history(conn: sqlite3.Connection) -> str:
    """Build a synthetic build history for one instruction:
    v1 pass, v2 pass, v3 fail (the intentional regression), v4 fail.
    Returns the instruction_id."""
    from app import models

    instr = repository.create_capture_instruction(
        conn, models.CaptureInstructionCreate(scene_or_level_id="OutdoorsScene")
    )
    reference_captured = repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="v0-reference",
        checksum="ref",
        image_path="blobs/r/ref.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    reference = repository.promote_reference_image(
        conn,
        captured_image_id=reference_captured.captured_image_id,
        instruction_id=instr.instruction_id,
        approved_by="qa",
    )

    timestamps = [
        ("v1", "2026-01-01T00:00:00", "pass"),
        ("v2", "2026-01-02T00:00:00", "pass"),
        ("v3", "2026-01-03T00:00:00", "fail"),  # first bad commit
        ("v4", "2026-01-04T00:00:00", "fail"),
    ]
    for build_version, captured_at, verdict in timestamps:
        conn.execute(
            """INSERT INTO captured_image
               (captured_image_id, instruction_id, build_version, captured_at, checksum, image_path,
                resolution_width, resolution_height, color_space)
               VALUES (?, ?, ?, ?, ?, ?, 8, 8, 'sRGB')""",
            (
                f"cap-{build_version}",
                instr.instruction_id,
                build_version,
                captured_at,
                f"sum-{build_version}",
                f"blobs/{build_version}.png",
            ),
        )
        conn.execute(
            """INSERT INTO diff_image
               (diff_image_id, captured_image_id, reference_image_id, diff_image_path,
                diff_pixel_count, diff_percentage, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                f"diff-{build_version}",
                f"cap-{build_version}",
                reference.reference_image_id,
                f"blobs/diff-{build_version}.png",
                0 if verdict == "pass" else 42,
                0.0 if verdict == "pass" else 1.5,
                captured_at,
            ),
        )
        conn.execute(
            """INSERT INTO evaluation_result (evaluation_result_id, diff_image_id, verdict, evaluated_at)
               VALUES (?, ?, ?, ?)""",
            (f"eval-{build_version}", f"diff-{build_version}", verdict, captured_at),
        )
    conn.commit()
    return instr.instruction_id


def test_first_bad_commit_returns_the_correct_build_version(conn: sqlite3.Connection):
    instruction_id = _seed_history(conn)
    result = queries.first_bad_commit(conn, instruction_id)
    assert result is not None
    assert result.build_version == "v3"
    assert result.instruction_id == instruction_id


def test_first_bad_commit_returns_none_when_all_passing(conn: sqlite3.Connection):
    from app import models

    instr = repository.create_capture_instruction(
        conn, models.CaptureInstructionCreate(scene_or_level_id="Scene")
    )
    assert queries.first_bad_commit(conn, instr.instruction_id) is None


def test_runs_history_is_ordered_by_capture_time_descending(conn: sqlite3.Connection):
    instruction_id = _seed_history(conn)
    runs = queries.list_runs(conn, instruction_id)
    build_versions = [r.build_version for r in runs]
    assert build_versions == ["v4", "v3", "v2", "v1"]
