from __future__ import annotations

import threading

import httpx
import pytest

from app.alert_sink import (
    AlertFailureContext,
    CompositeAlertSink,
    FAILURE_LABEL,
    GitHubIssueAlertSink,
    IAlertSink,
    NoopAlertSink,
    WebhookAlertSink,
    WebUiToastAlertSink,
    build_alert_sink_from_env,
    find_webui_toast_sink,
)

_CTX = AlertFailureContext(
    instruction_id="instr-1",
    scene_or_level_id="OutdoorsScene",
    build_version="deadbeef",
    evaluation_result_id="eval-1",
    verdict="fail",
    diff_pixel_count=42,
    diff_percentage=1.23,
)


def _github_sink(handler) -> GitHubIssueAlertSink:
    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://api.github.com", transport=transport)
    return GitHubIssueAlertSink(
        owner="acme", repo="game", token="fake-token", client=client
    )


def test_github_sink_creates_labelled_issue_when_none_open():
    created = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/issues"):
            assert request.url.params["labels"] == FAILURE_LABEL
            assert request.url.params["state"] == "open"
            return httpx.Response(200, json=[])
        if request.method == "POST" and request.url.path.endswith("/issues"):
            payload = request.read()
            created["payload"] = payload
            assert FAILURE_LABEL.encode() in payload
            assert b"instr-1" in payload
            return httpx.Response(201, json={"number": 77})
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    sink: IAlertSink = _github_sink(handler)
    ref = sink.notify_failure(_CTX)
    assert ref == "77"
    assert created["payload"]


def test_github_sink_does_not_duplicate_when_matching_open_issue_exists():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/issues"):
            return httpx.Response(
                200,
                json=[
                    {
                        "number": 55,
                        "body": "<!-- vrqa-instruction-id: instr-1 -->\nalready open",
                    }
                ],
            )
        raise AssertionError(
            f"unexpected POST during dedupe check: {request.method} {request.url}"
        )

    sink = _github_sink(handler)
    ref = sink.notify_failure(_CTX)
    assert ref == "55"


def test_github_sink_recovery_comments_and_closes_issue():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, str(request.url)))
        if request.method == "POST" and request.url.path.endswith("/comments"):
            return httpx.Response(201, json={})
        if request.method == "PATCH":
            payload = request.read()
            assert b'"closed"' in payload
            return httpx.Response(200, json={"state": "closed"})
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    sink = _github_sink(handler)
    sink.notify_recovery("instr-1", "55")
    assert (
        "POST",
        "https://api.github.com/repos/acme/game/issues/55/comments",
    ) in calls
    assert ("PATCH", "https://api.github.com/repos/acme/game/issues/55") in calls


def test_webhook_sink_posts_failure_and_recovery_events():
    received = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request.read())
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    sink = WebhookAlertSink(url="https://example.com/hook", client=client)

    ref = sink.notify_failure(_CTX)
    assert ref == "eval-1"
    sink.notify_recovery("instr-1", ref)

    assert len(received) == 2
    assert b"visual_regression_fail" in received[0]
    assert b"visual_regression_recovery" in received[1]


def test_noop_sink_never_raises_and_returns_none():
    sink = NoopAlertSink()
    assert sink.notify_failure(_CTX) is None
    sink.notify_recovery("instr-1", "n/a")  # must not raise


def test_sink_implementations_share_the_same_interface_swap_free_of_code_changes():
    """IAlertSink implementations must be interchangeable via config, not code."""

    def use_sink(sink: IAlertSink) -> str | None:
        return sink.notify_failure(_CTX)

    assert use_sink(NoopAlertSink()) is None


def test_webui_toast_sink_queues_failure_and_recovery_as_separate_severities():
    sink = WebUiToastAlertSink()
    ref = sink.notify_failure(_CTX)
    assert ref == "1"
    sink.notify_recovery("instr-1", ref)

    toasts = sink.toasts_since(0)
    assert [t.severity for t in toasts] == ["error", "success"]
    assert "OutdoorsScene" in toasts[0].message
    assert "instr-1" in toasts[1].message
    # instruction_id lets the frontend jump straight to the failing
    # instruction when a toast is clicked.
    assert toasts[0].instruction_id == "instr-1"
    assert toasts[1].instruction_id == "instr-1"


def test_webui_toast_sink_toasts_since_only_returns_newer_entries():
    sink = WebUiToastAlertSink()
    sink.notify_failure(_CTX)
    sink.notify_failure(_CTX)
    first_id = int(sink.toasts_since(0)[0].id)

    remaining = sink.toasts_since(first_id)
    assert len(remaining) == 1
    assert remaining[0].id == first_id + 1


