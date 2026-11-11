import type {
  CaptureInstruction,
  CapturedImage,
  DashboardRow,
  DiffBatchRunResponse,
  DiffImage,
  DiffPreviewResult,
  DiffRunResult,
  FirstBadCommit,
  ReferenceImage,
  RunRow,
  ToastListResponse,
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 認証(VRQA_AUTH=required)のクッキーを送る。API とは別オリジンでも、CORS が許可した origin なら付く。
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
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

export interface Me {
  mode: "off" | "required";
  authenticated: boolean;
  name: string | null;
  role: "viewer" | "operator" | "admin" | null;
  source: string | null;
  /** 開発者・デバッグ向けの機能(しきい値ラボなど)が、この人に使えるか。判断はサーバー側(本番では既定で無効・admin だけ) */
  debug: boolean;
}

export const api = {
  me: () => request<Me>("/api/auth/me"),
  login: (apiKey: string) =>
    request<Me>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

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
      allowCenterCrop?: boolean;
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
        allow_center_crop: opts?.allowCenterCrop ?? false,
      }),
    }),

  /** Threshold lab: judge with these settings without recording anything. */
  previewDiff: (
    capturedImageId: string,
    opts: {
      perPixelTolerance: number;
      maxDiffPixels: number;
      minDiffRegionPixels: number;
      allowCenterCrop: boolean;
      referenceImageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    request<DiffPreviewResult>("/api/diffs/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        captured_image_id: capturedImageId,
        reference_image_id: opts.referenceImageId,
        per_pixel_tolerance: opts.perPixelTolerance,
        max_diff_pixels: opts.maxDiffPixels,
        min_diff_region_pixels: opts.minDiffRegionPixels,
        allow_center_crop: opts.allowCenterCrop,
      }),
    }),

  runDiffBatch: (
    capturedImageIds: string[],
    opts?: {
      perPixelTolerance?: number;
      maxDiffPixels?: number;
      minDiffRegionPixels?: number;
      allowCenterCrop?: boolean;
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
        allow_center_crop: opts?.allowCenterCrop ?? false,
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

  getDashboard: () => request<DashboardRow[]>("/api/runs/dashboard"),

  listToasts: (sinceId: number) =>
    request<ToastListResponse>(`/api/alerts/toasts?since_id=${sinceId}`),
};
