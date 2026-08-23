// CaptureAgent common interface — Unity (C#) reference implementation.
//
// Satisfies the same HTTP contract as capture_agents/ (Python, Houdini
// reference implementation). See ../docs/CAPTURE_AGENT_DESIGN.md.
//
// NOT COMPILED OR TESTED IN THIS REPO — there is no Unity install in this
// environment. Written to match Unity's documented APIs (UnityWebRequest,
// Camera.Render/ReadPixels, ScreenCapture) but verify against your Unity
// version before relying on it in production.
//
// Requires: UnityEngine.Networking (built-in).

using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace VisualRegressionQATool.CaptureAgent
{
    public enum CaptureSourceKind { View, Comp }

    /// <summary>
    /// What to capture, independent of how this engine captures it. Mirrors
    /// capture_agents.models.CaptureSource (Python/Houdini side) field-for-field.
    /// </summary>
    [Serializable]
    public class CaptureSource
    {
        public CaptureSourceKind Kind;
        public string SourceId; // Camera name for View; composite-output camera/pass name for Comp
        public Dictionary<string, string> Extra = new Dictionary<string, string>();

        public CaptureSource(CaptureSourceKind kind, string sourceId)
        {
            Kind = kind;
            SourceId = sourceId;
        }
    }

    public struct RawFrame
    {
        public byte[] Data; // PNG-encoded
        public int Width;
        public int Height;
        public string ColorSpace;

        public RawFrame(byte[] data, int width, int height, string colorSpace = "sRGB")
        {
            Data = data;
            Width = width;
            Height = height;
            ColorSpace = colorSpace;
        }
    }

    public struct DiffSettings
    {
        public int PerPixelTolerance;
        public int MaxDiffPixels;
        public int MinDiffRegionPixels;

        public static DiffSettings Default => new DiffSettings { PerPixelTolerance = 0, MaxDiffPixels = 0, MinDiffRegionPixels = 1 };
    }

    /// <summary>
    /// Implemented once per engine. Python/Houdini side: capture_agents.base.CaptureAgent.
    /// </summary>
    public interface ICaptureAgent
    {
        /// <summary>Freeze whatever needs to be deterministic before capture
        /// (camera pose, seeded RNG, TAA jitter). Corresponds to Phase 1
        /// (DeterminismController / JitterOverride) in the design doc.</summary>
        void Prepare(CaptureSource source);

        /// <summary>Grab pixels and return them already PNG-encoded. Must not
        /// destructively mutate scene state.</summary>
        RawFrame Capture(CaptureSource source);
    }

    /// <summary>
    /// Default Unity implementation. "View" and most "Comp" sources both
    /// resolve to "render a named Camera to a RenderTexture" — in Unity,
    /// the Game View backbuffer is usually already the fully composited
    /// frame (post-processing included), so there is rarely a separate
    /// compositing stage the way Houdini's COP network is one. If your
    /// project *does* have a distinct compositing pass (e.g. a stacked
    /// overlay camera, a custom Render Graph pass), point Comp sources at
    /// that camera/pass by name — the capture mechanism is identical.
    /// See ../docs/CAPTURE_AGENT_DESIGN.md §2.
    /// </summary>
    public class UnityCaptureAgent : ICaptureAgent
    {
        public void Prepare(CaptureSource source)
        {
            // Phase 1 responsibilities belong here: fix Time.captureFramerate,
            // inject the seeded RNG service, disable TAA camera jitter via
            // HDAdditionalCameraData. Left as a project-specific hook since
            // the exact calls depend on your render pipeline (Built-in/URP/HDRP).
        }

        public RawFrame Capture(CaptureSource source)
        {
            Camera camera = FindCamera(source.SourceId);
            if (camera == null)
            {
                throw new InvalidOperationException(
                    $"No Camera named '{source.SourceId}' found in the active scene. " +
                    "For a whole-screen capture instead (e.g. the literal Game View), " +
                    "use CaptureScreenCoroutine, which must run at end-of-frame.");
            }
            return CaptureFromCamera(camera, source);
        }

        private static Camera FindCamera(string name)
        {
            foreach (Camera cam in Camera.allCameras)
            {
                if (cam.name == name) return cam;
            }
            return null;
        }

        private static RawFrame CaptureFromCamera(Camera camera, CaptureSource source)
        {
            int width = camera.pixelWidth;
            int height = camera.pixelHeight;
            if (source.Extra.TryGetValue("width", out var w)) width = int.Parse(w);
            if (source.Extra.TryGetValue("height", out var h)) height = int.Parse(h);

            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            RenderTexture previousActive = RenderTexture.active;
            RenderTexture previousTarget = camera.targetTexture;
            Texture2D tex = null;
            try
            {
                camera.targetTexture = rt;
                camera.Render();
                RenderTexture.active = rt;

                tex = new Texture2D(width, height, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                tex.Apply();

                byte[] png = tex.EncodeToPNG();
                string colorSpace = source.Extra.TryGetValue("color_space", out var cs) ? cs : "sRGB";
                return new RawFrame(png, width, height, colorSpace);
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                rt.Release();
                if (tex != null) UnityEngine.Object.Destroy(tex);
            }
        }

        /// <summary>Whole-screen fallback for sources that aren't a named
        /// Camera (e.g. comparing the literal built Player window). Must be
        /// run as a coroutine so it can wait for end-of-frame.</summary>
        public IEnumerator CaptureScreenCoroutine(CaptureSource source, Action<RawFrame> onCaptured)
        {
            yield return new WaitForEndOfFrame();
            Texture2D tex = ScreenCapture.CaptureScreenshotAsTexture();
            byte[] png = tex.EncodeToPNG();
            string colorSpace = source.Extra.TryGetValue("color_space", out var cs) ? cs : "sRGB";
            var frame = new RawFrame(png, tex.width, tex.height, colorSpace);
            UnityEngine.Object.Destroy(tex);
            onCaptured(frame);
        }
    }

    // --- JSON DTOs (JsonUtility needs concrete types; no dictionaries/top-level arrays) ---

    [Serializable] internal class CreateInstructionRequest { public string scene_or_level_id; }
    [Serializable] internal class InstructionResponse { public string instruction_id; public string scene_or_level_id; }
    [Serializable] internal class InstructionListWrapper { public InstructionResponse[] items; }
    [Serializable] internal class CapturedImageResponse { public string captured_image_id; }
    [Serializable] internal class DiffRunRequest { public string captured_image_id; public int per_pixel_tolerance; public int max_diff_pixels; public int min_diff_region_pixels; }
    [Serializable] public class EvaluationResultResponse { public string verdict; }
    [Serializable] public class DiffRunResult { public EvaluationResultResponse evaluation_result; }

    /// <summary>
    /// Thin wrapper around the existing FastAPI endpoints — no server-side
    /// changes required. Python/Houdini equivalent: capture_agents.base.BackendClient.
    /// </summary>
    public class BackendClient
    {
        private readonly string baseUrl;

        public BackendClient(string baseUrl)
        {
            this.baseUrl = baseUrl.TrimEnd('/');
        }

        /// <summary>
        /// Recommended: pass instructionId explicitly for repeated CI runs so
        /// the history chain stays stable (see ../docs/CAPTURE_AGENT_DESIGN.md §6).
        /// Falls back to a scene_or_level_id lookup-or-create otherwise.
        /// </summary>
        public IEnumerator EnsureInstruction(string instructionId, string sceneOrLevelId, Action<string> onResolved, Action<string> onError)
        {
            if (!string.IsNullOrEmpty(instructionId))
            {
                onResolved(instructionId);
                yield break;
            }
            if (string.IsNullOrEmpty(sceneOrLevelId))
            {
                onError("either instructionId or sceneOrLevelId must be provided");
                yield break;
            }

            using (var req = UnityWebRequest.Get($"{baseUrl}/api/instructions"))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    onError(req.error);
                    yield break;
                }
                // JsonUtility can't parse a top-level JSON array; wrap it first.
                string wrapped = "{\"items\":" + req.downloadHandler.text + "}";
                var list = JsonUtility.FromJson<InstructionListWrapper>(wrapped);
                if (list.items != null)
                {
                    foreach (var instr in list.items)
                    {
                        if (instr.scene_or_level_id == sceneOrLevelId)
                        {
                            onResolved(instr.instruction_id);
                            yield break;
                        }
                    }
                }
            }

            string createErr = null;
            string createdId = null;
            yield return PostJson(
                $"{baseUrl}/api/instructions",
                JsonUtility.ToJson(new CreateInstructionRequest { scene_or_level_id = sceneOrLevelId }),
                text => createdId = JsonUtility.FromJson<InstructionResponse>(text).instruction_id,
                err => createErr = err);

            if (createErr != null) onError(createErr);
            else onResolved(createdId);
        }

        public IEnumerator UploadCapture(string instructionId, string buildVersion, RawFrame frame, Action<string> onCapturedImageId, Action<string> onError)
        {
            var form = new List<IMultipartFormSection>
            {
                new MultipartFormDataSection("instruction_id", instructionId),
                new MultipartFormDataSection("build_version", buildVersion),
                new MultipartFormDataSection("color_space", frame.ColorSpace),
                new MultipartFormFileSection("file", frame.Data, "capture.png", "image/png"),
            };

            using (var req = UnityWebRequest.Post($"{baseUrl}/api/captures", form))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    onError(req.error);
                    yield break;
                }
                onCapturedImageId(JsonUtility.FromJson<CapturedImageResponse>(req.downloadHandler.text).captured_image_id);
            }
        }

        public IEnumerator RunDiff(string capturedImageId, DiffSettings settings, Action<DiffRunResult> onResult, Action<string> onError)
        {
            string json = JsonUtility.ToJson(new DiffRunRequest
            {
                captured_image_id = capturedImageId,
                per_pixel_tolerance = settings.PerPixelTolerance,
                max_diff_pixels = settings.MaxDiffPixels,
                min_diff_region_pixels = settings.MinDiffRegionPixels,
            });
            yield return PostJson($"{baseUrl}/api/diffs/run", json,
                text => onResult(JsonUtility.FromJson<DiffRunResult>(text)),
                onError);
        }

        private static IEnumerator PostJson(string url, string jsonBody, Action<string> onSuccess, Action<string> onError)
        {
            var request = new UnityWebRequest(url, "POST");
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonBody);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                onError($"{request.error}: {request.downloadHandler.text}");
                yield break;
            }
            onSuccess(request.downloadHandler.text);
        }
    }

    /// <summary>
    /// The common lifecycle, identical to capture_agents.base.run_capture_and_diff
    /// (Python/Houdini side): prepare -> capture -> upload -> diff.
    /// </summary>
    public static class CaptureOrchestrator
    {
        public static IEnumerator RunCaptureAndDiff(
            ICaptureAgent agent,
            CaptureSource source,
            BackendClient backend,
            string buildVersion,
            string instructionId,
            string sceneOrLevelId,
            DiffSettings diffSettings,
            Action<DiffRunResult> onResult,
            Action<string> onError)
        {
            agent.Prepare(source);
            RawFrame frame = agent.Capture(source);

            string resolvedInstructionId = null;
            string error = null;
            yield return backend.EnsureInstruction(instructionId, sceneOrLevelId, id => resolvedInstructionId = id, err => error = err);
            if (error != null) { onError(error); yield break; }

            string capturedImageId = null;
            yield return backend.UploadCapture(resolvedInstructionId, buildVersion, frame, id => capturedImageId = id, err => error = err);
            if (error != null) { onError(error); yield break; }

            yield return backend.RunDiff(capturedImageId, diffSettings, onResult, err => error = err);
            if (error != null) onError(error);
        }
    }
}
