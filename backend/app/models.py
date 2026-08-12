"""Pydantic request/response models for the API layer."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Verdict = Literal["pass", "fail", "flaky"]


class CameraPose(BaseModel):
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    fov: float = 60.0


class CaptureInstructionCreate(BaseModel):
    scene_or_level_id: str
    camera_pose: CameraPose = Field(default_factory=CameraPose)
    frame_rate: int = 60
    seed: int = 0
    jitter: float = 0.0
    warmup_frames: int = 0


class CaptureInstructionOut(BaseModel):
    instruction_id: str
    scene_or_level_id: str
    camera_pose: CameraPose
    frame_rate: int
    seed: int
    jitter: float
    warmup_frames: int
    created_at: str


class CapturedImageOut(BaseModel):
    captured_image_id: str
    instruction_id: str
    build_version: str
    captured_at: str
    checksum: str
    image_path: str
    resolution_width: int
    resolution_height: int
    color_space: str
    dedup_hit: bool = False


class ReferenceImageOut(BaseModel):
    reference_image_id: str
    captured_image_id: str
    instruction_id: str
    approved_at: str
    approved_by: str
    is_active: bool


class ReferencePromoteRequest(BaseModel):
    captured_image_id: str
    approved_by: str = "unknown"


class DiffRunRequest(BaseModel):
    captured_image_id: str
    reference_image_id: Optional[str] = None
    per_pixel_tolerance: int = 0
    max_diff_pixels: int = 0
    min_diff_region_pixels: int = 1


class DiffImageOut(BaseModel):
    diff_image_id: str
    captured_image_id: str
    reference_image_id: str
    diff_image_path: str
    diff_pixel_count: int
    diff_percentage: float
    created_at: str


class EvaluationResultOut(BaseModel):
    evaluation_result_id: str
    diff_image_id: str
    verdict: Verdict
    evaluated_at: str


class DiffRunResult(BaseModel):
    diff_image: DiffImageOut
    evaluation_result: EvaluationResultOut
    alert: Optional[dict] = None


class DiffBatchRunRequest(BaseModel):
    captured_image_ids: list[str]
    reference_image_id: Optional[str] = None
    per_pixel_tolerance: int = 0
    max_diff_pixels: int = 0
    min_diff_region_pixels: int = 1


class DiffBatchItemResult(BaseModel):
    captured_image_id: str
    ok: bool
    diff_image: Optional[DiffImageOut] = None
    evaluation_result: Optional[EvaluationResultOut] = None
    alert: Optional[dict] = None
    error: Optional[str] = None


class DiffBatchRunResponse(BaseModel):
    results: list[DiffBatchItemResult]


class FirstBadCommitOut(BaseModel):
    instruction_id: str
    build_version: str
    evaluated_at: str


class RunRow(BaseModel):
    evaluation_result_id: str
    verdict: Verdict
    evaluated_at: str
    diff_image_id: str
    diff_pixel_count: int
    diff_percentage: float
    captured_image_id: str
    build_version: str
    instruction_id: str
    scene_or_level_id: str
    reference_image_id: str
