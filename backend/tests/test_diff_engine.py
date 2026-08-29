from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.diff_engine import ImageDimensionMismatchError, PixelDiffEngine

WIDTH, HEIGHT = 64, 48


def _solid_image(color: tuple[int, int, int]) -> Image.Image:
    arr = np.full((HEIGHT, WIDTH, 3), color, dtype=np.uint8)
    return Image.fromarray(arr, mode="RGB")


def _to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_identical_images_are_pass_with_zero_diff_pixels():
    base = _solid_image((100, 150, 200))
    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(base), _to_bytes(base), per_pixel_tolerance=0, max_diff_pixels=0
    )

    assert result.diff_pixel_count == 0
    assert result.diff_percentage == 0.0
    assert result.verdict == "pass"


def test_only_modified_rectangle_is_highlighted_no_false_positives_outside():
    reference_arr = np.full((HEIGHT, WIDTH, 3), (10, 10, 10), dtype=np.uint8)
    captured_arr = reference_arr.copy()
    # Deliberately alter a known rectangle.
    y0, y1, x0, x1 = 10, 20, 15, 30
    captured_arr[y0:y1, x0:x1] = (255, 255, 255)

    reference = Image.fromarray(reference_arr, mode="RGB")
    captured = Image.fromarray(captured_arr, mode="RGB")

    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(captured),
        _to_bytes(reference),
        per_pixel_tolerance=0,
        max_diff_pixels=0,
    )

    expected_count = (y1 - y0) * (x1 - x0)
    assert result.diff_pixel_count == expected_count
    assert result.verdict == "fail"

    diff_arr = np.asarray(result.diff_image)
    highlight_mask = np.all(diff_arr == (255, 0, 0), axis=2)
    assert highlight_mask.sum() == expected_count
    # Every highlighted pixel is inside the modified rectangle.
    ys, xs = np.where(highlight_mask)
    assert ys.min() >= y0 and ys.max() < y1
    assert xs.min() >= x0 and xs.max() < x1


def test_strict_settings_fail_on_any_single_pixel_regression():
    reference_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    captured_arr = reference_arr.copy()
    captured_arr[0, 0] = (1, 0, 0)  # single-channel, single-pixel drift

    reference = Image.fromarray(reference_arr, mode="RGB")
    captured = Image.fromarray(captured_arr, mode="RGB")

    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(captured),
        _to_bytes(reference),
        per_pixel_tolerance=0,
        max_diff_pixels=0,
    )

    assert result.diff_pixel_count == 1
    assert result.verdict == "fail"


def test_tolerance_absorbs_sub_threshold_noise():
    reference_arr = np.full((HEIGHT, WIDTH, 3), (128, 128, 128), dtype=np.uint8)
    captured_arr = reference_arr.copy()
    captured_arr[5, 5] = (130, 128, 128)  # diff of 2

    reference = Image.fromarray(reference_arr, mode="RGB")
    captured = Image.fromarray(captured_arr, mode="RGB")

    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(captured),
        _to_bytes(reference),
        per_pixel_tolerance=2,
        max_diff_pixels=0,
    )

    assert result.diff_pixel_count == 0
    assert result.verdict == "pass"


def test_min_diff_region_pixels_drops_scattered_noise_but_keeps_real_regression():
    """Simulates JPEG-style scattered single-pixel noise across a whole frame
    plus one deliberate localized change — the noise should be filtered while
    the real regression survives, which is what makes "spot the difference"
    grade precision possible without a perceptual algorithm."""
    reference_arr = np.full((HEIGHT, WIDTH, 3), (120, 120, 120), dtype=np.uint8)
    captured_arr = reference_arr.copy()

    # Isolated single-pixel compression-style noise on a sparse grid (spacing
    # of 4 guarantees no two noise pixels are 8-connected to each other).
    noise_coords = [(y, x) for y in range(1, HEIGHT, 4) for x in range(1, WIDTH, 4)]
    for y, x in noise_coords:
        captured_arr[y, x] = (125, 120, 120)  # diff of 5

    # One deliberate contiguous regression block, well clear of noise pixels.
    y0, y1, x0, x1 = 20, 30, 20, 35
    captured_arr[y0:y1, x0:x1] = (255, 0, 0)
    for y, x in noise_coords:
        if y0 <= y < y1 and x0 <= x < x1:
            captured_arr[y, x] = (
                255,
                0,
                0,
            )  # keep block solid, don't reintroduce noise there

    reference = Image.fromarray(reference_arr, mode="RGB")
    captured = Image.fromarray(captured_arr, mode="RGB")

    engine = PixelDiffEngine()

    unfiltered = engine.compare_bytes(
        _to_bytes(captured),
        _to_bytes(reference),
        per_pixel_tolerance=0,
        max_diff_pixels=0,
    )
    assert unfiltered.diff_pixel_count > (y1 - y0) * (x1 - x0), (
        "noise should inflate the raw diff count"
    )

    filtered = engine.compare_bytes(
        _to_bytes(captured),
        _to_bytes(reference),
        per_pixel_tolerance=0,
        max_diff_pixels=0,
        min_diff_region_pixels=20,
    )
    assert filtered.diff_pixel_count == (y1 - y0) * (x1 - x0)
    assert filtered.verdict == "fail"


