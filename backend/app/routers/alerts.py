from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import models
from ..alert_sink import IAlertSink, find_webui_toast_sink
from ..deps import get_alert_sink

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("/toasts", response_model=models.ToastListResponse)
def list_toasts(since_id: int = 0, alert_sink: IAlertSink = Depends(get_alert_sink)):
    """Polled by the frontend toast stack (Phase 6, feature 4). Works whether
    WebUiToastAlertSink is configured directly or nested inside a
    CompositeAlertSink; any other configured sink (noop/webhook/github)
    means there is nothing to show, not an error."""
    toast_sink = find_webui_toast_sink(alert_sink)
    if toast_sink is None:
        return models.ToastListResponse(toasts=[], last_id=since_id)

    entries = toast_sink.toasts_since(since_id)
    last_id = entries[-1].id if entries else since_id
    return models.ToastListResponse(
        toasts=[
            models.ToastOut(
                id=e.id,
                severity=e.severity,
                message=e.message,
                created_at=e.created_at,
                instruction_id=e.instruction_id,
            )
            for e in entries
        ],
        last_id=last_id,
    )