def test_webui_toast_sink_drops_oldest_once_queue_is_full():
    sink = WebUiToastAlertSink(max_queue=2)
    for _ in range(3):
        sink.notify_failure(_CTX)

    toasts = sink.toasts_since(0)
    assert len(toasts) == 2
    assert [t.id for t in toasts] == [2, 3]


def test_webui_toast_sink_survives_concurrent_push_and_read():
    """GET /api/alerts/toasts (toasts_since) and notify_failure (_push) run
    on different threadpool threads in FastAPI -- without the sink's
    internal lock, a read iterating the deque while a write appends to it
    can raise "deque mutated during iteration"."""
    sink = WebUiToastAlertSink()
    errors: list[BaseException] = []

    def pusher():
        for _ in range(500):
            sink.notify_failure(_CTX)

    def reader():
        for _ in range(500):
            try:
                sink.toasts_since(0)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

    threads = [threading.Thread(target=pusher) for _ in range(4)] + [
        threading.Thread(target=reader) for _ in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []


def test_build_alert_sink_from_env_selects_webui_toast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VRQA_ALERT_SINK", "webui_toast")
    sink = build_alert_sink_from_env()
    assert isinstance(sink, WebUiToastAlertSink)


class _RecordingSink:
    """Bare-bones IAlertSink stub whose ref and recovery calls are recorded,
    so composite fan-out and per-child recovery routing can be asserted."""

    def __init__(self, ref: str | None) -> None:
        self.ref = ref
        self.recoveries: list[tuple[str, str]] = []

    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
        return self.ref

    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
        self.recoveries.append((instruction_id, external_ref))


def test_composite_sink_fans_failure_out_to_every_child():
    toast = WebUiToastAlertSink()
    other = _RecordingSink(ref="child-ref")
    composite = CompositeAlertSink([toast, other])

    ref = composite.notify_failure(_CTX)

    # The public external_ref (what alert_issue stores) is always the first
    # child's own ref, not something composite invents.
    assert ref == "1"
    assert len(toast.toasts_since(0)) == 1
    assert other.ref == "child-ref"


def test_composite_sink_replays_each_childs_own_ref_on_recovery():
    """Each child sink minted its own ref (a toast id, a webhook's echo of
    evaluation_result_id, a GitHub issue number...) -- recovery must hand
    each child back exactly that ref, not whatever the DB's single
    external_ref column happens to store for the composite as a whole."""
    a = _RecordingSink(ref="ref-a")
    b = _RecordingSink(ref="ref-b")
    composite = CompositeAlertSink([a, b])

    composite.notify_failure(_CTX)
    composite.notify_recovery("instr-1", "whatever-the-db-stored")

    assert a.recoveries == [("instr-1", "ref-a")]
    assert b.recoveries == [("instr-1", "ref-b")]


def test_composite_sink_skips_children_that_declined_to_open_an_alert():
    declined = _RecordingSink(ref=None)
    opened = _RecordingSink(ref="ref-b")
    composite = CompositeAlertSink([declined, opened])

    ref = composite.notify_failure(_CTX)
    composite.notify_recovery("instr-1", ref)

    assert ref == "ref-b"
    assert declined.recoveries == []
    assert opened.recoveries == [("instr-1", "ref-b")]


def test_composite_sink_returns_none_when_no_child_opens_an_alert():
    composite = CompositeAlertSink([_RecordingSink(ref=None), _RecordingSink(ref=None)])
    assert composite.notify_failure(_CTX) is None


def test_find_webui_toast_sink_locates_direct_and_nested_instances():
    direct = WebUiToastAlertSink()
    assert find_webui_toast_sink(direct) is direct

    nested = WebUiToastAlertSink()
    composite = CompositeAlertSink([_RecordingSink(ref=None), nested])
    assert find_webui_toast_sink(composite) is nested

    assert find_webui_toast_sink(NoopAlertSink()) is None
    assert find_webui_toast_sink(CompositeAlertSink([NoopAlertSink()])) is None


def test_build_alert_sink_from_env_selects_composite_of_named_kinds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VRQA_ALERT_SINK", "composite")
    monkeypatch.setenv("VRQA_ALERT_SINK_KINDS", "webui_toast, webhook")
    monkeypatch.setenv("VRQA_WEBHOOK_URL", "https://example.com/hook")

    sink = build_alert_sink_from_env()

    assert isinstance(sink, CompositeAlertSink)
    assert [type(s).__name__ for s in sink.sinks] == [
        "WebUiToastAlertSink",
        "WebhookAlertSink",
    ]


def test_build_alert_sink_from_env_composite_requires_kinds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VRQA_ALERT_SINK", "composite")
    monkeypatch.delenv("VRQA_ALERT_SINK_KINDS", raising=False)

    with pytest.raises(ValueError):
        build_alert_sink_from_env()
