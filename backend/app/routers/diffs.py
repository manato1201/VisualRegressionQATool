from __future__ import annotations

import io
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .. import models, repository
from ..alert_sink import AlertFailureContext, IAlertSink
from ..deps import get_alert_sink, get_blob_store, get_conn
from ..diff_engine import ImageDimensionMismatchError, PixelDiffEngine
from ..storage import BlobStore

router = APIRouter(prefix="/api/diffs", tags=["diff_image", "evaluation_result"])

_engine = PixelDiffEngine()


class _DiffRunError(Exception):
    """Internal error carrying an HTTP status, used so a batch run can catch
    one item's failure without raising past the rest of the batch."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _execute_diff_run(
    conn: sqlite3.Connection,
    blobs: BlobStore,
    alert_sink: IAlertSink,
    *,
    captured_image_id: str,
    reference_image_id: str | None,
    per_pixel_tolerance: int,
    max_diff_pixels: int,
    min_diff_region_pixels: int,
) -> models.DiffRunResult:
    captured = repository.get_captured_image(conn, captured_image_id)
    if not captured:
        raise _DiffRunError(404, "captured image not found")

    if reference_image_id:
        reference = repository.get_reference_image(conn, reference_image_id)
    else:
        reference = repository.get_active_reference_image(conn, captured.instruction_id)
    if not reference:
        raise _DiffRunError(404, "no reference image available for this instruction")

    reference_captured = repository.get_captured_image(
        conn, reference.captured_image_id
    )
    if not reference_captured:
        raise _DiffRunError(500, "reference image points at a missing captured image")

    captured_bytes = blobs.read(captured.image_path)
    reference_bytes = blobs.read(reference_captured.image_path)

    try:
        result = _engine.compare_bytes(
            captured_bytes,
            reference_bytes,
            per_pixel_tolerance=per_pixel_tolerance,
            max_diff_pixels=max_diff_pixels,
            min_diff_region_pixels=min_diff_region_pixels,
        )
    except ImageDimensionMismatchError as exc:
        raise _DiffRunError(422, str(exc)) from exc

    buf = io.BytesIO()
    result.diff_image.save(buf, format="PNG")
    _checksum, diff_image_path, _written = blobs.put(buf.getvalue(), ext="png")

    diff_image = repository.create_diff_image(
        conn,
        captured_image_id=captured.captured_image_id,
        reference_image_id=reference.reference_image_id,
        diff_image_path=diff_image_path,
        diff_pixel_count=result.diff_pixel_count,
        diff_percentage=result.diff_percentage,
    )
    evaluation_result = repository.create_evaluation_result(
        conn, diff_image_id=diff_image.diff_image_id, verdict=result.verdict
    )

    alert_payload = _handle_alerting(
        conn,
        alert_sink,
        instruction_id=captured.instruction_id,
        captured=captured,
        evaluation_result=evaluation_result,
        diff_image=diff_image,
    )

    return models.DiffRunResult(
        diff_image=diff_image, evaluation_result=evaluation_result, alert=alert_payload
    )


@router.post("/run", response_model=models.DiffRunResult)
def run_diff(
    body: models.DiffRunRequest,
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
    alert_sink: IAlertSink = Depends(get_alert_sink),
):
    try:
        return _execute_diff_run(
            conn,
            blobs,
            alert_sink,
            captured_image_id=body.captured_image_id,
            reference_image_id=body.reference_image_id,
            per_pixel_tolerance=body.per_pixel_tolerance,
            max_diff_pixels=body.max_diff_pixels,
            min_diff_region_pixels=body.min_diff_region_pixels,
        )
    except _DiffRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/run-batch", response_model=models.DiffBatchRunResponse)
def run_diff_batch(
    body: models.DiffBatchRunRequest,
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
    alert_sink: IAlertSink = Depends(get_alert_sink),
):
    """Run diffs for many CapturedImages in one call. One item's failure
    (e.g. a resolution mismatch) is recorded per-item and does not abort the
    rest of the batch — the point of a batch run is to survey many builds at
    once, so a single bad capture shouldn't stop the others from being
    evaluated."""
    results: list[models.DiffBatchItemResult] = []
    for captured_image_id in body.captured_image_ids:
        try:
            run_result = _execute_diff_run(
                conn,
                blobs,
                alert_sink,
                captured_image_id=captured_image_id,
                reference_image_id=body.reference_image_id,
                per_pixel_tolerance=body.per_pixel_tolerance,
                max_diff_pixels=body.max_diff_pixels,
                min_diff_region_pixels=body.min_diff_region_pixels,
            )
            results.append(
                models.DiffBatchItemResult(
                    captured_image_id=captured_image_id,
                    ok=True,
                    diff_image=run_result.diff_image,
                    evaluation_result=run_result.evaluation_result,
                    alert=run_result.alert,
                )
            )
        except _DiffRunError as exc:
            results.append(
                models.DiffBatchItemResult(
                    captured_image_id=captured_image_id, ok=False, error=exc.detail
                )
            )
    return models.DiffBatchRunResponse(results=results)


def _handle_alerting(
    conn: sqlite3.Connection,
    alert_sink: IAlertSink,
    *,
    instruction_id: str,
    captured: models.CapturedImageOut,
    evaluation_result: models.EvaluationResultOut,
    diff_image: models.DiffImageOut,
) -> dict | None:
    if evaluation_result.verdict == "fail":
        existing = repository.find_open_alert_issue(conn, instruction_id)
        if existing is not None:
            return {"action": "already-open", "external_ref": existing["external_ref"]}

        instruction = repository.get_capture_instruction(conn, instruction_id)
        ctx = AlertFailureContext(
            instruction_id=instruction_id,
            scene_or_level_id=instruction.scene_or_level_id if instruction else "",
            build_version=captured.build_version,
            evaluation_result_id=evaluation_result.evaluation_result_id,
            verdict=evaluation_result.verdict,
            diff_pixel_count=diff_image.diff_pixel_count,
            diff_percentage=diff_image.diff_percentage,
            diff_image_url=f"/api/diffs/{diff_image.diff_image_id}/image",
        )
        external_ref = alert_sink.notify_failure(ctx)
        if external_ref is None:
            return None
        repository.create_alert_issue(
            conn,
            instruction_id=instruction_id,
            evaluation_result_id=evaluation_result.evaluation_result_id,
            sink_kind=type(alert_sink).__name__,
            external_ref=external_ref,
        )
        return {"action": "opened", "external_ref": external_ref}

    if evaluation_result.verdict == "pass":
        closed_rows = repository.close_open_alert_issues(conn, instruction_id)
        for row in closed_rows:
            alert_sink.notify_recovery(instruction_id, row["external_ref"])
        if closed_rows:
            return {
                "action": "recovered",
                "closed": [r["external_ref"] for r in closed_rows],
            }

    return None


@router.get("/{diff_image_id}", response_model=models.DiffImageOut)
def get_diff_image_record(
    diff_image_id: str, conn: sqlite3.Connection = Depends(get_conn)
):
    out = repository.get_diff_image(conn, diff_image_id)
    if not out:
        raise HTTPException(status_code=404, detail="diff image not found")
    return out


@router.get("/{diff_image_id}/image")
def get_diff_image_bytes(
    diff_image_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
):
    out = repository.get_diff_image(conn, diff_image_id)
    if not out:
        raise HTTPException(status_code=404, detail="diff image not found")
    path: Path = blobs.abs_path_for(out.diff_image_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="blob missing")
    return FileResponse(path)
