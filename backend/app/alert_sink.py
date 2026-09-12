"""Phase 5 alert sinks.

Mirrors the ``IAlertSink`` interface from the design doc:

    public interface IAlertSink
    {
        void NotifyFailure(EvaluationResult result, DiffImage diff);
        void NotifyRecovery(string instructionId);
    }

Sink selection is a config switch, not a code change — ``NoopAlertSink``,
``WebhookAlertSink`` and ``GitHubIssueAlertSink`` are interchangeable at
runtime via ``build_alert_sink_from_env``.
"""

from __future__ import annotations

import os
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import httpx


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


FAILURE_LABEL = "visual-regression-fail"
MARKER_PREFIX = "<!-- vrqa-instruction-id:"


@dataclass
class AlertFailureContext:
    instruction_id: str
    scene_or_level_id: str
    build_version: str
    evaluation_result_id: str
    verdict: str
    diff_pixel_count: int
    diff_percentage: float
    diff_image_url: str | None = None


class IAlertSink(Protocol):
    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        """Notify of a failing run. Returns an external reference id (issue number, etc.) if created."""
        ...

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        """Notify that ``instruction_id`` is passing again; close out ``external_ref``."""
        ...


class NoopAlertSink:
    """Placeholder sink for the future Tool Orchestration Hub integration."""

    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        return None

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        return None


class WebhookAlertSink:
    def __init__(self, url: str, client: httpx.Client | None = None) -> None:
        self.url = url
        self._client = client or httpx.Client(timeout=10.0)

    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        resp = self._client.post(
            self.url,
            json={
                "event": "visual_regression_fail",
                "instruction_id": ctx.instruction_id,
                "scene_or_level_id": ctx.scene_or_level_id,
                "build_version": ctx.build_version,
                "evaluation_result_id": ctx.evaluation_result_id,
                "verdict": ctx.verdict,
                "diff_pixel_count": ctx.diff_pixel_count,
                "diff_percentage": ctx.diff_percentage,
                "diff_image_url": ctx.diff_image_url,
            },
        )
        resp.raise_for_status()
        return ctx.evaluation_result_id

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        resp = self._client.post(
            self.url,
            json={
                "event": "visual_regression_recovery",
                "instruction_id": instruction_id,
                "external_ref": external_ref,
            },
        )
        resp.raise_for_status()


class GitHubIssueAlertSink:
    """Same pattern as Research-Collector: failure -> labelled Issue, recovery -> auto-close,
    duplicate prevention via a label search before creating a new Issue."""

    def __init__(
        self, owner: str, repo: str, token: str, client: httpx.Client | None = None
    ) -> None:
        self.owner = owner
        self.repo = repo
        self._client = client or httpx.Client(
            base_url="https://api.github.com",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=15.0,
        )

    def _marker(self, instruction_id: str) -> str:
        return f"{MARKER_PREFIX} {instruction_id} -->"

    def _find_open_issue(self, instruction_id: str) -> dict | None:
        resp = self._client.get(
            f"/repos/{self.owner}/{self.repo}/issues",
            params={"labels": FAILURE_LABEL, "state": "open", "per_page": 100},
        )
        resp.raise_for_status()
        marker = self._marker(instruction_id)
        for issue in resp.json():
            if marker in (issue.get("body") or ""):
                return issue
        return None

    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        existing = self._find_open_issue(ctx.instruction_id)
        if existing is not None:
            return str(existing["number"])

        body_lines = [
            self._marker(ctx.instruction_id),
            f"**Scene/Level**: `{ctx.scene_or_level_id}`",
            f"**Build**: `{ctx.build_version}`",
            f"**Verdict**: `{ctx.verdict}`",
            f"**Diff pixels**: {ctx.diff_pixel_count} ({ctx.diff_percentage:.4f}%)",
            f"**Evaluation Result**: `{ctx.evaluation_result_id}`",
        ]
        if ctx.diff_image_url:
            body_lines.append(f"![diff]({ctx.diff_image_url})")

        resp = self._client.post(
            f"/repos/{self.owner}/{self.repo}/issues",
            json={
                "title": f"[visual-regression] {ctx.scene_or_level_id} failed at {ctx.build_version}",
                "body": "\n".join(body_lines),
                "labels": [FAILURE_LABEL],
            },
        )
        resp.raise_for_status()
        return str(resp.json()["number"])

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        self._client.post(
            f"/repos/{self.owner}/{self.repo}/issues/{external_ref}/comments",
            json={
                "body": f"Recovered: instruction `{instruction_id}` passed again. Auto-closing."
            },
        ).raise_for_status()
        self._client.patch(
            f"/repos/{self.owner}/{self.repo}/issues/{external_ref}",
            json={"state": "closed"},
        ).raise_for_status()


@dataclass
class ToastEntry:
    id: int
    severity: str  # "error" | "success"
    message: str
    created_at: str
    instruction_id: str


