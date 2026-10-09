export type Rgba = [number, number, number, number];

export interface HoverPixel {
  x: number;
  y: number;
}

function swatch(pixel: Rgba): string {
  return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

interface Props {
  hoverPixel: HoverPixel | null;
  capturedPixel: Rgba | null;
  referencePixel: Rgba | null;
  canInspect: boolean;
}

export function PixelInspectorPanel({
  hoverPixel,
  capturedPixel,
  referencePixel,
  canInspect,
}: Props) {
  if (!canInspect) return null;

  if (!hoverPixel || (!capturedPixel && !referencePixel)) {
    return (
      <p style={{ fontSize: 12 }} className="text-body-mid">
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
  const maxAbsDelta = delta
    ? Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2]))
    : null;

  return (
    <div
      className="card-outline num"
      style={{
        display: "flex",
        gap: "var(--spacing-xl)",
        flexWrap: "wrap",
        alignItems: "center",
        padding: "var(--spacing-md) var(--spacing-lg)",
        fontSize: 13,
      }}
    >
      <span>
        座標: ({hoverPixel.x}, {hoverPixel.y})
      </span>

      {capturedPixel && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: swatch(capturedPixel),
              border: "1px solid var(--color-mute)",
              display: "inline-block",
            }}
          />
          Captured: rgb({capturedPixel[0]}, {capturedPixel[1]}, {capturedPixel[2]})
        </span>
      )}

      {referencePixel && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: swatch(referencePixel),
              border: "1px solid var(--color-mute)",
              display: "inline-block",
            }}
          />
          Reference: rgb({referencePixel[0]}, {referencePixel[1]}, {referencePixel[2]})
        </span>
      )}

      {delta && maxAbsDelta !== null && (
        <span
          style={{
            fontWeight: 600,
            color: maxAbsDelta > 0 ? "var(--color-fail)" : "var(--color-pass)",
          }}
        >
          {maxAbsDelta > 0 ? "✕ 差分" : "✓ 一致"}: ΔR {signed(delta[0])} / ΔG{" "}
          {signed(delta[1])} / ΔB {signed(delta[2])}(最大 {maxAbsDelta})
        </span>
      )}
    </div>
  );
}
