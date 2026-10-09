import { useEffect, useState } from "react";
import { SegmentedControl } from "../SegmentedControl";
import { imageSizeStyle, stackWrapperStyle, type ZoomMode } from "./shared";

/** Half-period of the flicker. A full Reference -> Captured -> Reference cycle
 * takes 2 x 800 ms = 1.6 s (0.625 Hz), safely under the 1 Hz ceiling that
 * photosensitivity guidance asks for. */
export const BLINK_INTERVAL_MS = 800;

const WHICH_OPTIONS = [
  { key: "reference", label: "Reference" },
  { key: "captured", label: "Captured" },
] as const;

export type BlinkWhich = (typeof WHICH_OPTIONS)[number]["key"];

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface BlinkState {
  which: BlinkWhich;
  setWhich: (which: BlinkWhich) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
}

/** Blink state lives in the parent so the controls can sit above the stage
 * while the image stack sits inside it. Only ticks while `active`, so leaving
 * the blink mode never leaves a timer running. Starts stopped for people who
 * ask the OS for reduced motion. */
export function useBlink(active: boolean): BlinkState {
  const [which, setWhich] = useState<BlinkWhich>("reference");
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    if (!active || !playing) return;
    const id = window.setInterval(
      () => setWhich((w) => (w === "reference" ? "captured" : "reference")),
      BLINK_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [active, playing]);

  return { which, setWhich, playing, setPlaying };
}

/** Start/stop plus, when stopped, a manual pick. The visible image is named in
 * text so the mode never relies on noticing the flip. */
export function BlinkControls({ which, setWhich, playing, setPlaying }: BlinkState) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-md)",
        flexWrap: "wrap",
        fontSize: 13,
      }}
    >
      <button
        type="button"
        className="btn btn-tertiary btn-sm"
        aria-pressed={playing}
        onClick={() => setPlaying(!playing)}
      >
        {playing ? "■ 停止" : "▶ 点滅を開始"}
      </button>
      {playing ? (
        <span className="text-body-mid">
          約0.6Hz で切替中 — 表示中:{" "}
          <strong>{which === "reference" ? "Reference" : "Captured"}</strong>
        </span>
      ) : (
        <SegmentedControl
          label="表示する画像"
          options={WHICH_OPTIONS}
          value={which}
          onChange={setWhich}
        />
      )}
    </div>
  );
}

interface Props {
  referenceUrl: string | null;
  capturedUrl: string;
  zoom: ZoomMode;
  naturalWidth: number;
  which: BlinkWhich;
}

export function BlinkCompare({
  referenceUrl,
  capturedUrl,
  zoom,
  naturalWidth,
  which,
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
          visibility: which === "captured" ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
