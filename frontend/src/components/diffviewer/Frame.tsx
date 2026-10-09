import type { CSSProperties, MouseEvent } from "react";
import { imageSizeStyle, stackWrapperStyle, type ZoomMode } from "./shared";

interface Props {
  label: string;
  src: string | null;
  zoom: ZoomMode;
  naturalWidth: number;
  onHover?: (e: MouseEvent<HTMLImageElement>) => void;
  onLeave?: () => void;
  onClick?: () => void;
  ringStyle?: CSSProperties | null;
}

/** One labelled image in the side-by-side grid. The focus ring is a
 * percentage-positioned overlay on the image wrapper, so the same ring style
 * lines up on all three frames. */
export function Frame({
  label,
  src,
  zoom,
  naturalWidth,
  onHover,
  onLeave,
  onClick,
  ringStyle,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-xs)",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600 }} className="text-body-mid">
        {label}
      </span>
      {src ? (
        <div style={stackWrapperStyle(zoom)}>
          <img
            src={src}
            alt={label}
            crossOrigin="anonymous"
            style={{
              display: "block",
              ...imageSizeStyle(zoom, naturalWidth),
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
