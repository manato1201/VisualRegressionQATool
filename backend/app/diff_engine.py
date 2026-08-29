"""Phase 3 PixelDiffEngine: strict per-pixel comparison only.

Deliberately excludes SSIM / perceptualdiff / ImageMagick-compare style
"smart" evaluation per Phase 0 / Phase 3 design decision — reproducibility
first, evaluation stays simple.

Three knobs exist to make the strict comparison usable against real
(non-deterministically-encoded, or slightly-differently-sized) images
without reaching for a perceptual algorithm:

- ``per_pixel_tolerance`` absorbs small per-channel intensity noise (e.g.
  JPEG requantization) — still a literal per-pixel threshold, not a
  perceptual metric.
- ``min_diff_region_pixels`` drops isolated/scattered diff pixels that don't
  form a contiguous blob of at least that size. It is a connectivity filter
  on the exact-diff mask (via ``scipy.ndimage.label``), not a similarity
  score — a single stray compression-noise pixel here and there is dropped,
  while a real localized change (a moved object, a color swap) survives
  because its diff pixels are contiguous.
- ``allow_center_crop`` is an explicit, opt-in escape hatch for a resolution
  mismatch (e.g. a Game View window that resized by a couple of pixels): both
  images are center-cropped to their common minimum size before comparing,
  and the result records exactly what was cropped away (``resolution_note``)
  so this is never a silent thing. Off by default -- a resolution mismatch
  is still rejected outright unless a caller explicitly asks to tolerate it.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HIGHLIGHT_COLOR = (255, 0, 0)
BACKGROUND_DIM_FACTOR = 0.35
_CONNECTIVITY_8 = np.ones((3, 3), dtype=bool)


@dataclass
class DiffResult:
    diff_pixel_count: int
    diff_percentage: float
    verdict: str  # "pass" | "fail"
    diff_image: Image.Image
    width: int
    height: int
    resolution_note: str | None = None


class ImageDimensionMismatchError(ValueError):
    """Raised when captured/reference resolutions differ and
    ``allow_center_crop`` was not set.

    A resolution mismatch means the capture is not comparable at all — it is
    not something ``per_pixel_tolerance`` should paper over by default.
    """


class PixelDiffEngine:
    def compare(
        self,
        captured_path: str | Path,
        reference_path: str | Path,
        per_pixel_tolerance: int = 0,
        max_diff_pixels: int = 0,
        min_diff_region_pixels: int = 1,
        allow_center_crop: bool = False,
    ) -> DiffResult:
        """厳密ピクセル比較。SSIM等の知覚的評価は行わない"""
        captured = Image.open(captured_path).convert("RGB")
        reference = Image.open(reference_path).convert("RGB")
        return self._compare_images(
            captured, reference, per_pixel_tolerance, max_diff_pixels, min_diff_region_pixels, allow_center_crop
        )

    def compare_bytes(
        self,
        captured_bytes: bytes,
        reference_bytes: bytes,
        per_pixel_tolerance: int = 0,
        max_diff_pixels: int = 0,
        min_diff_region_pixels: int = 1,
        allow_center_crop: bool = False,
    ) -> DiffResult:
        captured = Image.open(io.BytesIO(captured_bytes)).convert("RGB")
        reference = Image.open(io.BytesIO(reference_bytes)).convert("RGB")
        return self._compare_images(
            captured, reference, per_pixel_tolerance, max_diff_pixels, min_diff_region_pixels, allow_center_crop
        )

    def _compare_images(
        self,
        captured: Image.Image,
        reference: Image.Image,
        per_pixel_tolerance: int,
        max_diff_pixels: int,
        min_diff_region_pixels: int,
        allow_center_crop: bool,
    ) -> DiffResult:
        resolution_note: str | None = None
        if captured.size != reference.size:
            if not allow_center_crop:
                raise ImageDimensionMismatchError(
                    f"captured size {captured.size} != reference size {reference.size}"
                )
            captured, reference, resolution_note = self._center_crop_to_common_size(captured, reference)

        cap_arr = np.asarray(captured, dtype=np.int16)
        ref_arr = np.asarray(reference, dtype=np.int16)

        channel_diff = np.abs(cap_arr - ref_arr)
        diff_mask = np.any(channel_diff > per_pixel_tolerance, axis=2)

        if min_diff_region_pixels > 1 and diff_mask.any():
            diff_mask = self._drop_small_regions(diff_mask, min_diff_region_pixels)

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
            resolution_note=resolution_note,
        )

    @staticmethod
    def _center_crop_to_common_size(
        captured: Image.Image, reference: Image.Image
    ) -> tuple[Image.Image, Image.Image, str]:
        """Crop both images, centered, to their shared minimum width/height.

        This throws away real pixels near the edges of whichever image is
        larger -- acceptable only because the caller explicitly opted in via
        ``allow_center_crop``, and the exact original sizes are always
        reported back in ``resolution_note`` for the audit trail.
        """
        common_width = min(captured.width, reference.width)
        common_height = min(captured.height, reference.height)

        def _crop(img: Image.Image) -> Image.Image:
            left = (img.width - common_width) // 2
            top = (img.height - common_height) // 2
            return img.crop((left, top, left + common_width, top + common_height))

        note = (
            f"resolution mismatch tolerated: captured {captured.width}x{captured.height} / "
            f"reference {reference.width}x{reference.height} -> center-cropped to "
            f"{common_width}x{common_height}"
        )
        return _crop(captured), _crop(reference), note

    @staticmethod
    def _drop_small_regions(diff_mask: np.ndarray, min_diff_region_pixels: int) -> np.ndarray:
        """Zero out connected diff blobs smaller than ``min_diff_region_pixels``.

        Still an exact per-pixel diff underneath — this only decides whether a
        cluster of already-different pixels is large enough to report,
        filtering scattered single-pixel compression noise.
        """
        labeled, num_labels = ndimage.label(diff_mask, structure=_CONNECTIVITY_8)
        if num_labels == 0:
            return diff_mask
        region_sizes = np.bincount(labeled.ravel())
        keep = region_sizes >= min_diff_region_pixels
        keep[0] = False  # background label
        return keep[labeled]

    @staticmethod
    def _render_highlight(captured_arr: np.ndarray, diff_mask: np.ndarray) -> Image.Image:
        dimmed = (captured_arr.astype(np.float32) * BACKGROUND_DIM_FACTOR).astype(np.uint8)
        out = np.where(diff_mask[..., None], captured_arr, dimmed)
        out[diff_mask] = HIGHLIGHT_COLOR
        return Image.fromarray(out.astype(np.uint8), mode="RGB")