def test_min_diff_region_pixels_defaults_to_no_filtering():
    reference_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    captured_arr = reference_arr.copy()
    captured_arr[3, 3] = (10, 0, 0)

    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(Image.fromarray(captured_arr, mode="RGB")),
        _to_bytes(Image.fromarray(reference_arr, mode="RGB")),
        per_pixel_tolerance=0,
        max_diff_pixels=0,
    )
    assert result.diff_pixel_count == 1


def test_dimension_mismatch_raises_instead_of_silently_tolerating():
    small = _solid_image((0, 0, 0))
    big_arr = np.zeros((HEIGHT + 1, WIDTH, 3), dtype=np.uint8)
    big = Image.fromarray(big_arr, mode="RGB")

    engine = PixelDiffEngine()
    with pytest.raises(ImageDimensionMismatchError):
        engine.compare_bytes(_to_bytes(small), _to_bytes(big))


def test_dimension_mismatch_still_raises_when_allow_center_crop_is_false():
    small = _solid_image((0, 0, 0))
    big = Image.fromarray(np.zeros((HEIGHT + 1, WIDTH, 3), dtype=np.uint8), mode="RGB")

    engine = PixelDiffEngine()
    with pytest.raises(ImageDimensionMismatchError):
        engine.compare_bytes(_to_bytes(small), _to_bytes(big), allow_center_crop=False)


def test_allow_center_crop_compares_the_shared_center_region():
    # Reference is the full-size frame; captured is 4px narrower and 2px
    # shorter, i.e. what a slightly-resized Game View window would produce.
    reference_arr = np.full((HEIGHT, WIDTH, 3), (100, 100, 100), dtype=np.uint8)
    # A distinct rectangle placed dead center, so it survives cropping.
    cy0, cy1 = HEIGHT // 2 - 5, HEIGHT // 2 + 5
    cx0, cx1 = WIDTH // 2 - 5, WIDTH // 2 + 5
    reference_arr[cy0:cy1, cx0:cx1] = (200, 50, 50)

    captured_full = reference_arr.copy()
    # Give the edges (which get cropped away) wildly different content --
    # if cropping did not happen, these would dominate the diff.
    captured_full[0, :] = (255, 255, 0)
    captured_full[:, 0] = (255, 255, 0)

    reference = Image.fromarray(reference_arr, mode="RGB")
    captured_cropped_size = Image.fromarray(captured_full, mode="RGB").crop(
        (2, 1, WIDTH - 2, HEIGHT - 1)
    )
    assert captured_cropped_size.size == (WIDTH - 4, HEIGHT - 2)

    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(captured_cropped_size),
        _to_bytes(reference),
        per_pixel_tolerance=0,
        max_diff_pixels=0,
        allow_center_crop=True,
    )

    # The shared center region is identical, so once both sides are cropped
    # to the common size the diff should be zero despite the size mismatch.
    assert result.diff_pixel_count == 0
    assert result.verdict == "pass"
    assert result.resolution_note is not None
    assert "center-cropped" in result.resolution_note
    assert (
        str(WIDTH - 4) in result.resolution_note
        or str(HEIGHT - 2) in result.resolution_note
    )


def test_allow_center_crop_leaves_matching_sizes_untouched():
    base = _solid_image((10, 20, 30))
    engine = PixelDiffEngine()
    result = engine.compare_bytes(
        _to_bytes(base), _to_bytes(base), allow_center_crop=True
    )
    assert result.resolution_note is None
    assert result.diff_pixel_count == 0
