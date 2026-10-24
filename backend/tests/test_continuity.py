from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import continuity

W, H = 96, 64


def _png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def render_at(frame_index: int, size: tuple[int, int] = (W, H)) -> bytes:
    """A deterministic test scene that is a pure function of time: a block
    sliding right at 2 px per frame. Nothing but ``frame_index`` decides a
    pixel, so capturing the same index twice must give identical bytes, and
    adjacent frames always differ by the same small amount (smooth motion)."""
    w, h = size
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    arr[..., 2] = 40
    x = 2 * frame_index
    arr[20:36, x : x + 12] = (230, 200, 40)
    return _png(arr)


def glitch_frame(size: tuple[int, int] = (W, H)) -> bytes:
    """What a one-frame flash looks like: the whole picture changes."""
    w, h = size
    return _png(np.full((h, w, 3), 200, dtype=np.uint8))


# --- statistics ------------------------------------------------------------


def test_a_single_spike_in_a_smooth_series_is_the_only_outlier():
    diffs = [64] * 30
    diffs[17] = 95_245
    _med, _mad, _threshold, outliers = continuity.find_outliers(
        diffs, total_pixels=1_000_000
    )
    assert outliers == (17,)


def test_a_uniformly_smooth_series_has_no_outliers():
    diffs = [60, 64, 62, 66, 64, 63, 65, 61]
    assert continuity.find_outliers(diffs, total_pixels=6144)[3] == ()


def test_noise_in_an_almost_static_sequence_is_not_flagged_by_the_floor():
    """Median and spread are both ~0 here, so a purely statistical threshold
    would call 3 stray pixels an outlier. The absolute floor (0.1% of the
    frame) is what stops that."""
    diffs = [0, 0, 0, 3, 0, 0, 0]
    assert continuity.find_outliers(diffs, total_pixels=1_000_000)[3] == ()


def test_a_real_jump_in_an_almost_static_sequence_is_flagged():
    diffs = [0, 0, 0, 0, 5_000, 0, 0]
    assert continuity.find_outliers(diffs, total_pixels=1_000_000)[3] == (4,)


# --- analysis over real frames ----------------------------------------------


def test_same_time_renders_identical_bytes_and_smooth_motion_has_no_outliers():
    assert render_at(7) == render_at(7)

    analysis = continuity.analyze_frames(render_at(i) for i in range(24))
    assert analysis.outlier_indices == ()
    assert set(analysis.pair_diffs) == {64}  # 2px x 16 rows leaving + entering


def test_a_glitch_frame_is_reported_on_both_pairs_touching_it():
    frames = [render_at(i) for i in range(24)]
    frames[11] = glitch_frame()

    analysis = continuity.analyze_frames(frames)

    # Change *into* the glitch (pair 10) and *out of* it (pair 11).
    assert set(analysis.outlier_indices) == {10, 11}


def test_too_few_frames_are_rejected():
    with pytest.raises(continuity.ContinuityInputError, match="at least 3"):
        continuity.analyze_frames([render_at(0), render_at(1)])


def test_frames_of_different_sizes_are_rejected_with_their_positions():
    frames = [render_at(0), render_at(1), render_at(2, size=(W + 8, H))]
    with pytest.raises(continuity.ContinuityInputError, match="frame 2"):
        continuity.analyze_frames(frames)


# --- API ---------------------------------------------------------------------


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "continuity.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")

    from app.main import app

    with TestClient(app) as c:
        yield c


def _upload(client: TestClient, instruction_id: str, name: str, data: bytes) -> dict:
    return client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": name},
        files={"file": (f"{name}.png", data, "image/png")},
    ).json()


def _animation(client: TestClient, frames: list[bytes]) -> list[dict]:
    instruction_id = client.post(
        "/api/instructions",
        json={"scene_or_level_id": "SlidingBlock", "fixed_time_seconds": 0.0},
    ).json()["instruction_id"]
    return [
        _upload(client, instruction_id, f"t{i:03d}", f) for i, f in enumerate(frames)
    ]


def test_capturing_the_same_time_twice_dedupes_to_one_blob(client: TestClient):
    """The Q1 acceptance test seen from the server: a deterministic capture is
    byte-identical, so the content-addressed store sees the second one as a
    duplicate of the first."""
    first, second = _animation(client, [render_at(5), render_at(5)])
    assert first["dedup_hit"] is False
    assert second["dedup_hit"] is True
    assert first["checksum"] == second["checksum"]


def test_continuity_endpoint_reports_only_the_glitch(client: TestClient):
    frames = [render_at(i) for i in range(20)]
    frames[8] = glitch_frame()
    uploaded = _animation(client, frames)

    resp = client.post(
        "/api/analysis/continuity",
        json={"captured_image_ids": [u["captured_image_id"] for u in uploaded]},
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["frame_count"] == 20 and body["pair_count"] == 19
    assert len(body["pair_diffs"]) == 19
    assert {o["pair_index"] for o in body["outliers"]} == {7, 8}
    into_glitch = next(o for o in body["outliers"] if o["pair_index"] == 7)
    assert (into_glitch["from_build_version"], into_glitch["to_build_version"]) == (
        "t007",
        "t008",
    )
    assert into_glitch["diff_pixel_count"] > body["threshold"]


def test_continuity_endpoint_finds_nothing_in_a_smooth_animation(client: TestClient):
    uploaded = _animation(client, [render_at(i) for i in range(20)])
    body = client.post(
        "/api/analysis/continuity",
        json={"captured_image_ids": [u["captured_image_id"] for u in uploaded]},
    ).json()
    assert body["outliers"] == []


def test_continuity_endpoint_error_cases(client: TestClient):
    uploaded = _animation(client, [render_at(i) for i in range(4)])
    ids = [u["captured_image_id"] for u in uploaded]

    # Fewer than 3 frames is rejected by request validation.
    assert (
        client.post(
            "/api/analysis/continuity", json={"captured_image_ids": ids[:2]}
        ).status_code
        == 422
    )
    # An unknown id is a 404 that names it.
    missing = client.post(
        "/api/analysis/continuity", json={"captured_image_ids": [*ids, "no-such-id"]}
    )
    assert missing.status_code == 404 and "no-such-id" in missing.json()["detail"]

    # A frame at a different resolution is a 422 that says which one.
    odd = _upload(
        client, uploaded[0]["instruction_id"], "wide", render_at(0, size=(W + 8, H))
    )
    mismatch = client.post(
        "/api/analysis/continuity",
        json={"captured_image_ids": [*ids, odd["captured_image_id"]]},
    )
    assert mismatch.status_code == 422 and "frame 4" in mismatch.json()["detail"]


def test_continuity_endpoint_writes_nothing(client: TestClient):
    uploaded = _animation(client, [render_at(i) for i in range(5)])
    before = client.get("/api/runs").json()
    client.post(
        "/api/analysis/continuity",
        json={"captured_image_ids": [u["captured_image_id"] for u in uploaded]},
    )
    assert client.get("/api/runs").json() == before
