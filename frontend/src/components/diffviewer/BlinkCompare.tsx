import { SegmentedControl } from "../SegmentedControl";
import { imageSizeStyle, stackWrapperStyle, type ZoomMode } from "./shared";
import { BLINK_WHICH_OPTIONS, type BlinkState, type BlinkWhich } from "./useBlink";

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
          options={BLINK_WHICH_OPTIONS}
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
        crossOrigin="use-credentials"
        style={{ display: "block", ...imageSizeStyle(zoom, naturalWidth) }}
      />
      <img
        src={capturedUrl}
        alt="Captured"
        crossOrigin="use-credentials"
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
