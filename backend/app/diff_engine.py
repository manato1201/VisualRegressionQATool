"""Phase 3 PixelDiffEngine: strict per-pixel comparison only.

Deliberately excludes SSIM / perceptualdiff / ImageMagick-compare style
"smart" evaluation per Phase 0 / Phase 3 design decision — reproducibility
first, evaluation stays simple.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

HIGHLIGHT_COLOR = (255, 0, 0)
BACKGROUND_DIM_FACTOR = 0.35


@dataclass
class DiffResult:
    diff_pixel_count: int
    diff_percentage: float
    verdict: str  # "pass" | "fail"
    diff_image: Image.Image
    width: int
    height: int


class ImageDimensionMismatchError(ValueError):
    """Raised when captured/reference resolutions differ.

    A resolution mismatch means the capture is not comparable at all — it is
    not something ``per_pixel_tolerance`` should paper over.
    """


class PixelDiffEngine:
    def compare(
        self,
        captured_path: str | Path,
        reference_path: str | Path,
        per_pixel_tolerance: int = 0,
        max_diff_pixels: int = 0,
    ) -> DiffResult:
        """厳密ピクセル比較。SSIM等の知覚的評価は行わない"""
        captured = Image.open(captured_path).convert("RGB")
        reference = Image.open(reference_path).convert("RGB")
        return self._compare_images(captured, reference, per_pixel_tolerance, max_diff_pixels)

    def compare_bytes(
        self,
        captured_bytes: bytes,
        reference_bytes: bytes,
        per_pixel_tolerance: int = 0,
        max_diff_pixels: int = 0,
    ) -> DiffResult:
        captured = Image.open(io.BytesIO(captured_bytes)).convert("RGB")
        reference = Image.open(io.BytesIO(reference_bytes)).convert("RGB")
        return self._compare_images(captured, reference, per_pixel_tolerance, max_diff_pixels)

    def _compare_images(
        self,
        captured: Image.Image,
        reference: Image.Image,
        per_pixel_tolerance: int,
        max_diff_pixels: int,
    ) -> DiffResult:
        if captured.size != reference.size:
            raise ImageDimensionMismatchError(
                f"captured size {captured.size} != reference size {reference.size}"
            )

        cap_arr = np.asarray(captured, dtype=np.int16)
        ref_arr = np.asarray(reference, dtype=np.int16)

        channel_diff = np.abs(cap_arr - ref_arr)
        diff_mask = np.any(channel_diff > per_pixel_tolerance, axis=2)

        diff_pixel_count = int(np.count_nonzero(diff_mask))
        total_pixels = diff_mask.size
        diff_percentage = (diff_pixel_count / total_pixels * 100.0) if total_pixels else 0.0
        verdict = "pass" if diff_pixel_count <= max_diff_pixels else "fail"

        diff_image = self._render_highlight(cap_arr.astype(np.uint8), diff_mask)

        return DiffResult(
            diff_pixel_count=diff_pixel_count,
            diff_percentage=diff_percentage,
            verdict=verdict,
            diff_image=diff_image,
            width=captured.width,
            height=captured.height,
        )

    @staticmethod
    def _render_highlight(captured_arr: np.ndarray, diff_mask: np.ndarray) -> Image.Image:
        dimmed = (captured_arr.astype(np.float32) * BACKGROUND_DIM_FACTOR).astype(np.uint8)
        out = np.where(diff_mask[..., None], captured_arr, dimmed)
        out[diff_mask] = HIGHLIGHT_COLOR
        return Image.fromarray(out.astype(np.uint8), mode="RGB")
