import type { CSSProperties } from "react";

export type StageBackground = "white" | "black" | "checker";
export type ZoomMode = "fit" | "actual";

export const BACKGROUND_OPTIONS = [
  { key: "white", label: "白" },
  { key: "black", label: "黒" },
  { key: "checker", label: "市松" },
] as const;

export const ZOOM_OPTIONS = [
  { key: "fit", label: "フィット" },
  { key: "actual", label: "100%" },
] as const;

/** Width rules for an image on the stage: stretch to the stage ("fit") or
 * show at its true pixel size ("actual", the stage then scrolls). */
export function imageSizeStyle(
  zoom: ZoomMode,
  naturalWidth: number,
): CSSProperties {
  return zoom === "fit"
    ? { width: "100%" }
    : { width: naturalWidth, maxWidth: "none" };
}

/** The positioned wrapper around an image (or image stack): full width when
 * fitting, exactly image-sized when actual, so percentage-positioned overlays
 * (focus ring, slider divider) line up with the pixels. */
export function stackWrapperStyle(zoom: ZoomMode): CSSProperties {
  return {
    position: "relative",
    width: zoom === "fit" ? "100%" : "fit-content",
    lineHeight: 0,
  };
}
