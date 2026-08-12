import { useCallback, useEffect, useState } from "react";
import { api, describeApiError } from "./api";
import { CapturePanel } from "./components/CapturePanel";
import {
  DEFAULT_DIFF_SETTINGS,
  type DiffSettingsValue,
} from "./components/DiffSettings";
import { DiffViewer } from "./components/DiffViewer";
import { GettingStarted } from "./components/GettingStarted";
import { InstructionPanel } from "./components/InstructionPanel";
import { RunHistory } from "./components/RunHistory";
import type {
  CaptureInstruction,
  CapturedImage,
  FirstBadCommit,
  ReferenceImage,
  RunRow,
} from "./types";

type Tab = "guide" | "tool";

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

  const refreshInstructions = useCallback(async () => {
    const list = await api.listInstructions();
    setInstructions(list);
    return list;
  }, []);

  const refreshInstructionDetail = useCallback(
    async (instructionId: string) => {
      const [images, runList] = await Promise.all([
        api.listCapturedImages(instructionId),
        api.listRuns(instructionId),
      ]);
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
        setActiveReference(await api.getActiveReference(instructionId));
      } catch {
        setActiveReference(null);
      }
      try {
        setFirstBadCommit(await api.firstBadCommit(instructionId));
      } catch {
        setFirstBadCommit(null);
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
      });
      await refreshInstructionDetail(selectedInstructionId);
    } catch (e) {
      setBanner(describeApiError(e));
    } finally {
      setBusyCapturedImageId(null);
    }
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
        <nav style={{ display: "flex", gap: "var(--spacing-xs)" }}>
          <button
            className={`btn btn-sm ${tab === "guide" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setTab("guide")}
          >
            はじめに
          </button>
          <button
            className={`btn btn-sm ${tab === "tool" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setTab("tool")}
          >
            ツール
          </button>
        </nav>
      </header>

      {banner && (
        <div
          style={{
            margin: "var(--spacing-md) var(--spacing-xl) 0",
            padding: "var(--spacing-md)",
            background: "var(--color-fail-bg)",
            color: "var(--color-fail)",
            borderRadius: "var(--rounded-md)",
          }}
        >
          {banner}
        </div>
      )}

      {tab === "guide" ? (
        <main style={{ padding: "var(--spacing-xl)" }}>
          <GettingStarted />
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
                  onPromote={handlePromote}
                  onRunDiff={handleRunDiff}
                  onDelete={handleDelete}
                  busyCapturedImageId={busyCapturedImageId}
                />
                <RunHistory
                  runs={runs}
                  firstBadCommit={firstBadCommit}
                  selectedRunId={selectedRun?.evaluation_result_id ?? null}
                  onSelectRun={setSelectedRun}
                />
                {selectedRun && <DiffViewer run={selectedRun} />}
              </>
            ) : (
              <p className="text-body-mid">
                左のパネルから撮影指示を選択するか、新規作成してください。
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
