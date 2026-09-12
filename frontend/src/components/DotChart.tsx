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

/** Phase 6, feature 2: one dot per evaluated build, oldest-first, so the
 * shape of the history reads left-to-right like a timeline. The
 * first-bad-commit row (from the existing Phase 4 query) gets a ring so the
 * exact point where things broke is visually obvious among a run of dots. */
export function DotChart({
  runs,
  firstBadCommit,
  selectedRunId,
  onSelectRun,
}: Props) {
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
          padding: "var(--spacing-md) var(--spacing-xs)",
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
              onClick={() => onSelectRun(run)}
              title={`${run.build_version} — ${run.verdict.toUpperCase()} (${new Date(run.evaluated_at).toLocaleString()})`}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                flexShrink: 0,
                background: DOT_COLOR[run.verdict],
                border: isFirstBad
                  ? "3px solid var(--color-ink)"
                  : isSelected
                    ? "2px solid var(--color-primary)"
                    : "1px solid transparent",
                outline: isSelected ? "2px solid var(--color-primary)" : "none",
                outlineOffset: 2,
                cursor: "pointer",
                padding: 0,
              }}
            />
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
    </div>
  );
}
