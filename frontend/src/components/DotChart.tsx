import { useEffect, useState } from "react";
import { imageUrl } from "../api";
import { formatCount, formatPercent } from "../format";
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

// The dot says pass/fail by shape as well as colour.
const DOT_GLYPH: Record<Verdict, string> = {
  pass: "✓",
  fail: "✕",
  flaky: "△",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "✓ 合格",
  fail: "✕ 不合格",
  flaky: "△ 不安定",
};

const TOOLTIP_WIDTH = 148;
const TOOLTIP_GAP = 8;
const VIEWPORT_MARGIN = 8;

interface TooltipAnchor {
  runId: string;
  /** Viewport coordinates of the hovered dot's top-centre. */
  x: number;
  y: number;
}

/** Run history as a timeline: one dot per evaluated build, oldest-first, so
 * the shape of the history reads left-to-right. The first-bad-commit run is
 * ringed. Hovering a dot shows a tooltip with the diff thumbnail.
 *
 * The tooltip is `position: fixed`, positioned from the dot's bounding box.
 * The dot row scrolls horizontally, and any overflow-x other than `visible`
 * also clips overflow-y -- an absolutely positioned tooltip inside it would be
 * cut off at the row's edges. A fixed tooltip escapes that clipping, so the
 * row needs no reserved empty space around it. */
export function DotChart({
  runs,
  firstBadCommit,
  selectedRunId,
  onSelectRun,
}: Props) {
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);

  // A fixed tooltip would otherwise stay put while the page scrolls away
  // from its dot.
  useEffect(() => {
    if (!anchor) return;
    const clear = () => setAnchor(null);
    window.addEventListener("scroll", clear, true);
    return () => window.removeEventListener("scroll", clear, true);
  }, [anchor]);

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

  const hoveredRun = anchor
    ? chronological.find((r) => r.evaluation_result_id === anchor.runId)
    : undefined;

  function show(run: RunRow, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    setAnchor({
      runId: run.evaluation_result_id,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

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
          alignItems: "center",
          gap: 8,
          overflowX: "auto",
          padding: "var(--spacing-sm) var(--spacing-xs)",
        }}
      >
        {chronological.map((run) => {
          const isFirstBad =
            firstBadCommit?.instruction_id === run.instruction_id &&
            firstBadCommit.build_version === run.build_version;
          const isSelected = run.evaluation_result_id === selectedRunId;
          return (
            <button
              key={run.evaluation_result_id}
              type="button"
              onClick={() => onSelectRun(run)}
              onMouseEnter={(e) => show(run, e.currentTarget)}
              onMouseLeave={() => setAnchor(null)}
              onFocus={(e) => show(run, e.currentTarget)}
              onBlur={() => setAnchor(null)}
              aria-label={`${run.build_version} — ${VERDICT_LABEL[run.verdict]}${isFirstBad ? "(最初の不合格)" : ""}`}
              aria-current={isSelected ? "true" : undefined}
              style={{
                width: 22,
                height: 22,
                flexShrink: 0,
                borderRadius: "50%",
                background: DOT_COLOR[run.verdict],
                color: "var(--color-on-primary)",
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: isFirstBad
                  ? "3px solid var(--color-ink)"
                  : "1px solid transparent",
                outline: isSelected ? "2px solid var(--color-primary)" : "none",
                outlineOffset: 2,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {DOT_GLYPH[run.verdict]}
            </button>
          );
        })}
      </div>
      <div
        style={{ display: "flex", gap: "var(--spacing-md)", fontSize: 11 }}
        className="text-body-mid"
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
      {anchor && hoveredRun && <DotTooltip run={hoveredRun} anchor={anchor} />}
    </div>
  );
}

function DotTooltip({ run, anchor }: { run: RunRow; anchor: TooltipAnchor }) {
  const half = TOOLTIP_WIDTH / 2;
  const left = Math.min(
    Math.max(anchor.x, VIEWPORT_MARGIN + half),
    window.innerWidth - VIEWPORT_MARGIN - half,
  );

  return (
    <div
      role="tooltip"
      className="card-outline"
      style={{
        position: "fixed",
        left,
        top: anchor.y - TOOLTIP_GAP,
        transform: "translate(-50%, -100%)",
        zIndex: 20,
        width: TOOLTIP_WIDTH,
        padding: "var(--spacing-sm)",
        background: "var(--color-canvas)",
        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.22)",
        pointerEvents: "none",
      }}
    >
      <img
        src={imageUrl("diffs", run.diff_image_id)}
        alt={`${run.build_version} の差分`}
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
          {run.build_version} — {VERDICT_LABEL[run.verdict]}
        </div>
        <div className="text-body-mid num">
          {formatCount(run.diff_pixel_count)} px / {formatPercent(run.diff_percentage)}
        </div>
        <div className="text-body-mid">
          {new Date(run.evaluated_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
