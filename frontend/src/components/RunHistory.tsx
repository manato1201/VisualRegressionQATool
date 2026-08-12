import type { FirstBadCommit, RunRow } from "../types";
import { VERDICT_DESCRIPTION, VerdictBadge } from "./VerdictBadge";

interface Props {
  runs: RunRow[];
  firstBadCommit: FirstBadCommit | null;
  selectedRunId: string | null;
  onSelectRun: (run: RunRow) => void;
}

export function RunHistory({
  runs,
  firstBadCommit,
  selectedRunId,
  onSelectRun,
}: Props) {
  return (
    <section
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-lg)",
      }}
    >
      <div>
        <p className="eyebrow">Evaluation Runs</p>
        <h2 style={{ fontSize: 24, marginTop: 4 }}>実行履歴</h2>
      </div>

      <div
        style={{
          display: "flex",
          gap: "var(--spacing-lg)",
          flexWrap: "wrap",
          fontSize: 13,
        }}
        className="text-body-mid"
      >
        <span>
          <span
            className="badge-pill badge-pass"
            style={{ marginRight: "var(--spacing-xs)" }}
          >
            Pass
          </span>
          {VERDICT_DESCRIPTION.pass}
        </span>
        <span>
          <span
            className="badge-pill badge-fail"
            style={{ marginRight: "var(--spacing-xs)" }}
          >
            Fail
          </span>
          {VERDICT_DESCRIPTION.fail}
        </span>
      </div>

      {firstBadCommit && (
        <div
          className="card-outline"
          style={{
            borderColor: "var(--color-fail)",
            background: "var(--color-fail-bg)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            className="badge-pill badge-fail"
            style={{ width: "fit-content" }}
          >
            First Bad Commit
          </span>
          <p style={{ margin: 0 }}>
            <strong>{firstBadCommit.build_version}</strong> —{" "}
            {new Date(firstBadCommit.evaluated_at).toLocaleString()} に最初の{" "}
            <code>fail</code> を検知
          </p>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr
              style={{
                textAlign: "left",
                borderBottom: "1px solid var(--color-mute)",
              }}
            >
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                Verdict
              </th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                Build
              </th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                Diff Pixels
              </th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                Diff %
              </th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                Evaluated At
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ padding: "var(--spacing-md)" }}
                  className="text-body-mid"
                >
                  まだ実行履歴がありません
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr
                key={run.evaluation_result_id}
                onClick={() => onSelectRun(run)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--color-mute)",
                  background:
                    run.evaluation_result_id === selectedRunId
                      ? "var(--color-canvas-soft)"
                      : "transparent",
                }}
              >
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  <VerdictBadge verdict={run.verdict} />
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {run.build_version}
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {run.diff_pixel_count.toLocaleString()}
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {run.diff_percentage.toFixed(4)}%
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {new Date(run.evaluated_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
