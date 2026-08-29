from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image


def _png_bytes(color: tuple[int, int, int], size=(32, 24)) -> bytes:
    arr = np.full((size[1], size[0], 3), color, dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "dashboard.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")

    from app.main import app

    with TestClient(app) as c:
        yield c


def _new_scene_with_reference(
    client: TestClient, scene_id: str, color: tuple[int, int, int]
) -> str:
    instr = client.post(
        "/api/instructions", json={"scene_or_level_id": scene_id}
    ).json()
    instruction_id = instr["instruction_id"]
    ref_cap = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "reference"},
        files={"file": ("ref.png", _png_bytes(color), "image/png")},
    ).json()
    client.post(
        "/api/references/promote",
        json={"captured_image_id": ref_cap["captured_image_id"], "approved_by": "qa"},
    )
    return instruction_id


def test_dashboard_includes_an_instruction_with_no_runs_yet(client: TestClient):
    instr = client.post(
        "/api/instructions", json={"scene_or_level_id": "UntestedScene"}
    ).json()
    rows = client.get("/api/runs/dashboard").json()
    row = next(r for r in rows if r["instruction_id"] == instr["instruction_id"])
    assert row["latest_verdict"] is None
    assert row["total_runs"] == 0
    assert row["has_active_reference"] is False
    assert row["open_alert_count"] == 0


def test_dashboard_orders_failing_scenes_before_passing_ones(client: TestClient):
    passing_id = _new_scene_with_reference(client, "PassingScene", (10, 10, 10))
    passing_cap = client.post(
        "/api/captures",
        data={"instruction_id": passing_id, "build_version": "v1"},
        files={"file": ("v1.png", _png_bytes((10, 10, 10)), "image/png")},
    ).json()
    client.post(
        "/api/diffs/run", json={"captured_image_id": passing_cap["captured_image_id"]}
    )

    failing_id = _new_scene_with_reference(client, "FailingScene", (10, 10, 10))
    failing_cap = client.post(
        "/api/captures",
        data={"instruction_id": failing_id, "build_version": "v1"},
        files={"file": ("v1.png", _png_bytes((250, 0, 0)), "image/png")},
    ).json()
    client.post(
        "/api/diffs/run", json={"captured_image_id": failing_cap["captured_image_id"]}
    )

    rows = client.get("/api/runs/dashboard").json()
    ids_in_order = [r["instruction_id"] for r in rows]
    assert ids_in_order.index(failing_id) < ids_in_order.index(passing_id)

    failing_row = next(r for r in rows if r["instruction_id"] == failing_id)
    assert failing_row["latest_verdict"] == "fail"
    assert failing_row["latest_build_version"] == "v1"
    assert failing_row["total_runs"] == 1
    assert failing_row["has_active_reference"] is True


def test_dashboard_reports_open_alert_count(client: TestClient):
    instruction_id = _new_scene_with_reference(client, "AlertScene", (10, 10, 10))
    cap = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "v1"},
        files={"file": ("v1.png", _png_bytes((250, 0, 0)), "image/png")},
    ).json()
    client.post("/api/diffs/run", json={"captured_image_id": cap["captured_image_id"]})

    rows = client.get("/api/runs/dashboard").json()
    row = next(r for r in rows if r["instruction_id"] == instruction_id)
    # NoopAlertSink never returns an external_ref, so no alert_issue row is
    # ever created -- this just pins down that shape rather than assuming
    # a specific sink's behavior.
    assert row["open_alert_count"] == 0
