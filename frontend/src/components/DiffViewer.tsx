import { useEffect, useState } from "react";
import { api, describeApiError, imageUrl } from "../api";
import type { RunRow } from "../types";
import { VerdictBadge } from "./VerdictBadge";

type Mode = "side-by-side" | "overlay";

interface Props {
  run: RunRow;
}

export function DiffViewer({ run }: Props) {
  const [mode, setMode] = useState<Mode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [referenceCapturedImageId, setReferenceCapturedImageId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-lg)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--spacing-md)",
        }}
      >
        <div>
          <p className="eyebrow">Diff Viewer</p>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>
            {run.build_version} <VerdictBadge verdict={run.verdict} />
          </h2>
        </div>
        <div style={{ display: "flex", gap: "var(--spacing-xs)" }}>
          <button
            className={`btn btn-sm ${mode === "side-by-side" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setMode("side-by-side")}
          >
            サイドバイサイド
          </button>
          <button
            className={`btn btn-sm ${mode === "overlay" ? "btn-secondary" : "btn-tertiary"}`}
            onClick={() => setMode("overlay")}
          >
            オーバーレイ
          </button>
        </div>
      </div>

      <div
        style={{ display: "flex", gap: "var(--spacing-xl)", fontSize: 14 }}
        className="text-body-mid"
      >
        <span>diff pixels: {run.diff_pixel_count.toLocaleString()}</span>
        <span>diff %: {run.diff_percentage.toFixed(4)}%</span>
      </div>

      {error && (
        <p style={{ color: "var(--color-fail)" }}>
          reference画像の解決に失敗しました: {error}
        </p>
      )}

      {mode === "side-by-side" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "var(--spacing-lg)",
          }}
        >
          <Frame label="Captured" src={capturedUrl} />
          <Frame label="Reference" src={referenceUrl} />
          <Frame label="Diff Highlight" src={diffUrl} />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-md)",
          }}
        >
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
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 720,
              borderRadius: "var(--rounded-md)",
              overflow: "hidden",
              border: "1px solid var(--color-mute)",
            }}
          >
            {referenceUrl && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img
                src={referenceUrl}
                alt="reference"
                style={{ display: "block", width: "100%" }}
              />
            )}
            <img
              src={diffUrl}
              alt="diff overlay"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                opacity: overlayOpacity,
                mixBlendMode: "normal",
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Frame({ label, src }: { label: string; src: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-xs)",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600 }} className="text-body-mid">
        {label}
      </span>
      {src ? (
        <img
          src={src}
          alt={label}
          style={{
            width: "100%",
            borderRadius: "var(--rounded-sm)",
            border: "1px solid var(--color-mute)",
          }}
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
