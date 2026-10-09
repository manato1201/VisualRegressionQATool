import { imageSizeStyle, stackWrapperStyle, type ZoomMode } from "./shared";

interface ControlsProps {
  position: number;
  onChange: (position: number) => void;
}

/** The divider control, rendered above the stage (not inside it) so its text
 * is always drawn on the page background, never on a white/black stage. */
export function SliderControls({ position, onChange }: ControlsProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-md)",
        fontSize: 13,
        color: "var(--color-body)",
      }}
    >
      <span>Reference</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={position}
        aria-label="基準画像と撮影画像の境界位置"
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span>Captured</span>
      <span className="num" style={{ minWidth: "4ch", textAlign: "right" }}>
        {position}%
      </span>
    </label>
  );
}

interface Props {
  referenceUrl: string | null;
  capturedUrl: string;
  zoom: ZoomMode;
  naturalWidth: number;
  /** Divider position, 0-100: Reference on its left, Captured on its right. */
  position: number;
}

export function CompareSlider({
  referenceUrl,
  capturedUrl,
  zoom,
  naturalWidth,
  position,
}: Props) {
  if (!referenceUrl) {
    return <p className="stage-note">Reference画像を読み込み中…</p>;
  }

  return (
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
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          clipPath: `inset(0 0 0 ${position}%)`,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${position}%`,
          width: 2,
          transform: "translateX(-1px)",
          background: "var(--color-primary)",
        }}
      />
    </div>
  );
}
