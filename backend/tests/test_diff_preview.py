from __future__ import annotations

import io
import sqlite3
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

W, H = 40, 30


def _png(color: tuple[int, int, int], size: tuple[int, int] = (W, H)) -> bytes:
    arr = np.full((size[1], size[0], 3), color, dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "preview.sqlite3"
    monkeypatch.setenv("VRQA_DB_PATH", str(db_path))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")

    from app.main import app

    with TestClient(app) as client:
        yield client, db_path, tmp_path / "blobs"


def _new_instruction(client: TestClient, name: str) -> str:
    return client.post("/api/instructions", json={"scene_or_level_id": name}).json()[
        "instruction_id"
    ]


def _upload(client: TestClient, instruction_id: str, name: str, data: bytes) -> str:
    return client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": name},
        files={"file": (f"{name}.png", data, "image/png")},
    ).json()["captured_image_id"]


def _promote(client: TestClient, captured_image_id: str) -> None:
    client.post(
        "/api/references/promote",
        json={"captured_image_id": captured_image_id, "approved_by": "qa"},
    )


def _scene(client: TestClient, candidate_color: tuple[int, int, int]) -> str:
    """A scene whose reference is (100,100,100) and which has one candidate
    capture in `candidate_color`. Returns the candidate's captured_image_id."""
    instruction_id = _new_instruction(client, "LabScene")
    _promote(client, _upload(client, instruction_id, "ref", _png((100, 100, 100))))
    return _upload(client, instruction_id, "candidate", _png(candidate_color))


def _row_counts(db_path: Path) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    try:
        return {
            table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("diff_image", "evaluation_result", "alert_issue")
        }
    finally:
        conn.close()


def _blob_count(blob_root: Path) -> int:
    return sum(1 for p in blob_root.rglob("*") if p.is_file())


def test_preview_shows_how_a_tolerance_would_change_the_verdict(env):
    client, _db, _blobs = env
    candidate = _scene(client, (105, 100, 100))  # every pixel is 5 off in one channel

    strict = client.post(
        "/api/diffs/preview", json={"captured_image_id": candidate}
    ).json()
    assert strict["verdict"] == "fail"
    assert strict["diff_pixel_count"] == W * H
    assert strict["diff_percentage"] == pytest.approx(100.0)

    lenient = client.post(
        "/api/diffs/preview",
        json={"captured_image_id": candidate, "per_pixel_tolerance": 5},
    ).json()
    assert lenient["verdict"] == "pass"
    assert lenient["diff_pixel_count"] == 0

    allowance = client.post(
        "/api/diffs/preview",
        json={"captured_image_id": candidate, "max_diff_pixels": W * H},
    ).json()
    assert allowance["verdict"] == "pass"
    assert allowance["diff_pixel_count"] == W * H


def test_preview_persists_nothing(env):
    client, db_path, blob_root = env
    candidate = _scene(client, (105, 100, 100))
    rows_before = _row_counts(db_path)
    blobs_before = _blob_count(blob_root)

    for tolerance in (0, 3, 5, 9):
        resp = client.post(
            "/api/diffs/preview",
            json={"captured_image_id": candidate, "per_pixel_tolerance": tolerance},
        )
        assert resp.status_code == 200 and resp.json()["persisted"] is False

    assert (
        _row_counts(db_path) == rows_before
    )  # no diff_image / evaluation / alert rows
    assert _blob_count(blob_root) == blobs_before  # no highlight image written
    assert client.get("/api/runs").json() == []


def test_preview_never_alters_a_stored_verdict(env):
    client, _db, _blobs = env
    candidate = _scene(client, (105, 100, 100))
    client.post("/api/diffs/run", json={"captured_image_id": candidate})
    (saved,) = client.get("/api/runs").json()
    assert saved["verdict"] == "fail"

    # A preview under settings that would pass changes nothing that was recorded.
    preview = client.post(
        "/api/diffs/preview",
        json={"captured_image_id": candidate, "per_pixel_tolerance": 10},
    ).json()
    assert preview["verdict"] == "pass"
    assert client.get("/api/runs").json() == [saved]


def test_preview_matches_what_a_real_run_with_the_same_settings_records(env):
    client, _db, _blobs = env
    candidate = _scene(client, (105, 100, 100))
    settings = {
        "per_pixel_tolerance": 2,
        "max_diff_pixels": 10,
        "min_diff_region_pixels": 4,
    }

    preview = client.post(
        "/api/diffs/preview", json={"captured_image_id": candidate, **settings}
    ).json()
    real = client.post(
        "/api/diffs/run", json={"captured_image_id": candidate, **settings}
    ).json()

    assert preview["diff_pixel_count"] == real["diff_image"]["diff_pixel_count"]
    assert preview["verdict"] == real["evaluation_result"]["verdict"]


def test_preview_reports_the_same_errors_a_real_run_would(env):
    client, _db, _blobs = env

    assert (
        client.post(
            "/api/diffs/preview", json={"captured_image_id": "nope"}
        ).status_code
        == 404
    )

    # No reference promoted yet for this instruction.
    unreferenced = _new_instruction(client, "NoRef")
    orphan = _upload(client, unreferenced, "v1", _png((1, 2, 3)))
    no_reference = client.post("/api/diffs/preview", json={"captured_image_id": orphan})
    assert no_reference.status_code == 404
    assert "reference" in no_reference.json()["detail"]

    # A resolution mismatch is rejected unless centre-crop is explicitly allowed.
    instruction_id = _new_instruction(client, "Resized")
    _promote(client, _upload(client, instruction_id, "ref", _png((100, 100, 100))))
    wide = _upload(
        client, instruction_id, "wide", _png((100, 100, 100), size=(W + 6, H))
    )

    mismatch = client.post("/api/diffs/preview", json={"captured_image_id": wide})
    assert mismatch.status_code == 422 and "size" in mismatch.json()["detail"]

    cropped = client.post(
        "/api/diffs/preview",
        json={"captured_image_id": wide, "allow_center_crop": True},
    )
    assert cropped.status_code == 200
    assert cropped.json()["resolution_note"]
