import { useState } from "react";
import { imageUrl } from "../api";
import type { FirstBadCommit, RunRow, Verdict } from "../types";

interface Props {
  runs: RunRow[];
  firstBadCommit: FirstBadCommit | null;
  selectedRunId: string | null;
  onSelectRun: (run: RunRow) => void;
}

const DOT_COLOR: Record<Verdict, string> = {
  pass: "var(--color-pass)",
  fail: "var(--color-fail)",
  flaky: "var(--color-flaky)",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "PASS",
  fail: "FAIL",
  flaky: "FLAKY",
};

/** Phase 6, feature 2: one dot per evaluated build, oldest-first, so the
 * shape of the history reads left-to-right like a timeline. The
 * first-bad-commit row (from the existing Phase 4 query) gets a ring so the
 * exact point where things broke is visually obvious among a run of dots.
 * Hovering a dot shows a rich tooltip with the diff image thumbnail, so a
 * regression can be spotted from the history alone without opening it. */
export function DotChart({
  runs,
  firstBadCommit,
  selectedRunId,
  onSelectRun,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const chronological = [...runs].sort(
    (a, b) =>
      new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime(),
  );

  if (chronological.length === 0) {
    return (
      <p style={{ fontSize: 13 }} className="text-body-mid">
        まだ実行履歴がありません。
      </p>
    );
  }

  const hoveredRun = chronological.find(
    (r) => r.evaluation_result_id === hoveredId,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          overflowX: "auto",
          // Setting overflow-x forces the browser to also clip overflow-y
          // (per spec, "visible" on one axis only is not allowed once the
          // other is non-visible) -- so the hover tooltip, which pops up
          // *above* the dot via absolute positioning, would get cut off.
          // Reserving that space with padding keeps it inside this
          // container's own box instead of relying on visible overflow.
          paddingTop: 190,
          paddingBottom: "var(--spacing-md)",
          // The tooltip is centered on its dot and is 148px wide, so it can
          // overhang ~74px past the dot on either side -- same overflow-x
          // clipping issue as the vertical case above, but sideways, and it
          // bites the very dots (leftmost/rightmost) most likely to be
          // hovered. Reserve that width too instead of the default xs gutter.
          paddingLeft: 80,
          paddingRight: 80,
        }}
      >
        {chronological.map((run) => {
          const isFirstBad =
            firstBadCommit?.instruction_id === run.instruction_id &&
            firstBadCommit.build_version === run.build_version;
          const isSelected = run.evaluation_result_id === selectedRunId;
          const isHovered = run.evaluation_result_id === hoveredId;
          return (
            <div
              key={run.evaluation_result_id}
              style={{ position: "relative", flexShrink: 0 }}
            >
              {isHovered && (
                <DotTooltip
                  run={run}
                  verdictLabel={VERDICT_LABEL[run.verdict]}
                />
              )}
              <button
                onClick={() => onSelectRun(run)}
                onMouseEnter={() => setHoveredId(run.evaluation_result_id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(run.evaluation_result_id)}
                onBlur={() => setHoveredId(null)}
                aria-label={`${run.build_version} — ${VERDICT_LABEL[run.verdict]}`}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: DOT_COLOR[run.verdict],
                  border: isFirstBad
                    ? "3px solid var(--color-ink)"
                    : isSelected
                      ? "2px solid var(--color-primary)"
                      : "1px solid transparent",
                  outline: isSelected
                    ? "2px solid var(--color-primary)"
                    : "none",
                  outlineOffset: 2,
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{ display: "flex", gap: "var(--spacing-md)", fontSize: 11 }}
        className="text-mute"
      >
        <span>
          ← {new Date(chronological[0].evaluated_at).toLocaleDateString()}
        </span>
        <span style={{ marginLeft: "auto" }}>
          {new Date(
            chronological[chronological.length - 1].evaluated_at,
          ).toLocaleDateString()}{" "}
          →
        </span>
      </div>
      {hoveredRun && (
        <p style={{ fontSize: 11 }} className="text-mute">
          カーソルを外すと閉じます / クリックで詳細を表示
        </p>
      )}
    </div>
  );
}

function DotTooltip({
  run,
  verdictLabel,
}: {
  run: RunRow;
  verdictLabel: string;
}) {
  return (
    <div
      className="card-outline"
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        width: 148,
        padding: "var(--spacing-sm)",
        background: "var(--color-canvas)",
        boxShadow: "0 8px 20px rgba(32, 21, 21, 0.18)",
        pointerEvents: "none",
      }}
    >
      <img
        src={imageUrl("diffs", run.diff_image_id)}
        alt={`${run.build_version} diff`}
        style={{
          width: "100%",
          aspectRatio: "4/3",
          objectFit: "cover",
          borderRadius: "var(--rounded-sm)",
          border: "1px solid var(--color-mute)",
          display: "block",
        }}
      />
      <div style={{ marginTop: 6, fontSize: 11 }}>
        <div style={{ fontWeight: 600 }}>
          {run.build_version} — {verdictLabel}
        </div>
        <div className="text-mute">
          {run.diff_pixel_count.toLocaleString()}px /{" "}
          {run.diff_percentage.toFixed(2)}%
        </div>
        <div className="text-mute">
          {new Date(run.evaluated_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
