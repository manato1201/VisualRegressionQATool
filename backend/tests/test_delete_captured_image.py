from __future__ import annotations

import sqlite3

import pytest

from app import models, repository
from app.repository import CapturedImageInUseError


def _instr(conn: sqlite3.Connection):
    return repository.create_capture_instruction(
        conn, models.CaptureInstructionCreate(scene_or_level_id="Scene")
    )


def test_delete_unreferenced_captured_image_frees_the_blob(conn: sqlite3.Connection):
    instr = _instr(conn)
    img = repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="v1",
        checksum="only-one",
        image_path="blobs/o/only-one.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    freed_path = repository.delete_captured_image(conn, img.captured_image_id)
    assert freed_path == "blobs/o/only-one.png"
    assert repository.get_captured_image(conn, img.captured_image_id) is None


def test_delete_keeps_blob_when_another_row_shares_the_checksum(
    conn: sqlite3.Connection,
):
    instr = _instr(conn)
    img1 = repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="v1",
        checksum="shared",
        image_path="blobs/s/shared.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="v2",
        checksum="shared",
        image_path="blobs/s/shared.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    freed_path = repository.delete_captured_image(conn, img1.captured_image_id)
    assert freed_path == "", (
        "blob must stay while a second row still points at the same checksum"
    )


def test_cannot_delete_a_promoted_reference_image(conn: sqlite3.Connection):
    instr = _instr(conn)
    img = repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="v1",
        checksum="c1",
        image_path="blobs/c/c1.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    repository.promote_reference_image(
        conn,
        captured_image_id=img.captured_image_id,
        instruction_id=instr.instruction_id,
        approved_by="qa",
    )
    with pytest.raises(CapturedImageInUseError):
        repository.delete_captured_image(conn, img.captured_image_id)
    assert repository.get_captured_image(conn, img.captured_image_id) is not None


def test_cannot_delete_a_captured_image_with_diff_history(conn: sqlite3.Connection):
    instr = _instr(conn)
    ref_captured = repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="ref",
        checksum="ref",
        image_path="blobs/r/ref.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    reference = repository.promote_reference_image(
        conn,
        captured_image_id=ref_captured.captured_image_id,
        instruction_id=instr.instruction_id,
        approved_by="qa",
    )
    img = repository.create_captured_image(
        conn,
        instruction_id=instr.instruction_id,
        build_version="v1",
        checksum="c1",
        image_path="blobs/c/c1.png",
        width=8,
        height=8,
        color_space="sRGB",
    )
    repository.create_diff_image(
        conn,
        captured_image_id=img.captured_image_id,
        reference_image_id=reference.reference_image_id,
        diff_image_path="blobs/d/d.png",
        diff_pixel_count=0,
        diff_percentage=0.0,
    )
    with pytest.raises(CapturedImageInUseError):
        repository.delete_captured_image(conn, img.captured_image_id)


def test_delete_missing_captured_image_raises_key_error(conn: sqlite3.Connection):
    with pytest.raises(KeyError):
        repository.delete_captured_image(conn, "does-not-exist")
