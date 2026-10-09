from __future__ import annotations

import sys
import types

import pytest

from capture_agents import (
    FREEZE_ANIMATIONS_CSS,
    CaptureAgent,
    CaptureSource,
    RawFrame,
    apply_instruction_conditions,
    check_determinism,
)

_SOURCE = CaptureSource(kind="view", source_id="SceneView", engine="houdini")


class _ScriptedAgent(CaptureAgent):
    """Returns the scripted byte payloads in order, recording prepare calls."""

    engine = "houdini"

    def __init__(self, payloads: list[bytes]) -> None:
        self._payloads = iter(payloads)
        self.prepare_calls = 0

    def prepare(self, source: CaptureSource) -> None:
        self.prepare_calls += 1

    def capture(self, source: CaptureSource) -> RawFrame:
        return RawFrame(data=next(self._payloads), width=4, height=4)


def test_identical_captures_are_reported_as_deterministic():
    agent = _ScriptedAgent([b"same"] * 10)
    report = check_determinism(agent, _SOURCE, runs=10)

    assert report.identical
    assert report.distinct_checksums == 1
    assert report.mismatched_runs == ()
    # prepare runs before every capture, not just once -- a flaky prepare step
    # is exactly the kind of drift this check exists to catch.
    assert agent.prepare_calls == 10


def test_a_drifting_capture_is_located_by_run_index():
    payloads = [b"a", b"a", b"b", b"a", b"b"]
    report = check_determinism(_ScriptedAgent(payloads), _SOURCE, runs=5)

    assert not report.identical
    assert report.distinct_checksums == 2
    assert report.mismatched_runs == (2, 4)


def test_check_determinism_needs_at_least_two_runs():
    with pytest.raises(ValueError):
        check_determinism(_ScriptedAgent([b"x"]), _SOURCE, runs=1)


def test_instruction_conditions_are_merged_into_extra():
    instruction = {
        "seed": 42,
        "fixed_time_seconds": 0.0,  # 0.0 is a real value, not "unset"
        "reduce_motion": True,
        "frame_rate": 60,
    }
    merged = apply_instruction_conditions(_SOURCE, instruction)

    assert merged.extra == {
        "seed": 42,
        "fixed_time_seconds": 0.0,
        "reduce_motion": True,
    }
    assert _SOURCE.extra == {}  # CaptureSource is frozen; the input is untouched


def test_unpinned_time_is_not_copied_and_explicit_extra_wins():
    source = CaptureSource(
        kind="view", source_id="SceneView", engine="houdini", extra={"seed": 7}
    )
    merged = apply_instruction_conditions(
        source, {"seed": 42, "fixed_time_seconds": None, "reduce_motion": False}
    )

    assert merged.extra == {"seed": 7, "reduce_motion": False}


def test_freeze_css_disables_animation_and_transition():
    assert "animation: none" in FREEZE_ANIMATIONS_CSS
    assert "transition: none" in FREEZE_ANIMATIONS_CSS


class _StubHou(types.ModuleType):
    def __init__(self) -> None:
        super().__init__("hou")
        self.calls: list[tuple[str, float]] = []

    def setFrame(self, frame: float) -> None:  # noqa: N802 - mirrors hou API
        self.calls.append(("setFrame", frame))

    def setTime(self, seconds: float) -> None:  # noqa: N802 - mirrors hou API
        self.calls.append(("setTime", seconds))


@pytest.fixture()
def houdini_agent_with_stub_hou(monkeypatch: pytest.MonkeyPatch):
    stub = _StubHou()
    monkeypatch.setitem(sys.modules, "hou", stub)
    monkeypatch.setitem(sys.modules, "toolutils", types.ModuleType("toolutils"))
    monkeypatch.delitem(sys.modules, "capture_agents.houdini_agent", raising=False)
    from capture_agents.houdini_agent import HoudiniCaptureAgent

    yield HoudiniCaptureAgent(), stub
    sys.modules.pop("capture_agents.houdini_agent", None)


def test_houdini_agent_pins_time_for_a_comp_source(houdini_agent_with_stub_hou):
    agent, hou = houdini_agent_with_stub_hou
    hou.node = lambda path: object()  # comp preparation only checks existence
    source = CaptureSource(
        kind="comp",
        source_id="/out/comp",
        engine="houdini",
        extra={"fixed_time_seconds": 2},
    )

    agent.prepare(source)

    assert hou.calls == [("setTime", 2.0)]


def test_houdini_agent_rejects_frame_and_fixed_time_together(
    houdini_agent_with_stub_hou,
):
    agent, hou = houdini_agent_with_stub_hou
    source = CaptureSource(
        kind="comp",
        source_id="/out/comp",
        engine="houdini",
        extra={"frame": 10, "fixed_time_seconds": 1.0},
    )

    with pytest.raises(ValueError, match="not both"):
        agent.prepare(source)
    assert hou.calls == []
