// Minimal usage example for UnityCaptureAgent.cs. Attach to any GameObject
// and call RunOnce() (e.g. from a button, or a menu item during CI).
//
// NOT COMPILED OR TESTED IN THIS REPO — see UnityCaptureAgent.cs header.

using System.Collections.Generic;
using UnityEngine;

namespace VisualRegressionQATool.CaptureAgent
{
    public class CaptureAgentExample : MonoBehaviour
    {
        [SerializeField] private string backendUrl = "http://localhost:8000";
        [SerializeField] private string cameraName = "MainCamera";
        [SerializeField] private string sceneOrLevelId = "OutdoorsScene";
        [SerializeField] private string buildVersion = "editor-test";
        [SerializeField] private string instructionId = ""; // set once, then reuse across CI runs

        public void RunOnce()
        {
            StartCoroutine(RunCaptureRoutine());
        }

        private System.Collections.IEnumerator RunCaptureRoutine()
        {
            var agent = new UnityCaptureAgent();
            var backend = new BackendClient(backendUrl);
            var source = new CaptureSource(CaptureSourceKind.View, cameraName)
            {
                Extra = new Dictionary<string, string> { { "color_space", "Linear" } },
            };

            yield return CaptureOrchestrator.RunCaptureAndDiff(
                agent,
                source,
                backend,
                buildVersion,
                instructionId: string.IsNullOrEmpty(instructionId) ? null : instructionId,
                sceneOrLevelId: sceneOrLevelId,
                diffSettings: DiffSettings.Default,
                onResult: result => Debug.Log($"[CaptureAgent] verdict = {result.evaluation_result.verdict}"),
                onError: error => Debug.LogError($"[CaptureAgent] failed: {error}"));
        }
    }
}
