import { useEffect, useState } from "react";
import { api, describeApiError, imageUrl } from "../api";
import { loadPixelSampler, type PixelSampler } from "../pixelSampler";
import type { RunRow } from "../types";
import { VerdictBadge } from "./VerdictBadge";

type Mode = "side-by-side" | "overlay";

interface Props {
  run: RunRow;
}

interface HoverPixel {
  x: number;
  y: number;
}

export function DiffViewer({ run }: Props) {
  const [mode, setMode] = useState<Mode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [referenceCapturedImageId, setReferenceCapturedImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [capturedSampler, setCapturedSampler] = useState<PixelSampler | null>(null);
  const [referenceSampler, setReferenceSampler] = useState<PixelSampler | null>(null);
  const [hoverPixel, setHoverPixel] = useState<HoverPixel | null>(null);

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

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--spacing-md)" }}>
        <div>
          <p className="eyebrow">Diff Viewer</p>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>
            {run.build_version} <VerdictBadge verdict={run.verdict} />
          </h2>
        </div>
        <div style={{ display: "flex", gap: "var(--spacing-xs)" }}>
          <button className={`btn btn-sm ${mode === "side-by-side" ? "btn-secondary" : "btn-tertiary"}`} onClick={() => setMode("side-by-side")}>
            サイドバイサイド
          </button>
          <button className={`btn btn-sm ${mode === "overlay" ? "btn-secondary" : "btn-tertiary"}`} onClick={() => setMode("overlay")}>
            オーバーレイ
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--spacing-xl)", fontSize: 14 }} className="text-body-mid">
        <span>diff pixels: {run.diff_pixel_count.toLocaleString()}</span>
        <span>diff %: {run.diff_percentage.toFixed(4)}%</span>
      </div>

      {error && <p style={{ color: "var(--color-fail)" }}>reference画像の解決に失敗しました: {error}</p>}

      {mode === "side-by-side" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--spacing-lg)" }}>
            <Frame label="Captured" src={capturedUrl} onHover={canInspect ? handleHover : undefined} onLeave={() => setHoverPixel(null)} />
            <Frame label="Reference" src={referenceUrl} onHover={canInspect ? handleHover : undefined} onLeave={() => setHoverPixel(null)} />
            <Frame label="Diff Highlight" src={diffUrl} onHover={canInspect ? handleHover : undefined} onLeave={() => setHoverPixel(null)} />
          </div>
          <PixelInspectorPanel hoverPixel={hoverPixel} capturedPixel={capturedPixel} referencePixel={referencePixel} canInspect={canInspect} />
        </>
      ) : (
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
              />
            )}
            <img
              src={diffUrl}
              alt="diff overlay"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: overlayOpacity, mixBlendMode: "normal", pointerEvents: "none" }}
            />
          </div>
          <PixelInspectorPanel hoverPixel={hoverPixel} capturedPixel={capturedPixel} referencePixel={referencePixel} canInspect={canInspect} />
        </div>
      )}
    </section>
  );
}

function Frame({
  label,
  src,
  onHover,
  onLeave,
}: {
  label: string;
  src: string | null;
  onHover?: (e: React.MouseEvent<HTMLImageElement>) => void;
  onLeave?: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xs)" }}>
      <span style={{ fontSize: 12, fontWeight: 600 }} className="text-body-mid">
        {label}
      </span>
      {src ? (
        <img
          src={src}
          alt={label}
          crossOrigin="anonymous"
          style={{
            width: "100%",
            borderRadius: "var(--rounded-sm)",
            border: "1px solid var(--color-mute)",
            cursor: onHover ? "crosshair" : undefined,
          }}
          onMouseMove={onHover}
          onMouseLeave={onLeave}
        />
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
