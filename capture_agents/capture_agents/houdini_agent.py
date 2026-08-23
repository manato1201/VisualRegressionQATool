"""Houdini reference implementation of CaptureAgent.

Must run inside Houdini's own Python (hython, or Houdini's embedded Python
Shell/Source Editor) since it imports ``hou``. See docs/CAPTURE_AGENT_DESIGN.md
§2 for why "comp" sources are modeled as "a ROP node the caller already set
up to write the desired output" rather than this module trying to pull a
raster directly out of a COP2 node — the latter's API differs more across
Houdini versions than the ROP render/read-file pattern does.

Two calls below are flagged as version-sensitive and worth verifying against
the target Houdini install before relying on this in production:
  - ``viewport.setDefaultShadingMode`` / ``hou.viewportShadingMode`` naming
  - the exact set of kwargs ``hou.RopNode.render()`` accepts
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import ClassVar

from .base import CaptureAgent
from .models import CaptureSource, RawFrame

try:
    import hou
except ImportError as exc:  # pragma: no cover - only reachable outside Houdini
    raise ImportError(
        "capture_agents.houdini_agent requires Houdini's own Python "
        "(run via hython, or from within Houdini's Python Shell/Source Editor)."
    ) from exc


def _scene_viewer():
    import toolutils

    scene_viewer = toolutils.sceneViewer()
    if scene_viewer is None:
        raise RuntimeError(
            "no active Scene Viewer pane found (view sources require one)"
        )
    return scene_viewer


def _png_dimensions(data: bytes) -> tuple[int, int]:
    """Read width/height straight out of the PNG IHDR chunk, avoiding a
    Pillow dependency inside Houdini's bundled Python."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("expected PNG data")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return width, height


class HoudiniCaptureAgent(CaptureAgent):
    engine: ClassVar[str] = "houdini"

    def prepare(self, source: CaptureSource) -> None:
        frame = source.extra.get("frame")
        if frame is not None:
            hou.setFrame(frame)

        if source.kind == "view":
            self._prepare_view(source)
        else:
            self._prepare_comp(source)

    def _prepare_view(self, source: CaptureSource) -> None:
        viewport = _scene_viewer().curViewport()
        shading_mode_name = source.extra.get("shading_mode")
        if not shading_mode_name:
            return
        try:
            mode = getattr(hou.viewportShadingMode, shading_mode_name)
        except AttributeError as exc:
            raise ValueError(
                f"unknown shading_mode {shading_mode_name!r} for this Houdini version "
                "(check hou.viewportShadingMode for the valid names on your install)"
            ) from exc
        viewport.setDefaultShadingMode(mode)

    def _prepare_comp(self, source: CaptureSource) -> None:
        if hou.node(source.source_id) is None:
            raise RuntimeError(
                f"ROP node not found: {source.source_id!r} "
                "(comp sources must point at a ROP node already configured to write the "
                "desired composite output to a file)"
            )

    def capture(self, source: CaptureSource) -> RawFrame:
        if source.kind == "view":
            return self._capture_view(source)
        return self._capture_comp(source)

    def _capture_view(self, source: CaptureSource) -> RawFrame:
        viewport = _scene_viewer().curViewport()
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "view.png"
            viewport.saveImage(str(out_path))
            data = out_path.read_bytes()

        width, height = _png_dimensions(data)
        return RawFrame(
            data=data,
            width=width,
            height=height,
            color_space=source.extra.get("color_space", "sRGB"),
        )

    def _capture_comp(self, source: CaptureSource) -> RawFrame:
        rop = hou.node(source.source_id)
        if rop is None:
            raise RuntimeError(f"ROP node not found: {source.source_id!r}")

        output_path = source.extra.get("output_path")
        if not output_path:
            raise ValueError(
                "comp sources must set extra['output_path'] to the file the ROP node writes "
                "-- this agent triggers the render, then reads that file back"
            )

        current_frame = hou.frame()
        rop.render(frame_range=(current_frame, current_frame))

        data = Path(output_path).read_bytes()
        width, height = _png_dimensions(data)
        return RawFrame(
            data=data,
            width=width,
            height=height,
            color_space=source.extra.get("color_space", "sRGB"),
        )
