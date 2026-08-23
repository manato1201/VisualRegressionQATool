"""Engine-agnostic data model shared by every CaptureAgent implementation.

See docs/CAPTURE_AGENT_DESIGN.md (§2-3) for the rationale behind the
``kind: "view" | "comp"`` split and why ``extra`` stays a free-form dict
instead of a growing set of engine-specific fields.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

SourceKind = Literal["view", "comp"]
EngineName = Literal["unity", "houdini"]


@dataclass(frozen=True)
class CaptureSource:
    """What to capture, independent of how a given engine captures it.

    ``source_id`` meaning depends on ``kind``:
      - "view": a viewport/camera identifier (e.g. "SceneView", "MainCamera").
      - "comp": the path to the ROP node that renders the composite output
        to a file (Houdini), or an equivalent final-output identifier.
    """

    kind: SourceKind
    source_id: str
    engine: EngineName
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RawFrame:
    """The result of a capture: already-encoded image bytes plus metadata
    needed by the backend's CapturedImage record."""

    data: bytes
    width: int
    height: int
    color_space: str = "sRGB"
