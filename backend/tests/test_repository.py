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


def _evaluate_build(
    conn: sqlite3.Connection, *, instruction_id: str, reference_image_id: str, build_version: str, verdict: str
) -> str:
    """Test helper: creates a captured_image/diff_image/evaluation_result
    triple for ``build_version`` with the given verdict, and returns the
    evaluation_result_id."""
    captured = repository.create_captured_image(
        conn,
        instruction_id=instruction_id,
        build_version=build_version,
        checksum=repository.new_id(),
        image_path="blobs/x/x.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    diff = repository.create_diff_image(
        conn,
        captured_image_id=captured.captured_image_id,
        reference_image_id=reference_image_id,
        diff_image_path="blobs/d/d.png",
        diff_pixel_count=0 if verdict == "pass" else 5,
        diff_percentage=0.0 if verdict == "pass" else 1.0,
    )
    evaluation_result = repository.create_evaluation_result(conn, diff_image_id=diff.diff_image_id, verdict=verdict)
    return evaluation_result.evaluation_result_id


def test_reconcile_flaky_verdicts_flips_a_contradictory_pass_fail_pair(conn: sqlite3.Connection):
    instruction = _make_instruction(conn)
    baseline = repository.create_captured_image(
        conn, instruction_id=instruction.instruction_id, build_version="baseline", checksum="base",
        image_path="blobs/b/base.png", width=8, height=8, color_space="sRGB",
    )
    reference = repository.promote_reference_image(
        conn, captured_image_id=baseline.captured_image_id, instruction_id=instruction.instruction_id, approved_by="qa"
    )

    pass_id = _evaluate_build(
        conn, instruction_id=instruction.instruction_id, reference_image_id=reference.reference_image_id,
        build_version="v1", verdict="pass",
    )
    fail_id = _evaluate_build(
        conn, instruction_id=instruction.instruction_id, reference_image_id=reference.reference_image_id,
        build_version="v1", verdict="fail",
    )

    flipped = repository.reconcile_flaky_verdicts(conn, instruction_id=instruction.instruction_id, build_version="v1")
    assert set(flipped) == {pass_id, fail_id}
    assert repository.get_evaluation_result(conn, pass_id).verdict == "flaky"
    assert repository.get_evaluation_result(conn, fail_id).verdict == "flaky"


def test_reconcile_flaky_verdicts_does_nothing_when_all_agree(conn: sqlite3.Connection):
    instruction = _make_instruction(conn)
    baseline = repository.create_captured_image(
        conn, instruction_id=instruction.instruction_id, build_version="baseline", checksum="base2",
        image_path="blobs/b/base2.png", width=8, height=8, color_space="sRGB",
    )
    reference = repository.promote_reference_image(
        conn, captured_image_id=baseline.captured_image_id, instruction_id=instruction.instruction_id, approved_by="qa"
    )

    id1 = _evaluate_build(
        conn, instruction_id=instruction.instruction_id, reference_image_id=reference.reference_image_id,
        build_version="v2", verdict="pass",
    )
    id2 = _evaluate_build(
        conn, instruction_id=instruction.instruction_id, reference_image_id=reference.reference_image_id,
        build_version="v2", verdict="pass",
    )

    flipped = repository.reconcile_flaky_verdicts(conn, instruction_id=instruction.instruction_id, build_version="v2")
    assert flipped == []
    assert repository.get_evaluation_result(conn, id1).verdict == "pass"
    assert repository.get_evaluation_result(conn, id2).verdict == "pass"


def test_reconcile_flaky_verdicts_ignores_other_build_versions(conn: sqlite3.Connection):
    instruction = _make_instruction(conn)
    baseline = repository.create_captured_image(
        conn, instruction_id=instruction.instruction_id, build_version="baseline", checksum="base3",
        image_path="blobs/b/base3.png", width=8, height=8, color_space="sRGB",
    )
    reference = repository.promote_reference_image(
        conn, captured_image_id=baseline.captured_image_id, instruction_id=instruction.instruction_id, approved_by="qa"
    )

    pass_v3 = _evaluate_build(
        conn, instruction_id=instruction.instruction_id, reference_image_id=reference.reference_image_id,
        build_version="v3", verdict="pass",
    )
    fail_v4 = _evaluate_build(
        conn, instruction_id=instruction.instruction_id, reference_image_id=reference.reference_image_id,
        build_version="v4", verdict="fail",
    )

    assert repository.reconcile_flaky_verdicts(conn, instruction_id=instruction.instruction_id, build_version="v3") == []
    assert repository.get_evaluation_result(conn, pass_v3).verdict == "pass"
    assert repository.get_evaluation_result(conn, fail_v4).verdict == "fail"
