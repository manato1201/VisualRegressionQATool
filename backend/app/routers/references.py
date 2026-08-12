from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import models, repository
from ..deps import get_conn

router = APIRouter(prefix="/api/references", tags=["reference_image"])


@router.post("/promote", response_model=models.ReferenceImageOut)
def promote(
    body: models.ReferencePromoteRequest, conn: sqlite3.Connection = Depends(get_conn)
):
    """ReferenceStore promotion workflow (Phase 3): a CapturedImage only becomes
    citable as a ReferenceImage after this explicit approval call — it is never
    implicit, so an unapproved CapturedImage can't be mistaken for the reference."""
    captured = repository.get_captured_image(conn, body.captured_image_id)
    if not captured:
        raise HTTPException(status_code=404, detail="captured image not found")
    return repository.promote_reference_image(
        conn,
        captured_image_id=captured.captured_image_id,
        instruction_id=captured.instruction_id,
        approved_by=body.approved_by,
    )


@router.get("/active/{instruction_id}", response_model=models.ReferenceImageOut)
def active_reference(instruction_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    out = repository.get_active_reference_image(conn, instruction_id)
    if not out:
        raise HTTPException(
            status_code=404, detail="no active reference for this instruction"
        )
    return out


@router.get("/{reference_image_id}", response_model=models.ReferenceImageOut)
def get_reference(
    reference_image_id: str, conn: sqlite3.Connection = Depends(get_conn)
):
    out = repository.get_reference_image(conn, reference_image_id)
    if not out:
        raise HTTPException(status_code=404, detail="reference image not found")
    return out
