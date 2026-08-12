from __future__ import annotations

import io
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

from .. import models, repository
from ..deps import get_blob_store, get_conn
from ..storage import BlobStore

router = APIRouter(prefix="/api/captures", tags=["captured_image"])


@router.post("", response_model=models.CapturedImageOut)
async def upload_captured_image(
    instruction_id: str = Form(...),
    build_version: str = Form(...),
    color_space: str = Form("sRGB"),
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
):
    if not repository.get_capture_instruction(conn, instruction_id):
        raise HTTPException(status_code=404, detail="instruction not found")

    data = await file.read()
    try:
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid image: {exc}") from exc

    ext = (file.filename or "capture.png").rsplit(".", 1)[-1].lower() or "png"
    checksum, image_path, was_written = blobs.put(data, ext=ext)

    out = repository.create_captured_image(
        conn,
        instruction_id=instruction_id,
        build_version=build_version,
        checksum=checksum,
        image_path=image_path,
        width=width,
        height=height,
        color_space=color_space,
    )
    out.dedup_hit = not was_written
    return out


@router.get("", response_model=list[models.CapturedImageOut])
def list_captured_images(
    instruction_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)
):
    return repository.list_captured_images(conn, instruction_id)


@router.get("/{captured_image_id}", response_model=models.CapturedImageOut)
def get_captured_image(
    captured_image_id: str, conn: sqlite3.Connection = Depends(get_conn)
):
    out = repository.get_captured_image(conn, captured_image_id)
    if not out:
        raise HTTPException(status_code=404, detail="captured image not found")
    return out


@router.get("/{captured_image_id}/image")
def get_captured_image_bytes(
    captured_image_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
):
    out = repository.get_captured_image(conn, captured_image_id)
    if not out:
        raise HTTPException(status_code=404, detail="captured image not found")
    path: Path = blobs.abs_path_for(out.image_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="blob missing")
    return FileResponse(path)


@router.delete("/{captured_image_id}", status_code=204)
def delete_captured_image(
    captured_image_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    blobs: BlobStore = Depends(get_blob_store),
):
    try:
        image_path_to_reclaim = repository.delete_captured_image(
            conn, captured_image_id
        )
    except KeyError:
        raise HTTPException(
            status_code=404, detail="captured image not found"
        ) from None
    except repository.CapturedImageInUseError as exc:
        raise HTTPException(status_code=409, detail=" / ".join(exc.reasons)) from exc

    if image_path_to_reclaim:
        blobs.delete(image_path_to_reclaim)
