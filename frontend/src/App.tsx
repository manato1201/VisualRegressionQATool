import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeApiError } from "./api";
import { CapturePanel } from "./components/CapturePanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Dashboard } from "./components/Dashboard";
import { DiffViewer } from "./components/DiffViewer";
import { EmptyState } from "./components/EmptyState";
import { GettingStarted } from "./components/GettingStarted";
import { InstructionPanel } from "./components/InstructionPanel";
import { PromoteSummary } from "./components/PromoteSummary";
import { RunHistory } from "./components/RunHistory";
import { SegmentedControl } from "./components/SegmentedControl";
import { ToastStack } from "./components/ToastStack";
import {
  DEFAULT_DIFF_SETTINGS,
  type DiffSettingsValue,
} from "./diffSettingsValue";
import { applyTheme, getInitialTheme, type ThemeMode } from "./theme";
import type {
  CaptureInstruction,
  CapturedImage,
  FirstBadCommit,
  ReferenceImage,
  RunRow,
} from "./types";

type Tab = "guide" | "dashboard" | "tool";

const THEME_OPTIONS = [
  { key: "light", label: "ライト" },
  { key: "dark", label: "ダーク" },
] as const;

export default function App() {
  const [tab, setTab] = useState<Tab>("guide");
  const [instructions, setInstructions] = useState<CaptureInstruction[]>([]);
  const [selectedInstructionId, setSelectedInstructionId] = useState<
    string | null
  >(null);
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [activeReference, setActiveReference] = useState<ReferenceImage | null>(
    null,
  );
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [firstBadCommit, setFirstBadCommit] = useState<FirstBadCommit | null>(
    null,
  );
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);
  const [busyCapturedImageId, setBusyCapturedImageId] = useState<string | null>(
    null,
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [diffSettings, setDiffSettings] = useState<DiffSettingsValue>(
    DEFAULT_DIFF_SETTINGS,
  );
  const [batchBusy, setBatchBusy] = useState(false);
  const [openAlertCount, setOpenAlertCount] = useState(0);
  // Capture awaiting confirmation before it replaces the active Reference.
  const [pendingPromoteId, setPendingPromoteId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  function handleThemeChange(next: ThemeMode) {
    setTheme(next);
    applyTheme(next);
  }

  // Guards against out-of-order responses: if the user switches instructions
  // again before an in-flight refresh resolves, that stale response must not
  // overwrite state for the instruction now selected.
  const latestInstructionRef = useRef<string | null>(null);

  const refreshInstructions = useCallback(async () => {
    const list = await api.listInstructions();
    setInstructions(list);
    return list;
  }, []);

  const refreshInstructionDetail = useCallback(
    async (instructionId: string) => {
      latestInstructionRef.current = instructionId;
      const isStale = () => latestInstructionRef.current !== instructionId;

      const [images, runList] = await Promise.all([
        api.listCapturedImages(instructionId),
        api.listRuns(instructionId),
      ]);
      if (isStale()) return;
      setCapturedImages(images);
      setRuns(runList);
      setSelectedRun(
        (prev) =>
          runList.find(
            (r) => r.evaluation_result_id === prev?.evaluation_result_id,
          ) ??
          runList[0] ??
          null,
      );

      try {
        const activeRef = await api.getActiveReference(instructionId);
        if (!isStale()) setActiveReference(activeRef);
      } catch {
        if (!isStale()) setActiveReference(null);
      }
      try {
        const fbc = await api.firstBadCommit(instructionId);
        if (!isStale()) setFirstBadCommit(fbc);
      } catch {
        if (!isStale()) setFirstBadCommit(null);
      }
    },
    [],
  );

  useEffect(() => {
    refreshInstructions()
      .then((list) => {
        if (list.length > 0) {
          setSelectedInstructionId(list[0].instruction_id);
          setTab("tool");
        }
      })
      .catch((e) => setBanner(describeApiError(e)));
  }, [refreshInstructions]);

  const refreshOpenAlertCount = useCallback(async () => {
    try {
      const rows = await api.getDashboard();
      setOpenAlertCount(
        rows.reduce((sum, row) => sum + row.open_alert_count, 0),
      );
    } catch {
      // Non-critical background refresh -- leave the last known count as-is.
    }
  }, []);

  // Feature: unread-FAIL awareness. A toast only fires while this tab is
  // open and visible; the dashboard's open_alert_count survives regardless,
  // so polling it (rather than counting toasts) also covers failures from
  // CI or another browser tab.
  useEffect(() => {
    refreshOpenAlertCount();
    const interval = window.setInterval(refreshOpenAlertCount, 20000);
    return () => window.clearInterval(interval);
  }, [refreshOpenAlertCount]);

  useEffect(() => {
    document.title =
      openAlertCount > 0
        ? `(${openAlertCount}) Visual Regression QA Tool`
        : "Visual Regression QA Tool";
  }, [openAlertCount]);

  useEffect(() => {
    if (!selectedInstructionId) return;
    refreshInstructionDetail(selectedInstructionId).catch((e) =>
      setBanner(describeApiError(e)),
    );
  }, [selectedInstructionId, refreshInstructionDetail]);

  async function handleCreateInstruction(sceneOrLevelId: string) {
    setBanner(null);
    try {
      const created = await api.createInstruction({
        scene_or_level_id: sceneOrLevelId,
      });
      await refreshInstructions();
      setSelectedInstructionId(created.instruction_id);
      setTab("tool");
    } catch (e) {
      setBanner(describeApiError(e));
    }
  }

  async function handleUpload(buildVersion: string, file: File) {
    if (!selectedInstructionId) return;
    setBanner(null);
    try {
      await api.uploadCapturedImage(selectedInstructionId, buildVersion, file);
      await refreshInstructionDetail(selectedInstructionId);
    } catch (e) {
      setBanner(describeApiError(e));
    }
  }

  // The first promotion just establishes a baseline. Replacing an existing one
  // changes what every later diff is judged against, so that case is confirmed.
  function handlePromoteRequest(capturedImageId: string) {
    if (activeReference && activeReference.captured_image_id !== capturedImageId) {
      setPendingPromoteId(capturedImageId);
      return;
    }
    return handlePromote(capturedImageId);
  }

  async function handleConfirmPromote() {
    const id = pendingPromoteId;
    if (!id) return;
    await handlePromote(id);
    setPendingPromoteId(null);
  }

  async function handlePromote(capturedImageId: string) {
    if (!selectedInstructionId) return;
    setBusyCapturedImageId(capturedImageId);
    setBanner(null);
    try {
      await api.promoteReference(capturedImageId, "web-ui");
      await refreshInstructionDetail(selectedInstructionId);
    } catch (e) {
      setBanner(describeApiError(e));
    } finally {
      setBusyCapturedImageId(null);
    }
  }

  async function handleRunDiff(capturedImageId: string) {
    if (!selectedInstructionId) return;
    setBusyCapturedImageId(capturedImageId);
    setBanner(null);
    try {
      await api.runDiff(capturedImageId, {
        perPixelTolerance: diffSettings.perPixelTolerance,
        maxDiffPixels: diffSettings.maxDiffPixels,
        minDiffRegionPixels: diffSettings.minDiffRegionPixels,
        allowCenterCrop: diffSettings.allowCenterCrop,
      });
      await refreshInstructionDetail(selectedInstructionId);
      refreshOpenAlertCount();
    } catch (e) {
      setBanner(describeApiError(e));
    } finally {
      setBusyCapturedImageId(null);
    }
  }

  async function handleRunDiffBatch(capturedImageIds: string[]) {
    if (!selectedInstructionId) return;
    setBatchBusy(true);
    setBanner(null);
    try {
      const response = await api.runDiffBatch(capturedImageIds, {
        perPixelTolerance: diffSettings.perPixelTolerance,
        maxDiffPixels: diffSettings.maxDiffPixels,
        minDiffRegionPixels: diffSettings.minDiffRegionPixels,
        allowCenterCrop: diffSettings.allowCenterCrop,
      });
      await refreshInstructionDetail(selectedInstructionId);
      refreshOpenAlertCount();

      const failures = response.results.filter((r) => !r.ok);
      if (failures.length > 0) {
        const idToBuild = new Map(
          capturedImages.map((img) => [
            img.captured_image_id,
            img.build_version,
          ]),
        );
        const lines = failures.map(
          (f) =>
            `${idToBuild.get(f.captured_image_id) ?? f.captured_image_id}: ${f.error}`,
        );
        setBanner(
          `一括差分実行: ${response.results.length - failures.length}件成功 / ${failures.length}件失敗\n${lines.join("\n")}`,
        );
      }
    } catch (e) {
      setBanner(describeApiError(e));
    } finally {
      setBatchBusy(false);
    }
  }

  function handleOpenFromDashboard(instructionId: string) {
    setSelectedInstructionId(instructionId);
    setTab("tool");
  }

  async function handleDelete(capturedImageId: string) {
    if (!selectedInstructionId) return;
    setBusyCapturedImageId(capturedImageId);
    setBanner(null);
    try {
      await api.deleteCapturedImage(capturedImageId);
      await refreshInstructionDetail(selectedInstructionId);
    } catch (e) {
      setBanner(describeApiError(e));
    } finally {
      setBusyCapturedImageId(null);
    }
  }

  return (
    <div
      style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}
    >
      <ConfirmDialog
        open={pendingPromoteId !== null}
        title="基準画像(Reference)を更新しますか?"
        confirmLabel="Referenceを更新する"
        busy={busyCapturedImageId !== null && busyCapturedImageId === pendingPromoteId}
        onConfirm={handleConfirmPromote}
        onCancel={() => setPendingPromoteId(null)}
      >
        <PromoteSummary
          current={capturedImages.find((c) => c.captured_image_id === activeReference?.captured_image_id) ?? null}
          next={capturedImages.find((c) => c.captured_image_id === pendingPromoteId) ?? null}
        />
      </ConfirmDialog>
      <ToastStack onOpenInstruction={handleOpenFromDashboard} />
      <header
        style={{
          padding: "var(--spacing-md) var(--spacing-xl)",
          borderBottom: "1px solid var(--color-mute)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--spacing-md)",
        }}
      >
        <div>
          <p className="eyebrow">Visual Regression QA Tool</p>
          <h1 style={{ fontSize: 32 }}>差分ビューア</h1>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-lg)",
            flexWrap: "wrap",
          }}
        >
          <SegmentedControl
            label="テーマ"
            options={THEME_OPTIONS}
            value={theme}
            onChange={handleThemeChange}
          />
        <nav style={{ display: "flex", gap: "var(--spacing-xs)" }}>
          <button
            className={`btn btn-sm ${tab === "guide" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setTab("guide")}
          >
            はじめに
          </button>
          <button
            className={`btn btn-sm ${tab === "dashboard" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setTab("dashboard")}
            style={{ position: "relative" }}
          >
            ダッシュボード
            {openAlertCount > 0 && (
              <span
                aria-label={`未解決のFAILが${openAlertCount}件`}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  padding: "0 4px",
                  borderRadius: 9,
                  background: "var(--color-fail)",
                  color: "var(--color-on-primary)",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                {openAlertCount}
              </span>
            )}
          </button>
          <button
            className={`btn btn-sm ${tab === "tool" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setTab("tool")}
          >
            ツール
          </button>
        </nav>
        </div>
      </header>

      {banner && (
        <div
          style={{
            margin: "var(--spacing-md) var(--spacing-xl) 0",
            padding: "var(--spacing-md)",
            background: "var(--color-fail-bg)",
            color: "var(--color-fail)",
            borderRadius: "var(--rounded-md)",
            whiteSpace: "pre-line",
          }}
        >
          {banner}
        </div>
      )}

      {tab === "guide" ? (
        <main style={{ padding: "var(--spacing-xl)" }}>
          <GettingStarted />
        </main>
      ) : tab === "dashboard" ? (
        <main style={{ padding: "var(--spacing-xl)" }}>
          <Dashboard onOpenInstruction={handleOpenFromDashboard} />
        </main>
      ) : (
        <main
          style={{
            display: "flex",
            gap: "var(--spacing-xl)",
            padding: "var(--spacing-xl)",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <InstructionPanel
            instructions={instructions}
            selectedId={selectedInstructionId}
            onSelect={setSelectedInstructionId}
            onCreate={handleCreateInstruction}
          />

          <div
            style={{
              flex: 1,
              minWidth: 320,
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-xl)",
            }}
          >
            {selectedInstructionId ? (
              <>
                <CapturePanel
                  capturedImages={capturedImages}
                  activeReference={activeReference}
                  diffSettings={diffSettings}
                  onDiffSettingsChange={setDiffSettings}
                  onUpload={handleUpload}
                  onPromote={async (id) => {
                    await handlePromoteRequest(id);
                  }}
                  onRunDiff={handleRunDiff}
                  onRunDiffBatch={handleRunDiffBatch}
                  onDelete={handleDelete}
                  busyCapturedImageId={busyCapturedImageId}
                  batchBusy={batchBusy}
                />
                <RunHistory
                  runs={runs}
                  firstBadCommit={firstBadCommit}
                  selectedRunId={selectedRun?.evaluation_result_id ?? null}
                  onSelectRun={setSelectedRun}
                />
                {selectedRun && (
                  <DiffViewer
                    run={selectedRun}
                    runs={runs}
                    firstBadCommit={firstBadCommit}
                    onSelectRun={setSelectedRun}
                  />
                )}
              </>
            ) : (
              <EmptyState
                title="撮影指示が選択されていません"
                description="撮影指示は「同じ画面を継続して比較する単位」です。"
                steps={[
                  "左のパネルで、既存の撮影指示を選ぶ",
                  "ない場合は、シーンIDを入力して「撮影指示を作成」する",
                ]}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}
