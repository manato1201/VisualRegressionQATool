import { useState } from "react";

export interface DiffSettingsValue {
  perPixelTolerance: number;
  maxDiffPixels: number;
  minDiffRegionPixels: number;
}

export const DEFAULT_DIFF_SETTINGS: DiffSettingsValue = {
  perPixelTolerance: 0,
  maxDiffPixels: 0,
  minDiffRegionPixels: 1,
};

interface Props {
  value: DiffSettingsValue;
  onChange: (value: DiffSettingsValue) => void;
}

export function DiffSettings({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  function update(patch: Partial<DiffSettingsValue>) {
    onChange({ ...value, ...patch });
  }

  const isDefault =
    value.perPixelTolerance === DEFAULT_DIFF_SETTINGS.perPixelTolerance &&
    value.maxDiffPixels === DEFAULT_DIFF_SETTINGS.maxDiffPixels &&
    value.minDiffRegionPixels === DEFAULT_DIFF_SETTINGS.minDiffRegionPixels;

  return (
    <div className="card-outline" style={{ padding: "var(--spacing-md) var(--spacing-lg)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn btn-sm"
        style={{ padding: 0, background: "transparent" }}
      >
        {open ? "▾" : "▸"} 差分の詳細設定{!isDefault && "(カスタム設定中)"}
      </button>

      {open && (
        <div style={{ display: "flex", gap: "var(--spacing-xl)", flexWrap: "wrap", marginTop: "var(--spacing-md)" }}>
          <Field
            label="許容誤差 (0-255)"
            hint="RGB各チャンネルの差がこの値以下ならノイズとして無視します。JPEG等の再圧縮由来の微小な色ズレを吸収したい場合に上げてください。"
            value={value.perPixelTolerance}
            min={0}
            max={255}
            onChange={(v) => update({ perPixelTolerance: v })}
          />
          <Field
            label="許容差分ピクセル数"
            hint="この件数以下の差分ピクセルはPassとみなします。"
            value={value.maxDiffPixels}
            min={0}
            onChange={(v) => update({ maxDiffPixels: v })}
          />
          <Field
            label="最小差分領域サイズ (ノイズ除去)"
            hint="この画素数未満の孤立した差分の塊は無視します。散らばった圧縮ノイズを除去しつつ、まとまった本物の変化(間違い探しのような局所的な差分)だけを検出したい場合に上げてください。1=フィルタなし。"
            value={value.minDiffRegionPixels}
            min={1}
            onChange={(v) => update({ minDiffRegionPixels: v })}
          />
          <button className="btn btn-tertiary btn-sm" onClick={() => onChange(DEFAULT_DIFF_SETTINGS)} style={{ alignSelf: "end" }}>
            初期値に戻す
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 220 }}>
      <label style={{ fontSize: 13, color: "var(--color-body)" }} title={hint}>
        {label}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(min, n) : min);
        }}
      />
      <span style={{ fontSize: 11 }} className="text-mute">
        {hint}
      </span>
    </div>
  );
}
