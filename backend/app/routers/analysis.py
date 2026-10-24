from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException

from .. import continuity, models, repository
from ..deps import get_blob_store, get_conn
from ..storage import BlobStore

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.post("/continuity", response_model=models.ContinuityResponse)
def check_continuity(
    body: models.ContinuityRequest,
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
):
    """Look for frames whose change from the previous frame jumps out of an
    animation's otherwise smooth sequence. ``captured_image_ids`` must be in
    playback order. Read-only: nothing is stored, and no verdict is produced --
    outliers are candidates for a person to inspect."""
    captured = []
    for captured_image_id in body.captured_image_ids:
        image = repository.get_captured_image(conn, captured_image_id)
        if image is None:
            raise HTTPException(
                status_code=404, detail=f"captured image not found: {captured_image_id}"
            )
        captured.append(image)

    def frame_bytes() -> Iterator[bytes]:
        for image in captured:
            try:
                yield blobs.read(image.image_path)
            except OSError as exc:
                raise HTTPException(
                    status_code=500, detail=f"blob missing or unreadable: {exc}"
                ) from exc

    try:
        analysis = continuity.analyze_frames(
            frame_bytes(),
            per_pixel_tolerance=body.per_pixel_tolerance,
            k=body.k,
            min_jump_percent=body.min_jump_percent,
        )
    except continuity.ContinuityInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return models.ContinuityResponse(
        frame_count=len(captured),
        pair_count=len(analysis.pair_diffs),
        pair_diffs=list(analysis.pair_diffs),
        median=analysis.median,
        mad=analysis.mad,
        threshold=analysis.threshold,
        outliers=[
            models.ContinuityOutlier(
                pair_index=i,
                from_captured_image_id=captured[i].captured_image_id,
                to_captured_image_id=captured[i + 1].captured_image_id,
                from_build_version=captured[i].build_version,
                to_build_version=captured[i + 1].build_version,
                diff_pixel_count=analysis.pair_diffs[i],
                diff_percentage=analysis.pair_diffs[i] / analysis.total_pixels * 100.0,
            )
            for i in analysis.outlier_indices
        ],
    )
