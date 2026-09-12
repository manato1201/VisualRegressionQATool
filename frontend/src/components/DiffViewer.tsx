import { useEffect, useState } from "react";
import { api, describeApiError, imageUrl } from "../api";
import { clusterContains, findDiffClusters, type DiffCluster } from "../diffClusters";
import { loadPixelSampler, type PixelSampler } from "../pixelSampler";
import type { FirstBadCommit, RunRow } from "../types";
import { DotChart } from "./DotChart";
import { SplitFlapNumber } from "./SplitFlapNumber";
import { VerdictBadge } from "./VerdictBadge";

type Mode = "side-by-side" | "overlay" | "dot-history";

const MODES: { key: Mode; label: string }[] = [
  { key: "side-by-side", label: "サイドバイサイド" },
  { key: "overlay", label: "オーバーレイ" },
  { key: "dot-history", label: "ドットチャート履歴" },
];

interface Props {
  run: RunRow;
  runs: RunRow[];
  firstBadCommit: FirstBadCommit | null;
  onSelectRun: (run: RunRow) => void;
}

interface HoverPixel {
  x: number;
  y: number;
}

export function DiffViewer({ run, runs, firstBadCommit, onSelectRun }: Props) {
  const [mode, setMode] = useState<Mode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [referenceCapturedImageId, setReferenceCapturedImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [capturedSampler, setCapturedSampler] = useState<PixelSampler | null>(null);
  const [referenceSampler, setReferenceSampler] = useState<PixelSampler | null>(null);
  const [hoverPixel, setHoverPixel] = useState<HoverPixel | null>(null);
  const [clusters, setClusters] = useState<DiffCluster[]>([]);
  const [pinnedCluster, setPinnedCluster] = useState<DiffCluster | null>(null);

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
  const referenceUrl = referenceCapturedImageId ? imageUrl("captures", referenceCapturedImageId) : null;

  useEffect(() => {
    let cancelled = false;
    setCapturedSampler(null);
    setHoverPixel(null);
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

  // Feature 1 (focus ring): cluster the diff highlight image client-side --
  // no new backend API, per the design doc.
  useEffect(() => {
    let cancelled = false;
    setClusters([]);
    setPinnedCluster(null);
    findDiffClusters(diffUrl)
      .then((found) => {
        if (!cancelled) setClusters(found);
      })
      .catch(() => {
        if (!cancelled) setClusters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [diffUrl]);

  const inspectorSize = capturedSampler ?? referenceSampler;

  function handleHover(e: React.MouseEvent<HTMLImageElement>) {
    if (!inspectorSize) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const x = Math.min(inspectorSize.width - 1, Math.max(0, Math.floor(relX * inspectorSize.width)));
    const y = Math.min(inspectorSize.height - 1, Math.max(0, Math.floor(relY * inspectorSize.height)));
    setHoverPixel({ x, y });
  }

  const capturedPixel = hoverPixel && capturedSampler ? capturedSampler.sample(hoverPixel.x, hoverPixel.y) : null;
  const referencePixel = hoverPixel && referenceSampler ? referenceSampler.sample(hoverPixel.x, hoverPixel.y) : null;
  const canInspect = Boolean(inspectorSize) && (Boolean(capturedSampler) || Boolean(referenceSampler));

  // Focus ring only appears while hovering *inside* a detected cluster --
  // it stays hidden everywhere else, including when not hovering at all.
  const hoveredCluster =
    hoverPixel && clusters.length > 0 ? clusters.find((c) => clusterContains(c, hoverPixel.x, hoverPixel.y)) ?? null : null;
  const ringStyle: React.CSSProperties | null =
    hoveredCluster && inspectorSize
      ? {
          left: `${(hoveredCluster.minX / inspectorSize.width) * 100}%`,
          top: `${(hoveredCluster.minY / inspectorSize.height) * 100}%`,
          width: `${((hoveredCluster.maxX - hoveredCluster.minX + 1) / inspectorSize.width) * 100}%`,
          height: `${((hoveredCluster.maxY - hoveredCluster.minY + 1) / inspectorSize.height) * 100}%`,
        }
      : null;

  // Feature 1 follow-up: clicking inside a hovered cluster pins it, so the
  // zoomed crop below stays put once the cursor moves away to compare it
  // against the pixel inspector.
  function handleClickPin() {
    if (hoveredCluster) setPinnedCluster(hoveredCluster);
  }

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--spacing-md)" }}>
        <div>
          <p className="eyebrow">Diff Viewer</p>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>
            {run.build_version} <VerdictBadge verdict={run.verdict} />
          </h2>
        </div>
        <div className="segment-rail" role="tablist" aria-label="diff view mode">
          {MODES.map((m) => (
            <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--spacing-xl)", fontSize: 14 }} className="text-body-mid">
        <span>
          diff pixels: <SplitFlapNumber value={run.diff_pixel_count.toLocaleString()} />
        </span>
        <span>
          diff %: <SplitFlapNumber value={`${run.diff_percentage.toFixed(4)}%`} />
        </span>
        {clusters.length > 0 && <span>差分クラスタ: {clusters.length}件検出(カーソルを合わせるとリング表示、クリックで拡大表示を固定)</span>}
      </div>

      {error && <p style={{ color: "var(--color-fail)" }}>reference画像の解決に失敗しました: {error}</p>}

      {mode === "side-by-side" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--spacing-lg)" }}>
            <Frame label="Captured" src={capturedUrl} onHover={canInspect ? handleHover : undefined} onLeave={() => setHoverPixel(null)} onClick={handleClickPin} ringStyle={ringStyle} />
            <Frame label="Reference" src={referenceUrl} onHover={canInspect ? handleHover : undefined} onLeave={() => setHoverPixel(null)} onClick={handleClickPin} ringStyle={ringStyle} />
            <Frame label="Diff Highlight" src={diffUrl} onHover={canInspect ? handleHover : undefined} onLeave={() => setHoverPixel(null)} onClick={handleClickPin} ringStyle={ringStyle} />
          </div>
          <PixelInspectorPanel hoverPixel={hoverPixel} capturedPixel={capturedPixel} referencePixel={referencePixel} canInspect={canInspect} />
          {pinnedCluster && inspectorSize && (
            <ZoomPanel
              cluster={pinnedCluster}
              imageUrl={diffUrl}
              imageWidth={inspectorSize.width}
              imageHeight={inspectorSize.height}
              onClose={() => setPinnedCluster(null)}
            />
          )}
        </>
      ) : mode === "overlay" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
          <label style={{ fontSize: 14, color: "var(--color-body)" }}>
            Diffハイライト不透明度: {(overlayOpacity * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={overlayOpacity}
            onChange={(e) => setOverlayOpacity(Number(e.target.value))}
          />
          <div style={{ position: "relative", width: "100%", maxWidth: 720, borderRadius: "var(--rounded-md)", overflow: "hidden", border: "1px solid var(--color-mute)" }}>
            {referenceUrl && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img
                src={referenceUrl}
                alt="reference"
                crossOrigin="anonymous"
                style={{ display: "block", width: "100%", cursor: canInspect ? "crosshair" : undefined }}
                onMouseMove={canInspect ? handleHover : undefined}
                onMouseLeave={() => setHoverPixel(null)}
                onClick={handleClickPin}
              />
            )}
            <img
              src={diffUrl}
              alt="diff overlay"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: overlayOpacity, mixBlendMode: "normal", pointerEvents: "none" }}
            />
            {ringStyle && <div className="diff-focus-ring" style={ringStyle} />}
          </div>
          <PixelInspectorPanel hoverPixel={hoverPixel} capturedPixel={capturedPixel} referencePixel={referencePixel} canInspect={canInspect} />
          {pinnedCluster && inspectorSize && (
            <ZoomPanel
              cluster={pinnedCluster}
              imageUrl={diffUrl}
              imageWidth={inspectorSize.width}
              imageHeight={inspectorSize.height}
              onClose={() => setPinnedCluster(null)}
            />
          )}
        </div>
      ) : (
        <DotChart runs={runs} firstBadCommit={firstBadCommit} selectedRunId={run.evaluation_result_id} onSelectRun={onSelectRun} />
      )}
    </section>
  );
}

function Frame({
  label,
  src,
  onHover,
  onLeave,
  onClick,
  ringStyle,
}: {
  label: string;
  src: string | null;
  onHover?: (e: React.MouseEvent<HTMLImageElement>) => void;
  onLeave?: () => void;
  onClick?: () => void;
  ringStyle?: React.CSSProperties | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
      <span style={{ fontSize: 12, fontWeight: 600 }} className="text-body-mid">
        {label}
      </span>
      {src ? (
        <div style={{ position: "relative" }}>
          <img
            src={src}
            alt={label}
            crossOrigin="anonymous"
            style={{
              width: "100%",
              display: "block",
              borderRadius: "var(--rounded-sm)",
              border: "1px solid var(--color-mute)",
              cursor: onHover ? "crosshair" : undefined,
            }}
            onMouseMove={onHover}
            onMouseLeave={onLeave}
            onClick={onClick}
          />
          {ringStyle && <div className="diff-focus-ring" style={ringStyle} />}
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            aspectRatio: "4/3",
            borderRadius: "var(--rounded-sm)",
            border: "1px dashed var(--color-mute)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="text-body-mid"
        >
          読み込み中…
        </div>
      )}
    </div>
  );
}

const ZOOM_VIEW_SIZE = 220;
const ZOOM_PADDING_FACTOR = 3;
const ZOOM_MIN_WINDOW_PX = 12;

/** Feature 1 follow-up: renders a pixelated CSS-background crop of the diff
 * image centered on a pinned cluster, scaled so the cluster (plus some
 * padding) fills the view -- lets a tiny regression be inspected without
 * leaving the page or opening the raw image at full resolution. */
function ZoomPanel({
  cluster,
  imageUrl,
  imageWidth,
  imageHeight,
  onClose,
}: {
  cluster: DiffCluster;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onClose: () => void;
}) {
  const clusterWidth = cluster.maxX - cluster.minX + 1;
  const clusterHeight = cluster.maxY - cluster.minY + 1;
  const windowSize = Math.max(clusterWidth, clusterHeight, ZOOM_MIN_WINDOW_PX) * ZOOM_PADDING_FACTOR;
  const scale = ZOOM_VIEW_SIZE / windowSize;
  const centerX = (cluster.minX + cluster.maxX + 1) / 2;
  const centerY = (cluster.minY + cluster.maxY + 1) / 2;

  return (
    <div className="card-outline" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)", padding: "var(--spacing-md)", alignSelf: "flex-start" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--spacing-md)" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }} className="text-body-mid">
          拡大表示({cluster.pixelCount.toLocaleString()}px)
        </span>
        <button className="btn btn-sm btn-tertiary" onClick={onClose}>
          閉じる
        </button>
      </div>
      <div
        style={{
          width: ZOOM_VIEW_SIZE,
          height: ZOOM_VIEW_SIZE,
          borderRadius: "var(--rounded-sm)",
          border: "1px solid var(--color-mute)",
          backgroundImage: `url(${imageUrl})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${imageWidth * scale}px ${imageHeight * scale}px`,
          backgroundPosition: `${-(centerX * scale - ZOOM_VIEW_SIZE / 2)}px ${-(centerY * scale - ZOOM_VIEW_SIZE / 2)}px`,
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}

function swatch(pixel: [number, number, number, number]): string {
  return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
}

function PixelInspectorPanel({
  hoverPixel,
  capturedPixel,
  referencePixel,
  canInspect,
}: {
  hoverPixel: HoverPixel | null;
  capturedPixel: [number, number, number, number] | null;
  referencePixel: [number, number, number, number] | null;
  canInspect: boolean;
}) {
  if (!canInspect) return null;

  if (!hoverPixel || (!capturedPixel && !referencePixel)) {
    return (
      <p style={{ fontSize: 12 }} className="text-mute">
        画像にカーソルを合わせるとピクセル単位のRGB値・差分を確認できます。
      </p>
    );
  }

  const delta =
    capturedPixel && referencePixel
      ? ([
          capturedPixel[0] - referencePixel[0],
          capturedPixel[1] - referencePixel[1],
          capturedPixel[2] - referencePixel[2],
        ] as const)
      : null;
  const maxAbsDelta = delta ? Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2])) : null;

  return (
    <div
      className="card-outline"
      style={{
        display: "flex",
        gap: "var(--spacing-xl)",
        flexWrap: "wrap",
        alignItems: "center",
        padding: "var(--spacing-md) var(--spacing-lg)",
        fontSize: 13,
      }}
    >
      <span className="text-body-mid">
        座標: <code>({hoverPixel.x}, {hoverPixel.y})</code>
      </span>

      {capturedPixel && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: swatch(capturedPixel), border: "1px solid var(--color-mute)", display: "inline-block" }} />
          Captured: rgb({capturedPixel[0]}, {capturedPixel[1]}, {capturedPixel[2]})
        </span>
      )}

      {referencePixel && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: swatch(referencePixel), border: "1px solid var(--color-mute)", display: "inline-block" }} />
          Reference: rgb({referencePixel[0]}, {referencePixel[1]}, {referencePixel[2]})
        </span>
      )}

      {delta && maxAbsDelta !== null && (
        <span style={{ fontWeight: 600, color: maxAbsDelta > 0 ? "var(--color-fail)" : "var(--color-pass)" }}>
          差分: ΔR {delta[0] >= 0 ? "+" : ""}{delta[0]} / ΔG {delta[1] >= 0 ? "+" : ""}{delta[1]} / ΔB {delta[2] >= 0 ? "+" : ""}{delta[2]}(最大 {maxAbsDelta})
        </span>
      )}
    </div>
  );
}
