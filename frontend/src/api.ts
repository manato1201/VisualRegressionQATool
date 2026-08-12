import type {
  CaptureInstruction,
  CapturedImage,
  DiffBatchRunResponse,
  DiffImage,
  DiffRunResult,
  FirstBadCommit,
  ReferenceImage,
  RunRow,
} from "./types";

export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`${status} ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore body parse failure
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

const DIMENSION_MISMATCH_RE =
  /captured size \((\d+), (\d+)\) != reference size \((\d+), (\d+)\)/;

/** Translate common backend errors into short Japanese explanations for the UI banner. */
export function describeApiError(e: unknown): string {
  if (e instanceof ApiError) {
    const match = e.detail.match(DIMENSION_MISMATCH_RE);
    if (match) {
      const [, cw, ch, rw, rh] = match;
      return `画像サイズが一致しないため比較できません(撮影画像: ${cw}×${ch} / Reference画像: ${rw}×${rh})。同じ解像度の画像をアップロードするか、サイズの合う画像をReferenceに昇格し直してください。`;
    }
    if (e.status === 409) return e.detail;
    if (e.status === 404) return `見つかりませんでした: ${e.detail}`;
    return e.detail;
  }
  return e instanceof Error ? e.message : String(e);
}

export function imageUrl(kind: "captures" | "diffs", id: string): string {
  return `${API_BASE}/api/${kind}/${id}/image`;
}

export const api = {
  listInstructions: () => request<CaptureInstruction[]>("/api/instructions"),

  createInstruction: (body: {
    scene_or_level_id: string;
    frame_rate?: number;
    seed?: number;
    jitter?: number;
    warmup_frames?: number;
  }) =>
    request<CaptureInstruction>("/api/instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  listCapturedImages: (instructionId: string) =>
    request<CapturedImage[]>(
      `/api/captures?instruction_id=${encodeURIComponent(instructionId)}`,
    ),

  deleteCapturedImage: (capturedImageId: string) =>
    request<void>(`/api/captures/${encodeURIComponent(capturedImageId)}`, {
      method: "DELETE",
    }),

  uploadCapturedImage: async (
    instructionId: string,
    buildVersion: string,
    file: File,
  ) => {
    const form = new FormData();
    form.append("instruction_id", instructionId);
    form.append("build_version", buildVersion);
    form.append("file", file);
    return request<CapturedImage>("/api/captures", {
      method: "POST",
      body: form,
    });
  },

  promoteReference: (capturedImageId: string, approvedBy: string) =>
    request<ReferenceImage>("/api/references/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captured_image_id: capturedImageId,
        approved_by: approvedBy,
      }),
    }),

  getActiveReference: (instructionId: string) =>
    request<ReferenceImage>(
      `/api/references/active/${encodeURIComponent(instructionId)}`,
    ),

  getReference: (referenceImageId: string) =>
    request<ReferenceImage>(
      `/api/references/${encodeURIComponent(referenceImageId)}`,
    ),

  runDiff: (
    capturedImageId: string,
    opts?: {
      perPixelTolerance?: number;
      maxDiffPixels?: number;
      minDiffRegionPixels?: number;
      referenceImageId?: string;
    },
  ) =>
    request<DiffRunResult>("/api/diffs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captured_image_id: capturedImageId,
        reference_image_id: opts?.referenceImageId,
        per_pixel_tolerance: opts?.perPixelTolerance ?? 0,
        max_diff_pixels: opts?.maxDiffPixels ?? 0,
        min_diff_region_pixels: opts?.minDiffRegionPixels ?? 1,
      }),
    }),

  runDiffBatch: (
    capturedImageIds: string[],
    opts?: {
      perPixelTolerance?: number;
      maxDiffPixels?: number;
      minDiffRegionPixels?: number;
      referenceImageId?: string;
    },
  ) =>
    request<DiffBatchRunResponse>("/api/diffs/run-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captured_image_ids: capturedImageIds,
        reference_image_id: opts?.referenceImageId,
        per_pixel_tolerance: opts?.perPixelTolerance ?? 0,
        max_diff_pixels: opts?.maxDiffPixels ?? 0,
        min_diff_region_pixels: opts?.minDiffRegionPixels ?? 1,
      }),
    }),

  getDiffImage: (diffImageId: string) =>
    request<DiffImage>(`/api/diffs/${encodeURIComponent(diffImageId)}`),

  listRuns: (instructionId?: string) =>
    request<RunRow[]>(
      instructionId
        ? `/api/runs?instruction_id=${encodeURIComponent(instructionId)}`
        : "/api/runs",
    ),

  firstBadCommit: (instructionId: string) =>
    request<FirstBadCommit>(
      `/api/runs/first-bad-commit/${encodeURIComponent(instructionId)}`,
    ),
};
