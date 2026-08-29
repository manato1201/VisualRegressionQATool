"""CI-friendly entry point: upload one build's screenshot and fail the job
on a visual regression.

Meant to be the last step of a CI pipeline, after whatever build step
(Unity/Houdini batch render, etc.) has produced a PNG. See
../../.github/workflows/visual-regression-example.yml for the full example.

Usage:
    python ci_diff_check.py \\
        --backend-url http://localhost:8000 \\
        --scene-id OutdoorsScene \\
        --build-version "$GITHUB_SHA" \\
        --image path/to/screenshot.png \\
        --promote-if-missing

Exit codes:
    0 - verdict is pass (or a reference was just seeded via --promote-if-missing)
    1 - verdict is fail (a real visual regression was detected)
    2 - the check itself could not run (bad image, no reference and
        --promote-if-missing not set, backend unreachable, etc.)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from capture_agents.base import BackendApiError, BackendClient  # noqa: E402
from capture_agents.models import RawFrame  # noqa: E402


def _read_frame(image_path: Path, color_space: str) -> RawFrame:
    data = image_path.read_bytes()
    # Width/height are informational only -- the backend derives the real
    # values by decoding the bytes itself (see backend/app/routers/captures.py).
    return RawFrame(data=data, width=0, height=0, color_space=color_space)


def _write_step_summary(lines: list[str]) -> None:
    import os

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    with open(summary_path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--backend-url", default="http://localhost:8000")
    parser.add_argument(
        "--scene-id",
        required=True,
        help="scene_or_level_id / CaptureInstruction identity",
    )
    parser.add_argument(
        "--build-version", required=True, help="e.g. a git SHA or CI build number"
    )
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--color-space", default="sRGB")
    parser.add_argument("--per-pixel-tolerance", type=int, default=0)
    parser.add_argument("--max-diff-pixels", type=int, default=0)
    parser.add_argument("--min-diff-region-pixels", type=int, default=1)
    parser.add_argument(
        "--promote-if-missing",
        action="store_true",
        help="If this scene has no active reference yet, promote this upload as the "
        "baseline and exit 0 instead of failing (useful for the very first CI run).",
    )
    args = parser.parse_args()

    if not args.image.exists():
        print(f"::error::image not found: {args.image}", file=sys.stderr)
        return 2

    backend = BackendClient(args.backend_url)

    try:
        instruction_id = backend.ensure_instruction(scene_or_level_id=args.scene_id)
    except Exception as exc:  # noqa: BLE001
        print(
            f"::error::could not reach backend at {args.backend_url}: {exc}",
            file=sys.stderr,
        )
        return 2

    frame = _read_frame(args.image, args.color_space)
    captured = backend.upload_capture(instruction_id, args.build_version, frame)

    try:
        result = backend.run_diff(
            captured["captured_image_id"],
            per_pixel_tolerance=args.per_pixel_tolerance,
            max_diff_pixels=args.max_diff_pixels,
            min_diff_region_pixels=args.min_diff_region_pixels,
        )
    except BackendApiError as exc:
        if (
            args.promote_if_missing
            and exc.status_code == 404
            and "no reference image available" in exc.detail
        ):
            backend.promote_reference(captured["captured_image_id"], approved_by="ci")
            print(
                f"No reference existed yet for '{args.scene_id}' -- seeded one from this build. Nothing to compare against yet."
            )
            _write_step_summary(
                [
                    "## Visual Regression Check",
                    f"- Scene: `{args.scene_id}`",
                    f"- Build: `{args.build_version}`",
                    "- Result: baseline seeded (first run for this scene)",
                ]
            )
            return 0
        print(f"::error::diff run failed: {exc.detail}", file=sys.stderr)
        return 2

    verdict = result["evaluation_result"]["verdict"]
    diff_pixels = result["diff_image"]["diff_pixel_count"]
    diff_pct = result["diff_image"]["diff_percentage"]

    _write_step_summary(
        [
            "## Visual Regression Check",
            f"- Scene: `{args.scene_id}`",
            f"- Build: `{args.build_version}`",
            f"- Verdict: **{verdict.upper()}**",
            f"- Diff pixels: {diff_pixels} ({diff_pct:.4f}%)",
        ]
    )

    if verdict == "fail":
        print(
            f"::error::visual regression detected in '{args.scene_id}' ({diff_pixels} px, {diff_pct:.4f}%)"
        )
        return 1

    print(
        f"OK: '{args.scene_id}' at {args.build_version} -> {verdict} ({diff_pixels} px)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
