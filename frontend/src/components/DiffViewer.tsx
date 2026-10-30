import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { api, describeApiError, imageUrl } from "../api";
import {
  clusterContains,
  findDiffClusters,
  type DiffCluster,
  type DiffClusterResult,
} from "../diffClusters";
import { loadPixelSampler, type PixelSampler } from "../pixelSampler";
import { cycle, shouldIgnoreShortcut } from "../shortcuts";
import type { FirstBadCommit, RunRow } from "../types";
import { AsciiGarden } from "./AsciiGarden";
import { DotChart } from "./DotChart";
import { EmptyState } from "./EmptyState";
import { SegmentedControl } from "./SegmentedControl";
import { VerdictBadge } from "./VerdictBadge";
import { BlinkCompare, BlinkControls } from "./diffviewer/BlinkCompare";
import { useBlink } from "./diffviewer/useBlink";
import { CompareSlider, SliderControls } from "./diffviewer/CompareSlider";
import { Frame } from "./diffviewer/Frame";
import {
  PixelInspectorPanel,
  type HoverPixel,
} from "./diffviewer/PixelInspectorPanel";
import { ResultPanel } from "./diffviewer/ResultPanel";
import {
  BACKGROUND_OPTIONS,
  ZOOM_OPTIONS,
  imageSizeStyle,
  stackWrapperStyle,
  type StageBackground,
  type ZoomMode,
} from "./diffviewer/shared";
import { ThresholdLab } from "./diffviewer/ThresholdLab";
import { ZoomPanel } from "./diffviewer/ZoomPanel";

type Mode = "diff" | "side-by-side" | "slider" | "blink" | "onion" | "single";

const MODE_OPTIONS = [
  { key: "diff", label: "差分" },
  { key: "side-by-side", label: "並べて" },
  { key: "slider", label: "スライダー" },
  { key: "blink", label: "点滅" },
  { key: "onion", label: "重ね" },
  { key: "single", label: "個別" },
] as const;

const MODE_KEYS = MODE_OPTIONS.map((o) => o.key);
const BACKGROUND_KEYS = BACKGROUND_OPTIONS.map((o) => o.key);

/** One image at a time, always in the order: baseline (nothing applied) ->
 * this capture (the change applied) -> the diff that compares them. */
type SingleView = "reference" | "captured" | "diff";

const SINGLE_OPTIONS = [
  { key: "reference", label: "基準" },
  { key: "captured", label: "今回" },
  { key: "diff", label: "差分" },
] as const;

const SINGLE_LABELS: Record<SingleView, string> = {
  reference: "基準 (Reference)",
  captured: "今回 (Captured)",
  diff: "差分 (Diff Highlight)",
};

interface Props {
  run: RunRow;
  runs: RunRow[];
  firstBadCommit: FirstBadCommit | null;
  onSelectRun: (run: RunRow) => void;
}

/** Relative (0-1) cursor position over an image; converted to a pixel
 * coordinate per image size, because the diff image and the captured image
 * can differ in size when a resolution mismatch was tolerated by cropping. */
interface HoverRel {
  x: number;
  y: number;
}

/** Percentage box for a cluster, in the diff image's own pixel space, so the
 * same style lines up on every image of the same size. */
function regionStyle(cluster: DiffCluster, size: { width: number; height: number }): CSSProperties {
  return {
    left: `${(cluster.minX / size.width) * 100}%`,
    top: `${(cluster.minY / size.height) * 100}%`,
    width: `${((cluster.maxX - cluster.minX + 1) / size.width) * 100}%`,
    height: `${((cluster.maxY - cluster.minY + 1) / size.height) * 100}%`,
  };
}

function toPixel(rel: HoverRel, size: { width: number; height: number }): HoverPixel {
  return {
    x: Math.min(size.width - 1, Math.max(0, Math.floor(rel.x * size.width))),
    y: Math.min(size.height - 1, Math.max(0, Math.floor(rel.y * size.height))),
  };
}

