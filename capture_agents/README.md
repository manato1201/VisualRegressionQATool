# capture_agents

Python reference implementation of the CaptureAgent common interface (see [`../docs/CAPTURE_AGENT_DESIGN.md`](../docs/CAPTURE_AGENT_DESIGN.md)). Talks to the existing VisualRegressionQATool backend over HTTP — no server-side changes required.

- `capture_agents/models.py` — `CaptureSource` / `RawFrame` (engine-agnostic)
- `capture_agents/base.py` — `CaptureAgent` ABC, `BackendClient`, `run_capture_and_diff()` orchestrator
- `capture_agents/houdini_agent.py` — `HoudiniCaptureAgent` (requires `hou`; run inside Houdini or `hython`)

## Setup (outside Houdini — for the orchestration layer / tests)

```bash
cd capture_agents
uv sync --dev
uv run pytest -q
```

## Smoke test against a real backend (no Houdini needed)

`examples/fake_agent_smoke_test.py` runs the full `prepare -> capture -> upload -> diff -> first-bad-commit` flow against a real running backend, using a fake agent in place of `HoudiniCaptureAgent`/`UnityCaptureAgent` — a way to see the common interface actually work end-to-end without installing Houdini or Unity.

```bash
# terminal 1
cd backend && uv run uvicorn app.main:app --port 8000 --reload

# terminal 2
cd capture_agents
uv run --with pillow --with numpy python examples/fake_agent_smoke_test.py
```

Expect: `pass` on the unchanged frame, `fail` on the changed one, and `first bad build_version = smoke-v3`. Then open the web UI (`frontend/`, `npm run dev`) and look for the `CaptureAgentSmokeTest` instruction to see it in the diff viewer.

## Running inside Houdini

Houdini bundles its own Python interpreter (`hython`), which is the only place `capture_agents.houdini_agent` can import `hou`. Install this package into that interpreter, e.g.:

```bash
"C:\Program Files\Side Effects Software\Houdini <version>\bin\hython.exe" -m pip install httpx
```

then, from Houdini's Python Shell / Source Editor / a shelf tool:

```python
from capture_agents.base import BackendClient, run_capture_and_diff
from capture_agents.houdini_agent import HoudiniCaptureAgent
from capture_agents.models import CaptureSource

backend = BackendClient("http://localhost:8000")
agent = HoudiniCaptureAgent()

source = CaptureSource(
    kind="comp",
    source_id="/img/comp1/OUT",              # a ROP node already configured to write a file
    engine="houdini",
    extra={"frame": 1001, "output_path": "$HIP/render/comp1.png"},
)

result = run_capture_and_diff(
    agent, source, backend,
    build_version="local-test",
    scene_or_level_id="Comp1_QA",  # or pass instruction_id= for repeated CI runs
)
print(result["evaluation_result"]["verdict"])
```

For a `view` source, drop `output_path`/point at a Scene Viewer instead:

```python
source = CaptureSource(kind="view", source_id="SceneView", engine="houdini", extra={"frame": 1001})
```
