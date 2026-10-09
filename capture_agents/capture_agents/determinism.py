"""Capture-determinism helpers (improvement plan 2026-10, Q1).

The tool's core stance is "make capture deterministic first, keep the
evaluation a plain per-pixel comparison". Animated UIs break that unless the
capture side pins time and motion down before grabbing pixels. This module
holds the engine-agnostic parts:

- ``apply_instruction_conditions`` copies the determinism fields stored on a
  CaptureInstruction (``seed``, ``fixed_time_seconds``, ``reduce_motion``)
  into ``CaptureSource.extra`` so every agent reads them from one place.
- ``FREEZE_ANIMATIONS_CSS`` is the stylesheet to inject into a browser-based
  capture (Playwright etc.) next to ``reduced_motion="reduce"`` emulation.
- ``check_determinism`` captures the same source N times and reports whether
  the results are identical -- the "10 captures, diff rate 0" acceptance check.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from typing import Any

from .base import CaptureAgent
from .models import CaptureSource

# Injected into the page before capture. ``animation: none`` alone would leave
# elements at their *final* keyframe state while ``animation-play-state:
# paused`` + zero delay would freeze them mid-flight at a timing-dependent
# frame, so animations and transitions are removed outright; caret blink and
# smooth scrolling are the two other common sources of run-to-run drift.
FREEZE_ANIMATIONS_CSS = """
*, *::before, *::after {
  animation: none !important;
  animation-delay: 0s !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
""".strip()

_CONDITION_KEYS = ("seed", "fixed_time_seconds", "reduce_motion")


def apply_instruction_conditions(
    source: CaptureSource, instruction: dict[str, Any]
) -> CaptureSource:
    """Return ``source`` with the instruction's determinism fields merged into
    ``extra``. Values already present in ``source.extra`` win, so a caller can
    still override one capture without editing the stored instruction."""
    merged = {
        k: instruction[k] for k in _CONDITION_KEYS if instruction.get(k) is not None
    }
    merged.update(source.extra)
    return replace(source, extra=merged)


@dataclass(frozen=True)
class DeterminismReport:
    runs: int
    checksums: tuple[str, ...]

    @property
    def distinct_checksums(self) -> int:
        return len(set(self.checksums))

    @property
    def identical(self) -> bool:
        return self.distinct_checksums == 1

    @property
    def mismatched_runs(self) -> tuple[int, ...]:
        """0-based indices of runs whose output differs from run 0."""
        first = self.checksums[0]
        return tuple(i for i, c in enumerate(self.checksums) if c != first)


def check_determinism(
    agent: CaptureAgent, source: CaptureSource, runs: int = 10
) -> DeterminismReport:
    """Capture ``source`` ``runs`` times (running ``prepare`` before each) and
    hash the encoded images.

    Equal hashes prove identical pixels. A mismatch means the pixels *or* the
    PNG encoding differ -- upload both to the backend and diff them to tell
    which (the backend canonicalises encoding before comparing)."""
    if runs < 2:
        raise ValueError("runs must be at least 2 to compare anything")
    checksums = []
    for _ in range(runs):
        agent.prepare(source)
        frame = agent.capture(source)
        checksums.append(hashlib.sha256(frame.data).hexdigest())
    return DeterminismReport(runs=runs, checksums=tuple(checksums))
