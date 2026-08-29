import { useEffect, useState } from "react";
import { api, describeApiError } from "../api";
import type { DashboardRow } from "../types";
import { VerdictBadge } from "./VerdictBadge";

interface Props {
  onOpenInstruction: (instructionId: string) => void;
}

export function Dashboard({ onOpenInstruction }: Props) {
  const [rows, setRows] = useState<DashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    api
      .getDashboard()
      .then(setRows)
      .catch((e) => setError(describeApiError(e)))
      .finally(() => setLoading(false));
  }

  // Dashboard is only ever rendered while its tab is active (see App.tsx),
  // so mounting itself is the "user just switched to this tab" signal --
  // no extra refresh-key plumbing needed to get fresh data each visit.
  useEffect(() => {
    load();
  }, []);

  const failing = rows?.filter((r) => r.latest_verdict === "fail").length ?? 0;
  const flaky = rows?.filter((r) => r.latest_verdict === "flaky").length ?? 0;
  const passing = rows?.filter((r) => r.latest_verdict === "pass").length ?? 0;
  const untested = rows?.filter((r) => r.latest_verdict === null).length ?? 0;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--spacing-md)" }}>
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>全シーン概況</h2>
        </div>
        <button className="btn btn-tertiary btn-sm" onClick={load} disabled={loading}>
          {loading ? "更新中…" : "再読み込み"}
        </button>
      </div>

      {error && <p style={{ color: "var(--color-fail)" }}>{error}</p>}

      {rows && rows.length > 0 && (
        <div style={{ display: "flex", gap: "var(--spacing-lg)", flexWrap: "wrap", fontSize: 14 }}>
          <SummaryStat label="Fail" count={failing} tone="fail" />
          <SummaryStat label="Flaky" count={flaky} tone="flaky" />
          <SummaryStat label="Pass" count={passing} tone="pass" />
          <SummaryStat label="未実行" count={untested} tone="na" />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-mute)" }}>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>状態</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>シーン</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>最新Build</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>Diff %</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>実行回数</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>Reference</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>未解決アラート</th>
              <th style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "var(--spacing-md)" }} className="text-body-mid">
                  まだ撮影指示がありません
                </td>
              </tr>
            )}
            {rows?.map((row) => (
              <tr key={row.instruction_id} style={{ borderBottom: "1px solid var(--color-mute)" }}>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {row.latest_verdict ? (
                    <VerdictBadge verdict={row.latest_verdict} />
                  ) : (
                    <span className="badge-pill badge-na">未実行</span>
                  )}
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>{row.scene_or_level_id}</td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>{row.latest_build_version ?? "—"}</td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {row.latest_diff_percentage != null ? `${row.latest_diff_percentage.toFixed(4)}%` : "—"}
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>{row.total_runs}</td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {row.has_active_reference ? "✓" : <span className="text-mute">未設定</span>}
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  {row.open_alert_count > 0 ? (
                    <span className="badge-pill badge-fail">{row.open_alert_count}</span>
                  ) : (
                    <span className="text-mute">0</span>
                  )}
                </td>
                <td style={{ padding: "var(--spacing-sm) var(--spacing-md)" }}>
                  <button className="btn btn-tertiary btn-sm" onClick={() => onOpenInstruction(row.instruction_id)}>
                    開く
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryStat({ label, count, tone }: { label: string; count: number; tone: "fail" | "flaky" | "pass" | "na" }) {
  return (
    <span className={`badge-pill badge-${tone}`} style={{ fontSize: 13 }}>
      {label}: {count}
    </span>
  );
}
