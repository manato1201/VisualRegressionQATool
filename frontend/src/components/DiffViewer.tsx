import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { api, describeApiError, imageUrl } from "../api";
import {
  clusterContains,
  findDiffClusters,
  type DiffClusterResult,
} from "../diffClusters";
import { loadPixelSampler, type PixelSampler } from "../pixelSampler";
import type { FirstBadCommit, RunRow } from "../types";
import { DotChart } from "./DotChart";
import { SegmentedControl } from "./SegmentedControl";
import { VerdictBadge } from "./VerdictBadge";
import { BlinkCompare, BlinkControls, useBlink } from "./diffviewer/BlinkCompare";
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
import { ZoomPanel } from "./diffviewer/ZoomPanel";

type Mode = "diff" | "side-by-side" | "slider" | "blink";

const MODE_OPTIONS = [
  { key: "diff", label: "差分" },
  { key: "side-by-side", label: "並べて" },
  { key: "slider", label: "スライダー" },
  { key: "blink", label: "点滅" },
] as const;

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
  const blink = useBlink(mode === "blink");
  const [referenceCapturedImageId, setReferenceCapturedImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [capturedSampler, setCapturedSampler] = useState<PixelSampler | null>(null);
  const [referenceSampler, setReferenceSampler] = useState<PixelSampler | null>(null);
  const [hoverRel, setHoverRel] = useState<HoverRel | null>(null);
  const [clusterResult, setClusterResult] = useState<DiffClusterResult | null>(null);
  const [pinnedClusterIndex, setPinnedClusterIndex] = useState<number | null>(null);

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
    hoveredCluster && diffSize
      ? {
          left: `${(hoveredCluster.minX / diffSize.width) * 100}%`,
          top: `${(hoveredCluster.minY / diffSize.height) * 100}%`,
          width: `${((hoveredCluster.maxX - hoveredCluster.minX + 1) / diffSize.width) * 100}%`,
          height: `${((hoveredCluster.maxY - hoveredCluster.minY + 1) / diffSize.height) * 100}%`,
        }
      : null;

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
      <div>
        <p className="eyebrow">Diff Viewer</p>
        <h2 style={{ fontSize: 24, marginTop: 4, display: "flex", alignItems: "center", gap: "var(--spacing-md)", flexWrap: "wrap" }}>
          {run.build_version} <VerdictBadge verdict={run.verdict} />
        </h2>
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

      {error && <p style={{ color: "var(--color-fail)" }}>reference画像の解決に失敗しました: {error}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-lg)", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
          {mode === "slider" && <SliderControls position={sliderPosition} onChange={setSliderPosition} />}
          {mode === "blink" && <BlinkControls {...blink} />}
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
                <Frame label="Captured" src={capturedUrl} zoom={zoom} naturalWidth={naturalWidth} ringStyle={ringStyle} {...hoverHandlers} />
                <Frame label="Reference" src={referenceUrl} zoom={zoom} naturalWidth={naturalWidth} ringStyle={ringStyle} {...hoverHandlers} />
                <Frame label="Diff Highlight" src={diffUrl} zoom={zoom} naturalWidth={naturalWidth} ringStyle={ringStyle} {...hoverHandlers} />
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

          {(mode === "diff" || mode === "side-by-side") && (
            <>
              <PixelInspectorPanel
                hoverPixel={hoverPixel}
                capturedPixel={capturedPixel}
                referencePixel={referencePixel}
                canInspect={canInspect}
              />
              {clusters.length > 0 && !pinnedCluster && (
                <p style={{ fontSize: 12, margin: 0 }} className="text-body-mid">
                  差分の領域にカーソルを合わせるとリングが出ます。クリックで拡大表示を固定できます。
                </p>
              )}
              {zoomPanel}
            </>
          )}
        </div>

        <div style={{ flex: "0 0 260px", minWidth: 220 }}>
          <ResultPanel run={run} regionCount={clusterResult ? clusterResult.total : null} />
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
