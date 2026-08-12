from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import models, queries
from ..deps import get_conn

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("", response_model=list[models.RunRow])
def list_runs(
    instruction_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)
):
    return queries.list_runs(conn, instruction_id)


@router.get(
    "/first-bad-commit/{instruction_id}", response_model=models.FirstBadCommitOut
)
def first_bad_commit(instruction_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    out = queries.first_bad_commit(conn, instruction_id)
    if not out:
        raise HTTPException(
            status_code=404, detail="no failing run found for this instruction"
        )
    return out
