"""CaptureAgent contract + the HTTP orchestration shared by every engine.

Everything below ``prepare()``/``capture()`` talks to the *existing*
VisualRegressionQATool backend (see backend/app/routers/) without any
server-side changes — see docs/CAPTURE_AGENT_DESIGN.md.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar

import httpx

from .models import CaptureSource, RawFrame


class CaptureAgent(ABC):
    """Implemented once per engine (Houdini here; Unity in C#, same contract)."""

    engine: ClassVar[str]

    @abstractmethod
    def prepare(self, source: CaptureSource) -> None:
        """Freeze whatever needs to be deterministic before capture (camera
        pose, display flags, cook state). Corresponds to Phase 1
        (DeterminismController / JitterOverride) in the design doc."""

    @abstractmethod
    def capture(self, source: CaptureSource) -> RawFrame:
        """Grab pixels for ``source`` and return them already PNG-encoded.
        Must not destructively mutate scene/network state."""


class BackendClient:
    """Thin wrapper around the existing FastAPI endpoints. No new server-side
    surface is introduced — see docs/CAPTURE_AGENT_DESIGN.md §1."""

    def __init__(self, base_url: str, client: httpx.Client | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(base_url=self.base_url, timeout=30.0)

    def list_instructions(self) -> list[dict[str, Any]]:
        resp = self._client.get("/api/instructions")
        resp.raise_for_status()
        return resp.json()

    def create_instruction(
        self, scene_or_level_id: str, **kwargs: Any
    ) -> dict[str, Any]:
        resp = self._client.post(
            "/api/instructions", json={"scene_or_level_id": scene_or_level_id, **kwargs}
        )
        resp.raise_for_status()
        return resp.json()

    def ensure_instruction(
        self,
        *,
        instruction_id: str | None = None,
        scene_or_level_id: str | None = None,
        create_kwargs: dict[str, Any] | None = None,
    ) -> str:
        """Resolve the instruction_id to upload against.

        Passing ``instruction_id`` explicitly is the recommended path for
        repeated CI runs — it guarantees the same history chain across
        builds, which the first-bad-commit query depends on. See
        docs/CAPTURE_AGENT_DESIGN.md §6 for why a fresh instruction per run
        would silently break that query.
        """
        if instruction_id:
            return instruction_id
        if not scene_or_level_id:
            raise ValueError(
                "either instruction_id or scene_or_level_id must be provided"
            )

        for instr in self.list_instructions():
            if instr["scene_or_level_id"] == scene_or_level_id:
                return instr["instruction_id"]

        created = self.create_instruction(scene_or_level_id, **(create_kwargs or {}))
        return created["instruction_id"]

    def upload_capture(
        self,
        instruction_id: str,
        build_version: str,
        frame: RawFrame,
        *,
        filename: str = "capture.png",
    ) -> dict[str, Any]:
        resp = self._client.post(
            "/api/captures",
            data={
                "instruction_id": instruction_id,
                "build_version": build_version,
                "color_space": frame.color_space,
            },
            files={"file": (filename, frame.data, "image/png")},
        )
        resp.raise_for_status()
        return resp.json()

    def run_diff(self, captured_image_id: str, **diff_settings: Any) -> dict[str, Any]:
        resp = self._client.post(
            "/api/diffs/run",
            json={"captured_image_id": captured_image_id, **diff_settings},
        )
        resp.raise_for_status()
        return resp.json()

    def run_diff_batch(
        self, captured_image_ids: list[str], **diff_settings: Any
    ) -> dict[str, Any]:
        resp = self._client.post(
            "/api/diffs/run-batch",
            json={"captured_image_ids": captured_image_ids, **diff_settings},
        )
        resp.raise_for_status()
        return resp.json()

    def promote_reference(
        self, captured_image_id: str, approved_by: str = "capture-agent"
    ) -> dict[str, Any]:
        resp = self._client.post(
            "/api/references/promote",
            json={"captured_image_id": captured_image_id, "approved_by": approved_by},
        )
        resp.raise_for_status()
        return resp.json()


def run_capture_and_diff(
    agent: CaptureAgent,
    source: CaptureSource,
    backend: BackendClient,
    *,
    build_version: str,
    instruction_id: str | None = None,
    scene_or_level_id: str | None = None,
    diff_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The common lifecycle: prepare -> capture -> upload -> diff.

    Identical for every engine; only ``agent`` differs. Returns the
    DiffRunResult payload from ``POST /api/diffs/run``.
    """
    agent.prepare(source)
    frame = agent.capture(source)

    resolved_instruction_id = backend.ensure_instruction(
        instruction_id=instruction_id, scene_or_level_id=scene_or_level_id
    )
    captured = backend.upload_capture(resolved_instruction_id, build_version, frame)
    return backend.run_diff(captured["captured_image_id"], **(diff_settings or {}))