class WebUiToastAlertSink:
    """Phase 6 (stack toast): pushes failure/recovery notifications into an
    in-memory queue that the frontend polls (GET /api/alerts/toasts) and
    renders as a stack of toasts. Toasts themselves are ephemeral (an
    in-memory deque, not a DB table -- they don't need to survive a
    restart), but this sink still returns a real external_ref and
    participates in the existing alert_issue dedup/close bookkeeping the
    same way GitHubIssueAlertSink does, so a repeat failure on an instruction
    that already has an open toast doesn't spam a second one.
    """

    def __init__(self, max_queue: int = 200) -> None:
        self._queue: deque[ToastEntry] = deque(maxlen=max_queue)
        self._next_id = 1
        # GET /api/alerts/toasts (polling) and notify_failure/notify_recovery
        # (from a diff-run request) run on different threadpool threads --
        # without this, a poll iterating the deque while a notify appends to
        # it can raise "deque mutated during iteration".
        self._lock = threading.Lock()

    def _push(self, severity: str, message: str, instruction_id: str) -> str:
        with self._lock:
            entry = ToastEntry(
                id=self._next_id,
                severity=severity,
                message=message,
                created_at=_now(),
                instruction_id=instruction_id,
            )
            self._next_id += 1
            self._queue.append(entry)
            return str(entry.id)

    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        return self._push(
            "error",
            f"{ctx.scene_or_level_id} — {ctx.build_version} が FAIL しました "
            f"({ctx.diff_pixel_count}px, {ctx.diff_percentage:.4f}%)",
            ctx.instruction_id,
        )

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        self._push("success", f"{instruction_id} が回復しました(PASS)", instruction_id)

    def toasts_since(self, since_id: int) -> list[ToastEntry]:
        with self._lock:
            return [t for t in self._queue if t.id > since_id]


class CompositeAlertSink:
    """Fans a failure/recovery out to several sinks at once -- e.g. a
    WebUiToastAlertSink for whoever has the dashboard open plus a
    WebhookAlertSink for Slack/CI, configured via VRQA_ALERT_SINK=composite
    + VRQA_ALERT_SINK_KINDS="webui_toast,webhook".

    alert_issue only has room for a single external_ref column, but each
    child sink mints its own (an issue number, an evaluation id, a toast
    id...) that its own notify_recovery call later needs back unchanged --
    collapsing them into one value would silently break recovery for every
    sink but the first. So this class remembers each child's ref itself
    (keyed by instruction_id) and returns only the first as the "public"
    external_ref for the existing dedup/close bookkeeping; notify_recovery
    ignores the ref FastAPI hands back and replays each child's own ref
    instead. Like WebUiToastAlertSink, this bookkeeping is in-memory only,
    so a recovery for an alert opened before a server restart won't reach
    the child sinks -- the same limitation the toast queue already has.
    """

    def __init__(self, sinks: list[IAlertSink]) -> None:
        self.sinks = sinks
        self._child_refs: dict[str, list[tuple[IAlertSink, str]]] = {}

    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        pairs = [
            (sink, ref)
            for sink in self.sinks
            if (ref := sink.notify_failure(ctx)) is not None
        ]
        if not pairs:
            return None
        self._child_refs[ctx.instruction_id] = pairs
        return pairs[0][1]

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        for sink, ref in self._child_refs.pop(instruction_id, []):
            sink.notify_recovery(instruction_id, ref)


def find_webui_toast_sink(sink: IAlertSink) -> WebUiToastAlertSink | None:
    """GET /api/alerts/toasts needs the actual WebUiToastAlertSink instance,
    which may be configured directly (VRQA_ALERT_SINK=webui_toast) or nested
    inside a CompositeAlertSink (VRQA_ALERT_SINK=composite). A plain
    isinstance check on app.state.alert_sink would miss the composite case."""
    if isinstance(sink, WebUiToastAlertSink):
        return sink
    if isinstance(sink, CompositeAlertSink):
        for child in sink.sinks:
            if isinstance(child, WebUiToastAlertSink):
                return child
    return None


def _build_single_sink(kind: str) -> IAlertSink:
    kind = kind.strip().lower()
    if kind == "github":
        owner = os.environ["VRQA_GITHUB_OWNER"]
        repo = os.environ["VRQA_GITHUB_REPO"]
        token = os.environ["VRQA_GITHUB_TOKEN"]
        return GitHubIssueAlertSink(owner=owner, repo=repo, token=token)
    if kind == "webui_toast":
        return WebUiToastAlertSink()
    if kind == "webhook":
        return WebhookAlertSink(url=os.environ["VRQA_WEBHOOK_URL"])
    if kind == "noop":
        return NoopAlertSink()
    raise ValueError(f"unknown alert sink kind: {kind!r}")


def build_alert_sink_from_env() -> IAlertSink:
    """Config-switch factory: VRQA_ALERT_SINK selects the implementation without touching code."""
    kind = os.environ.get("VRQA_ALERT_SINK", "noop").lower()
    if kind == "composite":
        kinds_env = os.environ.get("VRQA_ALERT_SINK_KINDS", "")
        kinds = [k for k in (part.strip() for part in kinds_env.split(",")) if k]
        if not kinds:
            raise ValueError(
                "VRQA_ALERT_SINK=composite requires VRQA_ALERT_SINK_KINDS "
                "(comma-separated, e.g. 'webui_toast,webhook')"
            )
        return CompositeAlertSink([_build_single_sink(k) for k in kinds])
    return _build_single_sink(kind)
