import { useEffect, useMemo, useRef, useState } from "react";
import { formatCount, formatPercent } from "../format";
import { shouldIgnoreShortcut } from "../shortcuts";
import type { FirstBadCommit, RunRow, Verdict } from "../types";
import { AsciiGarden } from "./AsciiGarden";
import { EmptyState } from "./EmptyState";
import { VERDICT_DESCRIPTION } from "../verdictText";
import { VerdictBadge } from "./VerdictBadge";

const PAGE_SIZE = 10;

type Filter = "all" | Verdict;

const CHIPS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "pass", label: "✓ 合格" },
  { key: "fail", label: "✕ 不合格" },
  { key: "flaky", label: "△ 不安定" },
];

interface Props {
  runs: RunRow[];
  firstBadCommit: FirstBadCommit | null;
  selectedRunId: string | null;
  onSelectRun: (run: RunRow) => void;
}

export function RunHistory({ runs, firstBadCommit, selectedRunId, onSelectRun }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box (the Diff Viewer lists the other shortcuts).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const counts = useMemo(
    () => ({
      all: runs.length,
      pass: runs.filter((r) => r.verdict === "pass").length,
      fail: runs.filter((r) => r.verdict === "fail").length,
      flaky: runs.filter((r) => r.verdict === "flaky").length,
    }),
    [runs],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter(
      (r) =>
        (filter === "all" || r.verdict === filter) &&
        (needle === "" || r.build_version.toLowerCase().includes(needle)),
    );
  }, [runs, filter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // When the selection moves (a click, or the viewer's arrow keys), show the
  // page it is on rather than leaving the highlighted row off-screen.
  const filteredRef = useRef(filtered);
  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);
  useEffect(() => {
    const index = filteredRef.current.findIndex((r) => r.evaluation_result_id === selectedRunId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
  }, [selectedRunId]);

  function changeFilter(next: Filter) {
    setFilter(next);
    setPage(0);
  }

  function clearFilters() {
    setFilter("all");
    setQuery("");
    setPage(0);
  }

  const cell = { padding: "var(--spacing-sm) var(--spacing-md)" } as const;
  const numCell = { ...cell, textAlign: "right" } as const;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div>
        <p className="eyebrow">Evaluation Runs</p>
        <h2 style={{ fontSize: 24, marginTop: 4 }}>実行履歴</h2>
      </div>

      <div style={{ display: "flex", gap: "var(--spacing-lg)", flexWrap: "wrap", fontSize: 13 }} className="text-body-mid">
        {(["pass", "fail", "flaky"] as const).map((verdict) => (
          <span key={verdict}>
            <span style={{ marginRight: "var(--spacing-xs)" }}>
              <VerdictBadge verdict={verdict} />
            </span>
            {VERDICT_DESCRIPTION[verdict]}
          </span>
        ))}
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
          <span className="badge-pill badge-fail" style={{ width: "fit-content" }}>
            First Bad Commit
          </span>
          <p style={{ margin: 0 }}>
            <strong>{firstBadCommit.build_version}</strong> —{" "}
            {new Date(firstBadCommit.evaluated_at).toLocaleString()} に最初の <code>fail</code> を検知
          </p>
        </div>
      )}

      {runs.length === 0 ? (
        <EmptyState
          art={<AsciiGarden mood="waiting" />}
          title="まだ検査結果がありません"
          description="この撮影指示は、差分を一度も実行していない「未検査」の状態です。"
          steps={[
            "上の「撮影画像」にbuild versionを付けて画像をアップロードする",
            "見た目が正しい1枚を「Referenceに昇格」する",
            "ほかの撮影画像で「差分実行」を押す",
          ]}
        />
      ) : (
        <>
          <div style={{ display: "flex", gap: "var(--spacing-sm)", flexWrap: "wrap", alignItems: "center" }}>
            <div role="group" aria-label="判定で絞り込み" style={{ display: "flex", gap: "var(--spacing-xs)", flexWrap: "wrap" }}>
              {CHIPS.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="chip"
                  aria-pressed={filter === chip.key}
                  onClick={() => changeFilter(chip.key)}
                >
                  {chip.label} <span className="num">{counts[chip.key]}</span>
                </button>
              ))}
            </div>
            <input
              ref={searchRef}
              id="run-search"
              type="text"
              aria-label="build versionで検索"
              placeholder="build versionで検索( / )"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              style={{ marginLeft: "auto", padding: "var(--spacing-xs) var(--spacing-md)", fontSize: 14, minWidth: 200 }}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="条件に一致する結果がありません"
              description="判定の絞り込み、または検索語を変えてみてください。"
              action={
                <button type="button" className="btn btn-tertiary btn-sm" onClick={clearFilters}>
                  絞り込みを解除
                </button>
              }
            />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-mute)" }}>
                    <th style={cell}>Verdict</th>
                    <th style={cell}>Build</th>
                    <th style={numCell}>差分ピクセル</th>
                    <th style={numCell}>差分率</th>
                    <th style={cell}>Evaluated At</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((run) => {
                    const selected = run.evaluation_result_id === selectedRunId;
                    return (
                      <tr
                        key={run.evaluation_result_id}
                        tabIndex={0}
                        // aria-selected is only valid on rows of a grid; a plain
                        // table row marks "this is the open one" with aria-current.
                        aria-current={selected ? "true" : undefined}
                        onClick={() => onSelectRun(run)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectRun(run);
                          }
                        }}
                        style={{
                          cursor: "pointer",
                          borderBottom: "1px solid var(--color-mute)",
                          background: selected ? "var(--color-canvas)" : "transparent",
                          boxShadow: selected ? "inset 3px 0 0 var(--color-primary)" : "none",
                        }}
                      >
                        <td style={cell}>
                          <VerdictBadge verdict={run.verdict} />
                        </td>
                        <td style={cell}>
                          {run.build_version}
                          {run.resolution_note && (
                            <span
                              title={run.resolution_note}
                              style={{ marginLeft: 6, fontSize: 11, cursor: "help" }}
                              className="badge-pill badge-flaky"
                            >
                              クロップ済
                            </span>
                          )}
                        </td>
                        <td className="num" style={numCell}>
                          {formatCount(run.diff_pixel_count)}
                        </td>
                        <td className="num" style={numCell}>
                          {formatPercent(run.diff_percentage)}
                        </td>
                        <td style={cell}>{new Date(run.evaluated_at).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > PAGE_SIZE && (
            <nav
              aria-label="実行履歴のページ"
              style={{ display: "flex", gap: "var(--spacing-md)", alignItems: "center", justifyContent: "flex-end", fontSize: 13 }}
            >
              <span className="text-body-mid">
                <span className="num">{filtered.length}</span> 件中{" "}
                <span className="num">
                  {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}
                </span>
              </span>
              <button type="button" className="btn btn-tertiary btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                ← 前へ
              </button>
              <span className="num" aria-current="page">
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="btn btn-tertiary btn-sm"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                次へ →
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
