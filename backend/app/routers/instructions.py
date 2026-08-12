from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import models, repository
from ..deps import get_conn

router = APIRouter(prefix="/api/instructions", tags=["capture_instruction"])


@router.post("", response_model=models.CaptureInstructionOut)
def create_instruction(
    body: models.CaptureInstructionCreate, conn: sqlite3.Connection = Depends(get_conn)
):
    return repository.create_capture_instruction(conn, body)


@router.get("", response_model=list[models.CaptureInstructionOut])
def list_instructions(conn: sqlite3.Connection = Depends(get_conn)):
    return repository.list_capture_instructions(conn)


@router.get("/{instruction_id}", response_model=models.CaptureInstructionOut)
def get_instruction(instruction_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    out = repository.get_capture_instruction(conn, instruction_id)
    if not out:
        raise HTTPException(status_code=404, detail="instruction not found")
    return out
