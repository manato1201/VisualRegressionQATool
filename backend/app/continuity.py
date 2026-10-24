"""Frame-to-frame continuity check for deterministic animation captures
(improvement plan 2026-10, X11).

Given the frames of one animation, captured at pinned times, count how many
pixels change between each adjacent pair and report only the pairs whose change
*jumps* relative to the rest of the sequence. A glitch frame (a one-frame
flash, a missing texture, a pop) shows up as a single huge spike in an
otherwise smooth series -- the motivating case was 1 frame out of 612 changing
95,245 pixels.

This is a separate inspection. It does not touch the pass/fail judgement of a
diff run, and it does not claim a spike is a bug: a deliberate scene cut spikes
too, so the result is a list of candidates for a person to look at.

The threshold is derived from the sequence itself (median + k x robust spread)
rather than a fixed pixel count, so it adapts to the motion in the animation;
``min_jump_percent`` is a floor so a nearly static sequence (spread ~ 0) does
not flag a handful of noisy pixels.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from statistics import median
from typing import Iterable

import numpy as np
from PIL import Image

# 1.4826 makes the median absolute deviation comparable to a standard
# deviation for normally distributed data.
_MAD_TO_SIGMA = 1.4826


class ContinuityInputError(ValueError):
    """The frames cannot be compared (too few, unreadable, or differently sized)."""


@dataclass(frozen=True)
class ContinuityAnalysis:
    pair_diffs: tuple[int, ...]
    total_pixels: int
    median: float
    mad: float
    threshold: float
    outlier_indices: tuple[int, ...]


def count_changed_pixels(
    a: np.ndarray, b: np.ndarray, per_pixel_tolerance: int = 0
) -> int:
    """Pixels where any RGB channel differs by more than the tolerance -- the
    same rule PixelDiffEngine uses, without rendering a highlight image."""
    channel_diff = np.abs(a.astype(np.int16) - b.astype(np.int16))
    return int(np.count_nonzero(np.any(channel_diff > per_pixel_tolerance, axis=2)))


def find_outliers(
    pair_diffs: list[int],
    total_pixels: int,
    *,
    k: float = 6.0,
    min_jump_percent: float = 0.1,
) -> tuple[float, float, float, tuple[int, ...]]:
    """Return (median, mad, threshold, outlier_indices) for a series of
    adjacent-pair change counts. A pair is an outlier only when it exceeds
    both the statistical threshold and the absolute floor."""
    if not pair_diffs:
        return 0.0, 0.0, 0.0, ()
    med = float(median(pair_diffs))
    mad = float(median(abs(d - med) for d in pair_diffs))
    statistical = med + k * _MAD_TO_SIGMA * mad
    floor = med + total_pixels * (min_jump_percent / 100.0)
    threshold = max(statistical, floor)
    outliers = tuple(i for i, d in enumerate(pair_diffs) if d > threshold)
    return med, mad, threshold, outliers


def analyze_frames(
    frames: Iterable[bytes],
    *,
    per_pixel_tolerance: int = 0,
    k: float = 6.0,
    min_jump_percent: float = 0.1,
) -> ContinuityAnalysis:
    """Decode frames one at a time (only the previous one is kept in memory,
    so a long animation does not need to fit in RAM) and analyse the series."""
    pair_diffs: list[int] = []
    previous: np.ndarray | None = None
    count = 0
    for index, data in enumerate(frames):
        try:
            current = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
        except OSError as exc:
            raise ContinuityInputError(
                f"frame {index} is not a readable image: {exc}"
            ) from exc
        if previous is not None:
            if current.shape != previous.shape:
                raise ContinuityInputError(
                    f"frame {index} is {current.shape[1]}x{current.shape[0]} but frame "
                    f"{index - 1} is {previous.shape[1]}x{previous.shape[0]}; "
                    "continuity needs every frame at the same resolution"
                )
            pair_diffs.append(
                count_changed_pixels(previous, current, per_pixel_tolerance)
            )
        previous = current
        count += 1

    if count < 3:
        raise ContinuityInputError(
            "at least 3 frames are needed: with 2 there is only one pair, and nothing to "
            "call an outlier against"
        )

    total_pixels = int(previous.shape[0] * previous.shape[1])  # type: ignore[union-attr]
    med, mad, threshold, outliers = find_outliers(
        pair_diffs, total_pixels, k=k, min_jump_percent=min_jump_percent
    )
    return ContinuityAnalysis(
        pair_diffs=tuple(pair_diffs),
        total_pixels=total_pixels,
        median=med,
        mad=mad,
        threshold=threshold,
        outlier_indices=outliers,
    )
