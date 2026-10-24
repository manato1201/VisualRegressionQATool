import { useEffect, useState } from "react";
import { api, describeApiError } from "../../api";
import { formatCount, formatPercent } from "../../format";
import type { DiffPreviewResult, RunRow, Verdict } from "../../types";
import { VerdictBadge } from "../VerdictBadge";

const DEBOUNCE_MS = 250;
const MAX_TOLERANCE = 64;
const MAX_MIN_REGION = 200;

const VERDICT_WORD: Record<Verdict, string> = {
  pass: "✓ 合格",
  fail: "✕ 不合格",
  flaky: "△ 不安定",
};

interface Props {
  run: RunRow;
}

/** Threshold lab: move the tolerances and see how the verdict *would* change.
 *
 * It only ever asks the preview endpoint, which records nothing -- the saved
 * verdict, the stored thresholds and the alert state are untouched, and this
 * panel says so. Making a different setting count is a separate, deliberate
 * step (change it in 差分の詳細設定 and run the diff). It starts from the
 * thresholds the saved result was judged with, so "no change" is the default. */
export function ThresholdLab({ run }: Props) {
  const totalPixels = run.resolution_width * run.resolution_height;
  const saved = {
    perPixelTolerance: run.per_pixel_tolerance ?? 0,
    maxDiffPixels: run.max_diff_pixels ?? 0,
    minDiffRegionPixels: 1,
    allowCenterCrop: false,
  };

  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(saved);
  const [preview, setPreview] = useState<DiffPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounced, cancellable preview. Only runs while the panel is open, so a
  // closed lab costs nothing.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .previewDiff(
          run.captured_image_id,
          { ...settings, referenceImageId: run.reference_image_id },
          controller.signal,
        )
        .then((result) => {
          setPreview(result);
          setError(null);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setPreview(null);
          setError(describeApiError(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, settings, run.captured_image_id, run.reference_image_id]);

  const unchanged =
    settings.perPixelTolerance === saved.perPixelTolerance &&
    settings.maxDiffPixels === saved.maxDiffPixels &&
    settings.minDiffRegionPixels === saved.minDiffRegionPixels &&
    settings.allowCenterCrop === saved.allowCenterCrop;

  function patch(update: Partial<typeof settings>) {
    setSettings((prev) => ({ ...prev, ...update }));
  }

  return (
    <details
      className="card-outline"
      style={{ padding: "var(--spacing-md) var(--spacing-lg)" }}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>しきい値ラボ(プレビュー)</summary>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)", marginTop: "var(--spacing-md)", fontSize: 13 }}>
        <p className="text-body-mid" style={{ margin: 0 }}>
          設定を動かすと、この結果が<strong>もしその設定で判定されていたら</strong>どうなるかを表示します。
          <strong>保存済みの判定は変わりません。</strong>
        </p>

        <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            許容誤差(1画素・1チャンネル){" "}
            <span className="num">{settings.perPixelTolerance}</span>
          </span>
          <input
            type="range"
            min={0}
            max={MAX_TOLERANCE}
            step={1}
            value={settings.perPixelTolerance}
            onChange={(e) => patch({ perPixelTolerance: Number(e.target.value) })}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>許容する差分ピクセル数(max_diff_pixels)</span>
          <input
            type="number"
            min={0}
            max={totalPixels}
            value={settings.maxDiffPixels}
            onChange={(e) =>
              patch({ maxDiffPixels: Math.min(totalPixels, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
            }
            style={{ padding: "var(--spacing-xs) var(--spacing-md)", fontSize: 14 }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            最小差分領域サイズ <span className="num">{settings.minDiffRegionPixels}</span> px
          </span>
          <input
            type="range"
            min={1}
            max={MAX_MIN_REGION}
            step={1}
            value={settings.minDiffRegionPixels}
            onChange={(e) => patch({ minDiffRegionPixels: Number(e.target.value) })}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-sm)" }}>
          <input
            type="checkbox"
            checked={settings.allowCenterCrop}
            onChange={(e) => patch({ allowCenterCrop: e.target.checked })}
          />
          解像度の不一致を中央クロップで許容する
        </label>

        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "var(--spacing-md)",
            borderRadius: "var(--rounded-sm)",
            background: "var(--color-canvas-soft)",
            border: "1px dashed var(--color-mute)",
          }}
        >
          <span className="text-body-mid" style={{ fontSize: 12 }}>
            プレビュー — 保存されません{loading ? "(計算中…)" : ""}
          </span>
          {error && <span style={{ color: "var(--color-fail)" }}>{error}</span>}
          {preview && !error && (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--spacing-sm)" }}>
                <VerdictBadge verdict={preview.verdict} />
                <span className="num">
                  {formatPercent(preview.diff_percentage)} · {formatCount(preview.diff_pixel_count)} px
                </span>
              </span>
              <span>{comparison(run.verdict, preview.verdict, unchanged)}</span>
              {preview.resolution_note && <span className="text-body-mid">{preview.resolution_note}</span>}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: "var(--spacing-sm)", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-tertiary btn-sm" disabled={unchanged} onClick={() => setSettings(saved)}>
            保存時の設定に戻す
          </button>
          <span className="text-body-mid" style={{ fontSize: 12 }}>
            反映するには「差分の詳細設定」を変えて差分実行
          </span>
        </div>
      </div>
    </details>
  );
}

function comparison(saved: Verdict, previewed: "pass" | "fail", unchanged: boolean): string {
  if (saved === "flaky") {
    return `保存済みは「${VERDICT_WORD.flaky}」(同じビルドの履歴で判定が割れたため)。この設定の単独判定は上のとおりです。`;
  }
  if (saved === previewed) {
    return unchanged
      ? "保存済みの判定と同じです(保存時の設定)。"
      : `この設定でも、保存済みの「${VERDICT_WORD[saved]}」のままです。`;
  }
  return `この設定なら、保存済みの「${VERDICT_WORD[saved]}」が「${VERDICT_WORD[previewed]}」になります。`;
}
