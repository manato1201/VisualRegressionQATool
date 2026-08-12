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
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "api.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")

    from app.main import app

    with TestClient(app) as c:
        yield c


def test_full_pipeline_pass_then_regression_then_recovery(client: TestClient):
    instr = client.post(
        "/api/instructions",
        json={"scene_or_level_id": "OutdoorsScene", "seed": 0, "frame_rate": 60},
    ).json()
    instruction_id = instr["instruction_id"]

    baseline_png = _png_bytes((10, 20, 30))
    r1 = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "v1"},
        files={"file": ("v1.png", baseline_png, "image/png")},
    ).json()
    assert r1["dedup_hit"] is False

    promote = client.post(
        "/api/references/promote",
        json={"captured_image_id": r1["captured_image_id"], "approved_by": "qa-bot"},
    ).json()
    assert promote["captured_image_id"] == r1["captured_image_id"]

    # v2: identical frame -> checksum dedupe hit, diff run should pass.
    r2 = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "v2"},
        files={"file": ("v2.png", baseline_png, "image/png")},
    ).json()
    assert r2["dedup_hit"] is True
    assert r2["checksum"] == r1["checksum"]

    diff2 = client.post(
        "/api/diffs/run", json={"captured_image_id": r2["captured_image_id"]}
    ).json()
    assert diff2["evaluation_result"]["verdict"] == "pass"
    assert diff2["diff_image"]["diff_pixel_count"] == 0

    # v3: regression -> fail, alert opened (Noop sink -> no external ref, no DB alert row).
    regressed_png = _png_bytes((250, 5, 5))
    r3 = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "v3"},
        files={"file": ("v3.png", regressed_png, "image/png")},
    ).json()
    diff3 = client.post(
        "/api/diffs/run", json={"captured_image_id": r3["captured_image_id"]}
    ).json()
    assert diff3["evaluation_result"]["verdict"] == "fail"
    assert diff3["diff_image"]["diff_pixel_count"] > 0

    fbc = client.get(f"/api/runs/first-bad-commit/{instruction_id}").json()
    assert fbc["build_version"] == "v3"

    # v1 was only captured + promoted to reference, never diff-evaluated itself,
    # so it has no evaluation_result row and is absent from the runs history.
    runs = client.get("/api/runs", params={"instruction_id": instruction_id}).json()
    assert [r["build_version"] for r in runs] == ["v3", "v2"]

    diff_image_bytes = client.get(
        f"/api/diffs/{diff3['diff_image']['diff_image_id']}/image"
    )
    assert diff_image_bytes.status_code == 200
    assert diff_image_bytes.headers["content-type"] == "image/png"


def test_diff_run_without_any_reference_returns_404(client: TestClient):
    instr = client.post(
        "/api/instructions", json={"scene_or_level_id": "NoRefScene"}
    ).json()
    cap = client.post(
        "/api/captures",
        data={"instruction_id": instr["instruction_id"], "build_version": "v1"},
        files={"file": ("v1.png", _png_bytes((1, 2, 3)), "image/png")},
    ).json()
    resp = client.post(
        "/api/diffs/run", json={"captured_image_id": cap["captured_image_id"]}
    )
    assert resp.status_code == 404


def test_delete_captured_image_via_api(client: TestClient):
    instr = client.post(
        "/api/instructions", json={"scene_or_level_id": "DeleteScene"}
    ).json()
    cap = client.post(
        "/api/captures",
        data={"instruction_id": instr["instruction_id"], "build_version": "v1"},
        files={"file": ("v1.png", _png_bytes((9, 9, 9)), "image/png")},
    ).json()

    delete_resp = client.delete(f"/api/captures/{cap['captured_image_id']}")
    assert delete_resp.status_code == 204
    assert client.get(f"/api/captures/{cap['captured_image_id']}").status_code == 404


def test_cannot_delete_captured_image_used_as_reference_via_api(client: TestClient):
    instr = client.post(
        "/api/instructions", json={"scene_or_level_id": "DeleteRefScene"}
    ).json()
    cap = client.post(
        "/api/captures",
        data={"instruction_id": instr["instruction_id"], "build_version": "v1"},
        files={"file": ("v1.png", _png_bytes((1, 1, 1)), "image/png")},
    ).json()
    client.post(
        "/api/references/promote",
        json={"captured_image_id": cap["captured_image_id"], "approved_by": "qa"},
    )

    delete_resp = client.delete(f"/api/captures/{cap['captured_image_id']}")
    assert delete_resp.status_code == 409
