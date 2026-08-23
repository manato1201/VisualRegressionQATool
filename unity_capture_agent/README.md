# unity_capture_agent

C# reference implementation of the CaptureAgent common interface (see [`../docs/CAPTURE_AGENT_DESIGN.md`](../docs/CAPTURE_AGENT_DESIGN.md)). Satisfies the same HTTP contract as [`../capture_agents/`](../capture_agents/) (the Python/Houdini reference implementation) — both talk to the existing VisualRegressionQATool backend unchanged.

> **Not compiled or verified in this repo.** There is no Unity install in this environment. The code follows Unity's documented `UnityWebRequest` / `Camera.Render` / `ScreenCapture` APIs, but check it against your actual Unity/render-pipeline version before relying on it.

## Files

- `UnityCaptureAgent.cs` — `ICaptureAgent`, `UnityCaptureAgent` (camera-render capture), `BackendClient`, `CaptureOrchestrator`
- `CaptureAgentExample.cs` — a `MonoBehaviour` wiring the pieces together

## Install

1. Copy both `.cs` files into your Unity project's `Assets/` (any folder).
2. No package dependencies beyond Unity's built-in `UnityEngine.Networking` module (enable it in Package Manager if it isn't already).

## Usage

```csharp
var agent = new UnityCaptureAgent();
var backend = new BackendClient("http://localhost:8000");
var source = new CaptureSource(CaptureSourceKind.View, "MainCamera");

StartCoroutine(CaptureOrchestrator.RunCaptureAndDiff(
    agent, source, backend,
    buildVersion: "editor-test",
    instructionId: null,            // or a saved id for repeated CI runs
    sceneOrLevelId: "OutdoorsScene",
    diffSettings: DiffSettings.Default,
    onResult: r => Debug.Log(r.evaluation_result.verdict),
    onError: e => Debug.LogError(e)));
```

For a `Comp` source, point `CaptureSource`'s `SourceId` at whichever camera renders your project's final composited output (see the design doc's note on Unity `view` vs `comp`) — the capture mechanism is identical, only the camera differs.

## Known gaps

- `JsonUtility` can't deserialize a top-level JSON array (`GET /api/instructions`); worked around by wrapping the response text before parsing — see `EnsureInstruction`.
- No retry/backoff around `UnityWebRequest` calls.
- `Prepare()` is a no-op hook — wire your project's actual determinism controls there (fixed `Time.captureFramerate`, seeded RNG service, TAA jitter disable via `HDAdditionalCameraData`), per Phase 1 of the design doc.