export function DiffViewer({ run, runs, firstBadCommit, onSelectRun }: Props) {
  const [mode, setMode] = useState<Mode>("diff");
  const [background, setBackground] = useState<StageBackground>("checker");
  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [diffOpacity, setDiffOpacity] = useState(1);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [onionOpacity, setOnionOpacity] = useState(0.5);
  const [singleView, setSingleView] = useState<SingleView>("reference");
  const blink = useBlink(mode === "blink");

  // Frame-by-frame stepping through the history, oldest first -- the same
  // left-to-right order as the timeline underneath.
  const chronological = useMemo(
    () =>
      [...runs].sort(
        (a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime(),
      ),
    [runs],
  );
  const position = chronological.findIndex(
    (r) => r.evaluation_result_id === run.evaluation_result_id,
  );
  function stepRun(offset: number) {
    const target = chronological[position + offset];
    if (target) onSelectRun(target);
  }

  // Keyboard: C = next display mode (Shift+C = previous), B = next
  // background, ← / → = older / newer result. "/" (focus history search)
  // lives in RunHistory. Typing, sliders and open dialogs are excluded by
  // shouldIgnoreShortcut, so none of these can fight normal input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (shouldIgnoreShortcut(e)) return;
      switch (e.key) {
        case "c":
        case "C":
          e.preventDefault();
          setMode((m) => cycle(MODE_KEYS, m, e.shiftKey ? -1 : 1));
          setHoverRel(null);
          break;
        case "b":
        case "B":
          e.preventDefault();
          setBackground((b) => cycle(BACKGROUND_KEYS, b, e.shiftKey ? -1 : 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepRun(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          stepRun(1);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // stepRun closes over position/chronological; re-register when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, chronological, onSelectRun]);
  const [referenceCapturedImageId, setReferenceCapturedImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [capturedSampler, setCapturedSampler] = useState<PixelSampler | null>(null);
  const [referenceSampler, setReferenceSampler] = useState<PixelSampler | null>(null);
  const [hoverRel, setHoverRel] = useState<HoverRel | null>(null);
  const [clusterResult, setClusterResult] = useState<DiffClusterResult | null>(null);
  const [pinnedClusterIndex, setPinnedClusterIndex] = useState<number | null>(null);
  const [showAllRegions, setShowAllRegions] = useState(false);

  // Smooth upscaling blurs a 1px difference into its neighbours -- exactly
  // what a pixel-comparison tool must not do. Track the stage width so images
  // shown larger than their real size can switch to nearest-neighbour.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReferenceCapturedImageId(null);
    setError(null);
    api
      .getReference(run.reference_image_id)
      .then((ref) => {
        if (!cancelled) setReferenceCapturedImageId(ref.captured_image_id);
      })
      .catch((e) => {
        if (!cancelled) setError(describeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [run.reference_image_id]);

  const capturedUrl = imageUrl("captures", run.captured_image_id);
  const diffUrl = imageUrl("diffs", run.diff_image_id);
  const referenceUrl = referenceCapturedImageId
    ? imageUrl("captures", referenceCapturedImageId)
    : null;

  useEffect(() => {
    let cancelled = false;
    setCapturedSampler(null);
    setHoverRel(null);
    loadPixelSampler(capturedUrl)
      .then((sampler) => {
        if (!cancelled) setCapturedSampler(sampler);
      })
      .catch(() => {
        if (!cancelled) setCapturedSampler(null);
      });
    return () => {
      cancelled = true;
    };
  }, [capturedUrl]);

  useEffect(() => {
    let cancelled = false;
    setReferenceSampler(null);
    if (!referenceUrl) return;
    loadPixelSampler(referenceUrl)
      .then((sampler) => {
        if (!cancelled) setReferenceSampler(sampler);
      })
      .catch(() => {
        if (!cancelled) setReferenceSampler(null);
      });
    return () => {
      cancelled = true;
    };
  }, [referenceUrl]);

  // Cluster the diff image client-side -- no backend API needed.
  useEffect(() => {
    let cancelled = false;
    setClusterResult(null);
    setPinnedClusterIndex(null);
    findDiffClusters(diffUrl)
      .then((found) => {
        if (!cancelled) setClusterResult(found);
      })
      .catch(() => {
        if (!cancelled) setClusterResult({ clusters: [], total: 0, width: 0, height: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [diffUrl]);

  // Hover state belongs to the mode that produced it.
  function changeMode(next: Mode) {
    setMode(next);
    setHoverRel(null);
  }

  function handleHover(e: MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setHoverRel({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  }

  const samplerSize = capturedSampler ?? referenceSampler;
  const diffSize =
    clusterResult && clusterResult.width > 0 ? clusterResult : null;
  const clusters = clusterResult?.clusters ?? [];

  const hoverPixel = hoverRel && samplerSize ? toPixel(hoverRel, samplerSize) : null;
  const capturedPixel = hoverPixel && capturedSampler ? capturedSampler.sample(hoverPixel.x, hoverPixel.y) : null;
  const referencePixel = hoverPixel && referenceSampler ? referenceSampler.sample(hoverPixel.x, hoverPixel.y) : null;
  const canInspect = Boolean(capturedSampler) || Boolean(referenceSampler);

  // The focus ring only appears while hovering *inside* a detected cluster.
  const hoverDiffPixel = hoverRel && diffSize ? toPixel(hoverRel, diffSize) : null;
  const hoveredClusterIndex = hoverDiffPixel
    ? clusters.findIndex((c) => clusterContains(c, hoverDiffPixel.x, hoverDiffPixel.y))
    : -1;
  const hoveredCluster = hoveredClusterIndex >= 0 ? clusters[hoveredClusterIndex] : null;
  const ringStyle: CSSProperties | null =
    hoveredCluster && diffSize ? regionStyle(hoveredCluster, diffSize) : null;

  // "Show every region": still outlines around all detected clusters, for
  // seeing at a glance where the changes are before hovering any of them.
  const regionBoxes: CSSProperties[] | undefined =
    showAllRegions && diffSize ? clusters.map((c) => regionStyle(c, diffSize)) : undefined;

  // Clicking inside a hovered cluster pins it, so the zoomed crop stays put
  // once the cursor moves away to compare it against the pixel inspector.
  function handleClickPin() {
    if (hoveredClusterIndex >= 0) setPinnedClusterIndex(hoveredClusterIndex);
  }
  const pinnedCluster = pinnedClusterIndex != null ? clusters[pinnedClusterIndex] : null;

  const naturalWidth = run.resolution_width;
  const STAGE_PADDING_X = 24; // matches .stage padding (12px each side)
  const columns = mode === "side-by-side" ? 3 : 1;
  const displayedWidth = (stageWidth - STAGE_PADDING_X) / columns;
  const upscaled = zoom === "fit" && displayedWidth > naturalWidth;
  const hoverHandlers = {
    onHover: handleHover,
    onLeave: () => setHoverRel(null),
    onClick: handleClickPin,
  };

  const zoomPanel =
    pinnedCluster && diffSize ? (
      <ZoomPanel
        cluster={pinnedCluster}
        imageUrl={diffUrl}
        imageWidth={diffSize.width}
        imageHeight={diffSize.height}
        onClose={() => setPinnedClusterIndex(null)}
      />
    ) : null;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "var(--spacing-md)" }}>
        <div>
          <p className="eyebrow">Diff Viewer</p>
          <h2 style={{ fontSize: 24, marginTop: 4, display: "flex", alignItems: "center", gap: "var(--spacing-md)", flexWrap: "wrap" }}>
            {run.build_version} <VerdictBadge verdict={run.verdict} />
          </h2>
        </div>
        <div role="group" aria-label="結果のコマ送り" style={{ display: "flex", alignItems: "center", gap: "var(--spacing-sm)" }}>
          <button type="button" className="btn btn-tertiary btn-sm" disabled={position <= 0} onClick={() => stepRun(-1)}>
            ◀ 前の結果
          </button>
          <span className="num" style={{ fontSize: 13, minWidth: "6ch", textAlign: "center" }}>
            {position + 1} / {chronological.length}
          </span>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={position < 0 || position >= chronological.length - 1}
            onClick={() => stepRun(1)}
          >
            次の結果 ▶
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-md) var(--spacing-xl)", alignItems: "center" }}>
        <ToolbarGroup label="表示">
          <SegmentedControl
            kind="tab"
            label="表示モード"
            options={MODE_OPTIONS}
            value={mode}
            onChange={changeMode}
          />
        </ToolbarGroup>
        <ToolbarGroup label="背景">
          <SegmentedControl label="背景" options={BACKGROUND_OPTIONS} value={background} onChange={setBackground} />
        </ToolbarGroup>
        <ToolbarGroup label="ズーム">
          <SegmentedControl label="ズーム" options={ZOOM_OPTIONS} value={zoom} onChange={setZoom} />
        </ToolbarGroup>
      </div>

      <p className="text-body-mid" style={{ margin: 0, fontSize: 12 }}>
        <span className="kbd">C</span> 表示切替 · <span className="kbd">B</span> 背景 · <span className="kbd">←</span>{" "}
        <span className="kbd">→</span> 前後の結果 · <span className="kbd">/</span> 履歴を検索
      </p>

      {error && <p style={{ color: "var(--color-fail)" }}>reference画像の解決に失敗しました: {error}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-lg)", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
          {mode === "slider" && <SliderControls position={sliderPosition} onChange={setSliderPosition} />}
          {mode === "blink" && <BlinkControls {...blink} />}
          {mode === "single" && (
            <SegmentedControl label="表示する画像" options={SINGLE_OPTIONS} value={singleView} onChange={setSingleView} />
          )}
          {mode === "onion" && (
            <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-md)", fontSize: 13, color: "var(--color-body)" }}>
              <span>Reference</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={onionOpacity}
                aria-label="撮影画像の濃さ(0で基準画像のみ、1で撮影画像のみ)"
                onChange={(e) => setOnionOpacity(Number(e.target.value))}
                style={{ flex: 1, maxWidth: 360 }}
              />
              <span>Captured</span>
              <span className="num" style={{ minWidth: "4ch", textAlign: "right" }}>
                {(onionOpacity * 100).toFixed(0)}%
              </span>
            </label>
          )}
          <div
            ref={stageRef}
            role="tabpanel"
            aria-label="比較表示"
            className={`stage stage-${background}${upscaled ? " stage-pixelated" : ""}`}
          >
            {mode === "diff" && (
              <div style={stackWrapperStyle(zoom)}>
                {referenceUrl && (
                  <img
                    src={referenceUrl}
                    alt=""
                    aria-hidden="true"
                    crossOrigin="anonymous"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                  />
                )}
                <img
                  src={diffUrl}
                  alt="差分ハイライト"
                  crossOrigin="anonymous"
                  style={{
                    display: "block",
                    position: "relative",
                    ...imageSizeStyle(zoom, naturalWidth),
                    opacity: diffOpacity,
                    cursor: "crosshair",
                  }}
                  onMouseMove={handleHover}
                  onMouseLeave={hoverHandlers.onLeave}
                  onClick={handleClickPin}
                />
                {regionBoxes?.map((style, i) => (
                  <div key={i} className="diff-region-box" style={style} />
                ))}
                {ringStyle && <div className="diff-focus-ring" style={ringStyle} />}
              </div>
            )}

            {mode === "side-by-side" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    zoom === "fit" ? "repeat(auto-fit, minmax(220px, 1fr))" : "repeat(3, max-content)",
                  gap: "var(--spacing-lg)",
                }}
              >
                <Frame label="Captured" src={capturedUrl} zoom={zoom} naturalWidth={naturalWidth} ringStyle={ringStyle} regionBoxes={regionBoxes} {...hoverHandlers} />
                <Frame label="Reference" src={referenceUrl} zoom={zoom} naturalWidth={naturalWidth} ringStyle={ringStyle} regionBoxes={regionBoxes} {...hoverHandlers} />
                <Frame label="Diff Highlight" src={diffUrl} zoom={zoom} naturalWidth={naturalWidth} ringStyle={ringStyle} regionBoxes={regionBoxes} {...hoverHandlers} />
              </div>
            )}

            {mode === "slider" && (
              <CompareSlider
                referenceUrl={referenceUrl}
                capturedUrl={capturedUrl}
                zoom={zoom}
                naturalWidth={naturalWidth}
                position={sliderPosition}
              />
            )}

            {mode === "blink" && (
              <BlinkCompare
                referenceUrl={referenceUrl}
                capturedUrl={capturedUrl}
                zoom={zoom}
                naturalWidth={naturalWidth}
                which={blink.which}
              />
            )}

            {mode === "onion" &&
              (referenceUrl ? (
                <div style={stackWrapperStyle(zoom)}>
                  <img
                    src={referenceUrl}
                    alt="Reference"
                    crossOrigin="anonymous"
                    style={{ display: "block", ...imageSizeStyle(zoom, naturalWidth) }}
                  />
                  <img
                    src={capturedUrl}
                    alt="Captured"
                    crossOrigin="anonymous"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: onionOpacity }}
                  />
                </div>
              ) : (
                <p className="stage-note">Reference画像を読み込み中…</p>
              ))}

            {mode === "single" && (
              <Frame
                label={SINGLE_LABELS[singleView]}
                src={singleView === "reference" ? referenceUrl : singleView === "captured" ? capturedUrl : diffUrl}
                zoom={zoom}
                naturalWidth={naturalWidth}
                ringStyle={ringStyle}
                regionBoxes={regionBoxes}
                {...hoverHandlers}
              />
            )}
          </div>

          {mode === "diff" && (
            <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-md)", fontSize: 13, color: "var(--color-body)" }}>
              差分ハイライトの濃さ
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={diffOpacity}
                onChange={(e) => setDiffOpacity(Number(e.target.value))}
                style={{ flex: 1, maxWidth: 320 }}
              />
              <span className="num" style={{ minWidth: "4ch", textAlign: "right" }}>
                {(diffOpacity * 100).toFixed(0)}%
              </span>
            </label>
          )}

          {(mode === "diff" || mode === "side-by-side" || mode === "single") && (
            <>
              <PixelInspectorPanel
                hoverPixel={hoverPixel}
                capturedPixel={capturedPixel}
                referencePixel={referencePixel}
                canInspect={canInspect}
              />
              {clusters.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-md)", alignItems: "center", fontSize: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)", fontSize: 13 }}>
                    <input type="checkbox" checked={showAllRegions} onChange={(e) => setShowAllRegions(e.target.checked)} />
                    差分の領域をすべて囲む
                    <span className="num">
                      ({clusters.length}
                      {clusterResult && clusterResult.total > clusters.length ? ` / ${clusterResult.total}` : ""})
                    </span>
                  </label>
                  {!pinnedCluster && (
                    <span className="text-body-mid">
                      領域にカーソルを合わせるとリングが出ます。クリックで拡大表示を固定できます。
                    </span>
                  )}
                </div>
              )}
              {clusterResult && clusterResult.total > clusters.length && showAllRegions && (
                <p className="text-body-mid" style={{ margin: 0, fontSize: 12 }}>
                  領域が多いため、大きい順に上位 {clusters.length} 件だけ囲んでいます(全 {clusterResult.total} 件)。
                </p>
              )}
              {zoomPanel}
              {run.diff_pixel_count === 0 && (
                <EmptyState
                  art={<AsciiGarden mood="calm" />}
                  title="差分ゼロ — 虫のいない庭です"
                  description="撮影画像は基準画像とピクセル単位で一致しています。"
                />
              )}
            </>
          )}
        </div>

        <div style={{ flex: "0 0 260px", minWidth: 220, display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
          <ResultPanel run={run} regionCount={clusterResult ? clusterResult.total : null} />
          <ThresholdLab key={run.evaluation_result_id} run={run} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
        <p className="eyebrow">履歴タイムライン</p>
        <DotChart runs={runs} firstBadCommit={firstBadCommit} selectedRunId={run.evaluation_result_id} onSelectRun={onSelectRun} />
      </div>
    </section>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-sm)" }}>
      <span style={{ fontSize: 12, fontWeight: 600 }} className="text-body-mid">
        {label}
      </span>
      {children}
    </div>
  );
}
