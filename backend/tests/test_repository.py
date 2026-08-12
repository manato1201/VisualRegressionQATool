from __future__ import annotations

import sqlite3

import pytest

from app import models, repository


def _make_instruction(conn: sqlite3.Connection):
    return repository.create_capture_instruction(
        conn,
        models.CaptureInstructionCreate(
            scene_or_level_id="OutdoorsScene", seed=0, frame_rate=60
        ),
    )


def test_captured_image_chain_round_trip(conn: sqlite3.Connection):
    instruction = _make_instruction(conn)
    captured = repository.create_captured_image(
        conn,
        instruction_id=instruction.instruction_id,
        build_version="abc123",
        checksum="deadbeef",
        image_path="blobs/de/deadbeef.png",
        width=1920,
        height=1080,
        color_space="Linear",
    )
    assert captured.instruction_id == instruction.instruction_id
    fetched = repository.get_captured_image(conn, captured.captured_image_id)
    assert fetched == captured


def test_unapproved_captured_image_is_not_the_active_reference(
    conn: sqlite3.Connection,
):
    """Phase 3 checklist: an un-promoted CapturedImage must never be mistaken for the ReferenceImage."""
    instruction = _make_instruction(conn)
    captured = repository.create_captured_image(
        conn,
        instruction_id=instruction.instruction_id,
        build_version="abc123",
        checksum="cafefeed",
        image_path="blobs/ca/cafefeed.png",
        width=64,
        height=64,
        color_space="sRGB",
    )
    assert (
        repository.get_active_reference_image(conn, instruction.instruction_id) is None
    )

    promoted = repository.promote_reference_image(
        conn,
        captured_image_id=captured.captured_image_id,
        instruction_id=instruction.instruction_id,
        approved_by="qa-bot",
    )
    active = repository.get_active_reference_image(conn, instruction.instruction_id)
    assert active is not None
    assert active.reference_image_id == promoted.reference_image_id
    assert active.captured_image_id == captured.captured_image_id


def test_promoting_a_new_reference_deactivates_the_previous_one(
    conn: sqlite3.Connection,
):
    instruction = _make_instruction(conn)
    first = repository.create_captured_image(
        conn,
        instruction_id=instruction.instruction_id,
        build_version="v1",
        checksum="c1",
        image_path="blobs/c/c1.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    second = repository.create_captured_image(
        conn,
        instruction_id=instruction.instruction_id,
        build_version="v2",
        checksum="c2",
        image_path="blobs/c/c2.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    repository.promote_reference_image(
        conn,
        captured_image_id=first.captured_image_id,
        instruction_id=instruction.instruction_id,
        approved_by="a",
    )
    repository.promote_reference_image(
        conn,
        captured_image_id=second.captured_image_id,
        instruction_id=instruction.instruction_id,
        approved_by="b",
    )

    active = repository.get_active_reference_image(conn, instruction.instruction_id)
    assert active.captured_image_id == second.captured_image_id


def test_foreign_keys_are_enforced_across_the_chain(conn: sqlite3.Connection):
    """Phase 4 checklist: the chain's foreign keys must never be nullable/dangling."""
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """INSERT INTO diff_image
               (diff_image_id, captured_image_id, reference_image_id, diff_image_path,
                diff_pixel_count, diff_percentage, created_at)
               VALUES ('d1', 'does-not-exist', 'also-missing', 'blobs/x/x.png', 0, 0.0, '2026-01-01T00:00:00')"""
        )
        conn.commit()


def test_evaluation_result_verdict_is_constrained_to_known_values(
    conn: sqlite3.Connection,
):
    instruction = _make_instruction(conn)
    captured = repository.create_captured_image(
        conn,
        instruction_id=instruction.instruction_id,
        build_version="v1",
        checksum="c1",
        image_path="blobs/c/c1.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    reference = repository.promote_reference_image(
        conn,
        captured_image_id=captured.captured_image_id,
        instruction_id=instruction.instruction_id,
        approved_by="a",
    )
    diff = repository.create_diff_image(
        conn,
        captured_image_id=captured.captured_image_id,
        reference_image_id=reference.reference_image_id,
        diff_image_path="blobs/d/d.png",
        diff_pixel_count=0,
        diff_percentage=0.0,
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO evaluation_result (evaluation_result_id, diff_image_id, verdict, evaluated_at) "
            "VALUES ('e1', ?, 'maybe', '2026-01-01T00:00:00')",
            (diff.diff_image_id,),
        )
        conn.commit()
