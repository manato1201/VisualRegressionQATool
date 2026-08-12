export type Verdict = "pass" | "fail" | "flaky";

export interface CameraPose {
  position: [number, number, number];
  rotation: [number, number, number];
  fov: number;
}

export interface CaptureInstruction {
  instruction_id: string;
  scene_or_level_id: string;
  camera_pose: CameraPose;
  frame_rate: number;
  seed: number;
  jitter: number;
  warmup_frames: number;
  created_at: string;
}

export interface CapturedImage {
  captured_image_id: string;
  instruction_id: string;
  build_version: string;
  captured_at: string;
  checksum: string;
  image_path: string;
  resolution_width: number;
  resolution_height: number;
  color_space: string;
  dedup_hit: boolean;
}

export interface ReferenceImage {
  reference_image_id: string;
  captured_image_id: string;
  instruction_id: string;
  approved_at: string;
  approved_by: string;
  is_active: boolean;
}

export interface DiffImage {
  diff_image_id: string;
  captured_image_id: string;
  reference_image_id: string;
  diff_image_path: string;
  diff_pixel_count: number;
  diff_percentage: number;
  created_at: string;
}

export interface EvaluationResult {
  evaluation_result_id: string;
  diff_image_id: string;
  verdict: Verdict;
  evaluated_at: string;
}

export interface DiffRunResult {
  diff_image: DiffImage;
  evaluation_result: EvaluationResult;
  alert: Record<string, unknown> | null;
}

export interface RunRow {
  evaluation_result_id: string;
  verdict: Verdict;
  evaluated_at: string;
  diff_image_id: string;
  diff_pixel_count: number;
  diff_percentage: number;
  captured_image_id: string;
  build_version: string;
  instruction_id: string;
  scene_or_level_id: string;
  reference_image_id: string;
}

export interface FirstBadCommit {
  instruction_id: string;
  build_version: string;
  evaluated_at: string;
}

export interface DiffBatchItemResult {
  captured_image_id: string;
  ok: boolean;
  diff_image: DiffImage | null;
  evaluation_result: EvaluationResult | null;
  alert: Record<string, unknown> | null;
  error: string | null;
}

export interface DiffBatchRunResponse {
  results: DiffBatchItemResult[];
}
