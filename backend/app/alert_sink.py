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
from dataclasses import dataclass
from typing import Protocol

import httpx

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


def build_alert_sink_from_env() -> IAlertSink:
    """Config-switch factory: VRQA_ALERT_SINK selects the implementation without touching code."""
    kind = os.environ.get("VRQA_ALERT_SINK", "noop").lower()
    if kind == "github":
        owner = os.environ["VRQA_GITHUB_OWNER"]
        repo = os.environ["VRQA_GITHUB_REPO"]
        token = os.environ["VRQA_GITHUB_TOKEN"]
        return GitHubIssueAlertSink(owner=owner, repo=repo, token=token)
    if kind == "webhook":
        return WebhookAlertSink(url=os.environ["VRQA_WEBHOOK_URL"])
    return NoopAlertSink()
