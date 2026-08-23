"""Standalone smoke test for the CaptureAgent common interface.

Runs against a *real* running backend (see README.md) using a fake agent
that stands in for HoudiniCaptureAgent/UnityCaptureAgent -- so you can watch
the whole prepare -> capture -> upload -> diff -> first-bad-commit flow work
without needing Houdini or Unity installed.

Usage:
    cd capture_agents
    uv sync --dev
    uv run --with pillow --with numpy python examples/fake_agent_smoke_test.py
"""

from __future__ import annotations

import io
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, __file__.rsplit("examples", 1)[0])

from capture_agents.base import BackendClient, CaptureAgent, run_capture_and_diff
from capture_agents.models import CaptureSource, RawFrame

BACKEND_URL = "http://127.0.0.1:8000"


def png_bytes(color: tuple[int, int, int], size: tuple[int, int] = (48, 32)) -> bytes:
    arr = np.full((size[1], size[0], 3), color, dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


class FakeAgent(CaptureAgent):
    """Stands in for HoudiniCaptureAgent / UnityCaptureAgent: same contract,
    just returns a solid-color test frame instead of really rendering."""

    engine = "houdini"

    def __init__(self, color: tuple[int, int, int]) -> None:
        self.color = color

    def prepare(self, source: CaptureSource) -> None:
        print(f"  prepare({source.kind}, {source.source_id!r})")

    def capture(self, source: CaptureSource) -> RawFrame:
        data = png_bytes(self.color)
        print(f"  capture() -> {len(data)} bytes")
        return RawFrame(data=data, width=48, height=32, color_space="sRGB")


def main() -> None:
    backend = BackendClient(BACKEND_URL)
    source = CaptureSource(
        kind="comp", source_id="/img/comp1/OUT", engine="houdini", extra={"frame": 1001}
    )

    print("1) baseline capture -> promote to reference")
    baseline_agent = FakeAgent((30, 60, 90))
    instruction_id = backend.ensure_instruction(
        scene_or_level_id="CaptureAgentSmokeTest"
    )
    baseline_agent.prepare(source)
    baseline_frame = baseline_agent.capture(source)
    baseline_capture = backend.upload_capture(
        instruction_id, "smoke-v1", baseline_frame
    )
    backend.promote_reference(
        baseline_capture["captured_image_id"], approved_by="smoke-test"
    )
    print(f"   instruction_id = {instruction_id}")

    print("\n2) same image again -> expect pass")
    result_pass = run_capture_and_diff(
        FakeAgent((30, 60, 90)),
        source,
        backend,
        build_version="smoke-v2",
        instruction_id=instruction_id,
    )
    print(f"   verdict = {result_pass['evaluation_result']['verdict']}")
    assert result_pass["evaluation_result"]["verdict"] == "pass"

    print("\n3) different image -> expect fail")
    result_fail = run_capture_and_diff(
        FakeAgent((250, 10, 10)),
        source,
        backend,
        build_version="smoke-v3",
        instruction_id=instruction_id,
    )
    print(f"   verdict = {result_fail['evaluation_result']['verdict']}")
    assert result_fail["evaluation_result"]["verdict"] == "fail"

    print("\n4) first-bad-commit query")
    fbc = backend._client.get(f"/api/runs/first-bad-commit/{instruction_id}").json()
    print(f"   first bad build_version = {fbc['build_version']}")
    assert fbc["build_version"] == "smoke-v3"

    print(
        "\nAll good -- open the web UI and look for instruction 'CaptureAgentSmokeTest'."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"\nSmoke test failed: {exc}")
        print(
            f"Is the backend running at {BACKEND_URL}? (uv run uvicorn app.main:app --port 8000 --reload in backend/)"
        )
        raise
