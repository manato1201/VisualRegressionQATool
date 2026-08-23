from __future__ import annotations

import httpx
import pytest

from capture_agents.base import BackendClient, CaptureAgent, run_capture_and_diff
from capture_agents.models import CaptureSource, RawFrame


class _FakeAgent(CaptureAgent):
    engine = "houdini"

    def __init__(self) -> None:
        self.prepared_with: CaptureSource | None = None

    def prepare(self, source: CaptureSource) -> None:
        self.prepared_with = source

    def capture(self, source: CaptureSource) -> RawFrame:
        return RawFrame(data=b"fake-png-bytes", width=64, height=48, color_space="sRGB")


def _client_with_handler(handler) -> BackendClient:
    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(base_url="http://backend.local", transport=transport)
    return BackendClient(base_url="http://backend.local", client=http_client)


def test_ensure_instruction_prefers_explicit_id_without_any_http_call():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(
            "should not make any HTTP call when instruction_id is given"
        )

    backend = _client_with_handler(handler)
    assert backend.ensure_instruction(instruction_id="instr-123") == "instr-123"


def test_ensure_instruction_reuses_existing_scene_match():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/instructions"
        return httpx.Response(
            200,
            json=[
                {"instruction_id": "old-1", "scene_or_level_id": "OtherScene"},
                {"instruction_id": "match-1", "scene_or_level_id": "OutdoorsScene"},
            ],
        )

    backend = _client_with_handler(handler)
    assert backend.ensure_instruction(scene_or_level_id="OutdoorsScene") == "match-1"


def test_ensure_instruction_creates_when_no_scene_match():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if request.method == "GET":
            return httpx.Response(200, json=[])
        assert request.method == "POST"
        body = request.read()
        assert b"NewScene" in body
        return httpx.Response(
            200, json={"instruction_id": "created-1", "scene_or_level_id": "NewScene"}
        )

    backend = _client_with_handler(handler)
    assert backend.ensure_instruction(scene_or_level_id="NewScene") == "created-1"
    assert calls == ["GET", "POST"]


def test_ensure_instruction_requires_some_identifier():
    backend = _client_with_handler(lambda r: httpx.Response(200, json=[]))
    with pytest.raises(ValueError):
        backend.ensure_instruction()


def test_upload_capture_sends_multipart_with_color_space():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["content_type"] = request.headers["content-type"]
        seen["body"] = request.read()
        return httpx.Response(200, json={"captured_image_id": "cap-1"})

    backend = _client_with_handler(handler)
    frame = RawFrame(data=b"pngdata", width=10, height=10, color_space="Linear")
    result = backend.upload_capture("instr-1", "v1", frame)

    assert result["captured_image_id"] == "cap-1"
    assert "multipart/form-data" in seen["content_type"]
    assert b"Linear" in seen["body"]
    assert b"pngdata" in seen["body"]


def test_run_diff_and_run_diff_batch_post_expected_payloads():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((str(request.url.path), request.read()))
        return httpx.Response(200, json={"ok": True})

    backend = _client_with_handler(handler)
    backend.run_diff("cap-1", per_pixel_tolerance=10)
    backend.run_diff_batch(["cap-1", "cap-2"], min_diff_region_pixels=20)

    assert seen[0][0] == "/api/diffs/run"
    assert b'"per_pixel_tolerance":10' in seen[0][1]
    assert seen[1][0] == "/api/diffs/run-batch"
    assert b'"min_diff_region_pixels":20' in seen[1][1]


def test_run_capture_and_diff_calls_prepare_then_capture_then_uploads_then_diffs():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/captures":
            return httpx.Response(200, json={"captured_image_id": "cap-42"})
        if request.url.path == "/api/diffs/run":
            body = request.read()
            assert b"cap-42" in body
            return httpx.Response(200, json={"evaluation_result": {"verdict": "pass"}})
        raise AssertionError(f"unexpected call: {request.url.path}")

    agent = _FakeAgent()
    backend = _client_with_handler(handler)
    source = CaptureSource(kind="view", source_id="SceneView", engine="houdini")

    result = run_capture_and_diff(
        agent, source, backend, build_version="v1", instruction_id="instr-1"
    )

    assert agent.prepared_with is source
    assert result["evaluation_result"]["verdict"] == "pass"
    assert calls == ["/api/captures", "/api/diffs/run"]
