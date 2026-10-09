import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, describeApiError, imageUrl } from "../api";
import { formatCount, formatPercent, pickColumns } from "../format";
import type { DashboardRow, Verdict } from "../types";
import { SplitFlapNumber } from "./SplitFlapNumber";
import { VerdictBadge } from "./VerdictBadge";

interface Props {
  onOpenInstruction: (instructionId: string) => void;
}

const MIN_CARD_WIDTH = 240;
const MAX_COLUMNS = 6;
const GRID_GAP = 16;

type Tone = Verdict | "untested";

function toneOf(row: DashboardRow): Tone {
  return row.latest_verdict ?? "untested";
}

/** Screen board: every capture instruction as a card, colour-coded by its
 * latest diff rate. An instruction nobody has evaluated yet is drawn grey and
 * dashed and says "未検査" in words -- a gap in coverage should stand out,
 * not blend in as a quiet row. */
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

  const count = (tone: Tone) => rows?.filter((r) => toneOf(r) === tone).length ?? 0;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--spacing-md)" }}>
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>画面一覧ボード</h2>
        </div>
        <button className="btn btn-tertiary btn-sm" onClick={load} disabled={loading}>
          {loading ? "更新中…" : "再読み込み"}
        </button>
      </div>

      {error && <p style={{ color: "var(--color-fail)" }}>{error}</p>}

      {rows && rows.length > 0 && (
        <div style={{ display: "flex", gap: "var(--spacing-md)", flexWrap: "wrap", alignItems: "center", fontSize: 14 }}>
          <span className="text-body-mid">検査対象 <span className="num">{rows.length}</span> 画面</span>
          <SummaryStat tone="pass" label="✓ 合格" count={count("pass")} />
          <SummaryStat tone="fail" label="✕ 不合格" count={count("fail")} />
          <SummaryStat tone="flaky" label="△ 不安定" count={count("flaky")} />
          <SummaryStat tone="na" label="— 未検査" count={count("untested")} />
        </div>
      )}

      {rows && rows.length === 0 && <p className="text-body-mid">まだ撮影指示がありません</p>}

      {rows && rows.length > 0 && <Board rows={rows} onOpenInstruction={onOpenInstruction} />}
    </section>
  );
}

function Board({ rows, onOpenInstruction }: { rows: DashboardRow[]; onOpenInstruction: (id: string) => void }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [maxColumns, setMaxColumns] = useState(MAX_COLUMNS);

  // How many cards fit across the available width; pickColumns then trims
  // that to a count that leaves no ragged last row where possible.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const fit = Math.floor((el.clientWidth + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP));
      setMaxColumns(Math.max(1, Math.min(MAX_COLUMNS, fit)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = pickColumns(rows.length, maxColumns);

  return (
    <div
      ref={gridRef}
      className="board-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {rows.map((row) => (
        <BoardCard key={row.instruction_id} row={row} onOpen={() => onOpenInstruction(row.instruction_id)} />
      ))}
    </div>
  );
}

function BoardCard({ row, onOpen }: { row: DashboardRow; onOpen: () => void }) {
  const tone = toneOf(row);
  // The board only knows the pixel allowance, not the capture size, so it
  // can't print the percentage form; the Diff Viewer shows "許容 x% (n px)".
  const tolerance =
    row.latest_max_diff_pixels != null
      ? `許容 ${formatCount(row.latest_max_diff_pixels)} px`
      : null;

  return (
    <button type="button" className={`board-card board-card-${tone}`} onClick={onOpen}>
      {row.latest_captured_image_id ? (
        <img
          className="board-thumb"
          src={imageUrl("captures", row.latest_captured_image_id)}
          alt={`${row.scene_or_level_id} の最新の撮影画像`}
          loading="lazy"
        />
      ) : (
        <div className="board-thumb board-thumb-empty" aria-hidden="true">
          — 未検査
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--spacing-sm)" }}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.scene_or_level_id}
        </strong>
        <VerdictBadge verdict={row.latest_verdict} />
      </div>

      <div className="text-body-mid" style={{ fontSize: 12 }}>
        {row.latest_evaluated_at
          ? `最終検査 ${new Date(row.latest_evaluated_at).toLocaleString()}${row.latest_build_version ? ` · ${row.latest_build_version}` : ""}`
          : row.has_active_reference
            ? "検査指示あり · まだ差分を実行していません"
            : "基準画像が未設定です"}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--spacing-sm)" }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 600 }}>
          {row.latest_diff_percentage != null ? formatPercent(row.latest_diff_percentage) : "—"}
        </span>
        <span className="num text-body-mid" style={{ fontSize: 12 }}>
          {tolerance ?? ""}
        </span>
      </div>

      <div className="text-body-mid" style={{ fontSize: 12, display: "flex", gap: "var(--spacing-md)", flexWrap: "wrap" }}>
        <span>
          実行 <span className="num">{row.total_runs}</span> 回
        </span>
        {row.open_alert_count > 0 && (
          <span style={{ color: "var(--color-fail)", fontWeight: 600 }}>
            ✕ 未解決アラート <span className="num">{row.open_alert_count}</span>
          </span>
        )}
      </div>
    </button>
  );
}

/** Counts flip when they change -- the one place in the UI where a flap number
 * says "how many" rather than being a figure to compare. */
function SummaryStat({ label, count, tone }: { label: string; count: number; tone: "fail" | "flaky" | "pass" | "na" }) {
  return (
    <span className={`badge-pill badge-${tone}`} style={{ fontSize: 13, gap: "var(--spacing-xs)" }}>
      {label}
      <SplitFlapNumber value={String(count)} />
    </span>
  );
}
