from __future__ import annotations

import sys

import pytest


def test_importing_houdini_agent_outside_houdini_raises_a_clear_error():
    """This test environment has no `hou` module (no Houdini installed), which
    is exactly the scenario the module's import guard exists for."""
    sys.modules.pop("capture_agents.houdini_agent", None)
    with pytest.raises(ImportError, match="requires Houdini's own Python"):
        import capture_agents.houdini_agent  # noqa: F401
