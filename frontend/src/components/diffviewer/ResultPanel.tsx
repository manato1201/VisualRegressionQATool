import {
  captureConditions,
  formatCount,
  formatPercent,
  formatTolerance,
} from "../../format";
import type { RunRow } from "../../types";
import { VerdictBadge } from "../VerdictBadge";

interface Props {
  run: RunRow;
  /** Number of diff regions, or null while the diff image is still being read. */
  regionCount: number | null;
}

/** The result next to the images: verdict, rate against its tolerance, pixel
 * and region counts, and the capture conditions that produced it. Everything
 * here is plain, non-animated text -- these are the numbers being compared. */
export function ResultPanel({ run, regionCount }: Props) {
  const tolerance = formatTolerance(
    run.max_diff_pixels,
    run.resolution_width,
    run.resolution_height,
  );

  return (
    <aside
      className="card-outline"
      aria-label="判定結果と撮影条件"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-md)",
        padding: "var(--spacing-lg)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p className="eyebrow">結果</p>
        <div>
          <VerdictBadge verdict={run.verdict} />
        </div>
        <p
          className="num"
          style={{
            fontSize: 32,
            fontWeight: 600,
            lineHeight: "40px",
            margin: 0,
          }}
        >
          {formatPercent(run.diff_percentage)}
        </p>
        <p className="num text-body-mid" style={{ margin: 0, fontSize: 13 }}>
          {tolerance ?? "許容 —(記録なし)"}
        </p>
        <p className="num" style={{ margin: 0, fontSize: 13 }}>
          差分ピクセル {formatCount(run.diff_pixel_count)} · 領域{" "}
          {regionCount ?? "…"}
        </p>
        <p className="text-body-mid" style={{ margin: 0, fontSize: 12 }}>
          <span className="diff-swatch" aria-hidden="true" /> 差分ピクセルの色
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p className="eyebrow">撮影条件</p>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: "var(--spacing-md)",
            rowGap: 2,
            margin: 0,
            fontSize: 13,
          }}
        >
          {captureConditions(run).map((item) => (
            <div key={item.label} style={{ display: "contents" }}>
              <dt className="text-body-mid">{item.label}</dt>
              <dd className="num" style={{ margin: 0 }}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {run.resolution_note && (
        <p
          className="badge-flaky"
          style={{
            margin: 0,
            padding: "var(--spacing-sm) var(--spacing-md)",
            borderRadius: "var(--rounded-sm)",
            fontSize: 12,
          }}
        >
          {run.resolution_note}
        </p>
      )}
    </aside>
  );
}
