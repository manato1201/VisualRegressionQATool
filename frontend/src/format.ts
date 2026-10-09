/** Display rules from the "決めごと表" (IMPROVEMENT_DESIGN_2026-10 §3), kept in
 * one place so every screen prints the same number the same way. */

import type { RunRow } from "./types";

const INTEGER = new Intl.NumberFormat("en-US");

/** Half-width digits with thousands separators: 4,812. */
export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** Diff rate: half-width, exactly 2 decimals so digits line up in a column.
 * A non-zero rate that would round to 0.00 prints as "<0.01%" -- showing
 * "0.00%" next to a failing verdict reads as a contradiction. */
export function formatPercent(value: number): string {
  if (value > 0 && value < 0.005) return "<0.01%";
  return `${value.toFixed(2)}%`;
}

/** Allowed diff for a result, as "許容 0.50% (10,368 px)". null when the
 * result predates stored thresholds. */
export function formatTolerance(
  maxDiffPixels: number | null,
  width: number,
  height: number,
): string | null {
  if (maxDiffPixels == null) return null;
  const total = width * height;
  const percent = total > 0 ? (maxDiffPixels / total) * 100 : 0;
  return `許容 ${formatPercent(percent)} (${formatCount(maxDiffPixels)} px)`;
}

/** "1920×1080" */
export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`;
}

/** "時刻固定 0.0s" or "時刻 未固定". */
export function formatFixedTime(seconds: number | null): string {
  return seconds == null ? "時刻 未固定" : `時刻固定 ${seconds.toFixed(1)}s`;
}

export interface CaptureConditionItem {
  label: string;
  value: string;
}

/** The conditions that must travel with every result (plan U4 / P9). */
export function captureConditions(
  run: Pick<
    RunRow,
    | "resolution_width"
    | "resolution_height"
    | "fixed_time_seconds"
    | "seed"
    | "reduce_motion"
  >,
): CaptureConditionItem[] {
  return [
    {
      label: "解像度",
      value: formatResolution(run.resolution_width, run.resolution_height),
    },
    {
      label: "時刻",
      value:
        run.fixed_time_seconds == null
          ? "未固定"
          : `固定 ${run.fixed_time_seconds.toFixed(1)}s`,
    },
    { label: "シード", value: String(run.seed) },
    { label: "モーション低減", value: run.reduce_motion ? "ON" : "OFF" },
  ];
}

/** Column count for a card grid: fit the available width, but prefer a count
 * that leaves no ragged last row (plan U2: "最終段に余りを作らない").
 * Falls back to whichever count wastes the fewest cells when the item count
 * has no suitable divisor (e.g. a prime number of screens). */
export function pickColumns(count: number, maxColumns: number): number {
  if (count <= 0) return 1;
  const max = Math.max(1, Math.min(maxColumns, count));
  if (count <= max) return count;

  for (let c = max; c >= Math.min(3, max); c--) {
    if (count % c === 0) return c;
  }

  let best = max;
  let bestEmpty = Infinity;
  for (let c = max; c >= Math.min(2, max); c--) {
    const empty = (c - (count % c)) % c;
    if (empty < bestEmpty) {
      best = c;
      bestEmpty = empty;
    }
  }
  return best;
}
