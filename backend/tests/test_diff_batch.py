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
    monkeypatch.setenv("VRQA_DB_PATH", str(tmp_path / "batch.sqlite3"))
    monkeypatch.setenv("VRQA_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("VRQA_ALERT_SINK", "noop")

    from app.main import app

    with TestClient(app) as c:
        yield c


def _setup_instruction_with_reference(
    client: TestClient, scene_id: str
) -> tuple[str, tuple[int, int]]:
    instr = client.post(
        "/api/instructions", json={"scene_or_level_id": scene_id}
    ).json()
    instruction_id = instr["instruction_id"]
    baseline = _png_bytes((50, 60, 70))
    ref_cap = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "reference"},
        files={"file": ("ref.png", baseline, "image/png")},
    ).json()
    client.post(
        "/api/references/promote",
        json={"captured_image_id": ref_cap["captured_image_id"], "approved_by": "qa"},
    )
    return instruction_id, (32, 24)


def test_batch_runs_diff_for_every_captured_image(client: TestClient):
    instruction_id, size = _setup_instruction_with_reference(client, "BatchScene")

    ids = []
    for i, color in enumerate([(50, 60, 70), (50, 60, 70), (250, 0, 0)]):
        cap = client.post(
            "/api/captures",
            data={"instruction_id": instruction_id, "build_version": f"v{i}"},
            files={"file": (f"v{i}.png", _png_bytes(color, size), "image/png")},
        ).json()
        ids.append(cap["captured_image_id"])

    resp = client.post("/api/diffs/run-batch", json={"captured_image_ids": ids})
    assert resp.status_code == 200
    body = resp.json()
    results = body["results"]
    assert len(results) == 3
    assert all(r["ok"] for r in results)
    verdicts = [r["evaluation_result"]["verdict"] for r in results]
    assert verdicts == ["pass", "pass", "fail"]

    runs = client.get("/api/runs", params={"instruction_id": instruction_id}).json()
    assert len(runs) == 3


def test_batch_isolates_a_single_bad_item_without_aborting_the_rest(client: TestClient):
    instruction_id, size = _setup_instruction_with_reference(client, "BatchMixedScene")

    good1 = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "good1"},
        files={"file": ("good1.png", _png_bytes((50, 60, 70), size), "image/png")},
    ).json()
    # Wrong resolution -> this one item should fail without affecting the others.
    bad = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "bad"},
        files={"file": ("bad.png", _png_bytes((50, 60, 70), (64, 48)), "image/png")},
    ).json()
    good2 = client.post(
        "/api/captures",
        data={"instruction_id": instruction_id, "build_version": "good2"},
        files={"file": ("good2.png", _png_bytes((250, 0, 0), size), "image/png")},
    ).json()

    resp = client.post(
        "/api/diffs/run-batch",
        json={
            "captured_image_ids": [
                good1["captured_image_id"],
                bad["captured_image_id"],
                good2["captured_image_id"],
            ]
        },
    )
    assert resp.status_code == 200
    results = {r["captured_image_id"]: r for r in resp.json()["results"]}

    assert results[good1["captured_image_id"]]["ok"] is True
    assert results[good1["captured_image_id"]]["evaluation_result"]["verdict"] == "pass"

    assert results[bad["captured_image_id"]]["ok"] is False
    assert results[bad["captured_image_id"]]["error"] is not None
    assert results[bad["captured_image_id"]]["diff_image"] is None

    assert results[good2["captured_image_id"]]["ok"] is True
    assert results[good2["captured_image_id"]]["evaluation_result"]["verdict"] == "fail"


def test_batch_with_empty_list_returns_empty_results(client: TestClient):
    resp = client.post("/api/diffs/run-batch", json={"captured_image_ids": []})
    assert resp.status_code == 200
    assert resp.json()["results"] == []


def test_batch_item_referencing_unknown_captured_image_reports_404_style_error(
    client: TestClient,
):
    instruction_id, _size = _setup_instruction_with_reference(
        client, "BatchUnknownScene"
    )
    resp = client.post(
        "/api/diffs/run-batch", json={"captured_image_ids": ["does-not-exist"]}
    )
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["ok"] is False
    assert "not found" in result["error"]
