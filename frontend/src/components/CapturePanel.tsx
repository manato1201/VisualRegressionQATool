import { useState } from "react";
import { imageUrl } from "../api";
import type { CapturedImage, ReferenceImage } from "../types";
import type { DiffSettingsValue } from "../diffSettingsValue";
import { DiffSettings } from "./DiffSettings";
import { EmptyState } from "./EmptyState";
import { needTitle, useCan } from "../role";

interface Props {
  capturedImages: CapturedImage[];
  activeReference: ReferenceImage | null;
  diffSettings: DiffSettingsValue;
  onDiffSettingsChange: (value: DiffSettingsValue) => void;
  onUpload: (buildVersion: string, file: File) => Promise<void>;
  onPromote: (capturedImageId: string) => Promise<void>;
  onRunDiff: (capturedImageId: string) => Promise<void>;
  onRunDiffBatch: (capturedImageIds: string[]) => Promise<void>;
  onDelete: (capturedImageId: string) => Promise<void>;
  busyCapturedImageId: string | null;
  batchBusy: boolean;
}

export function CapturePanel({
  capturedImages,
  activeReference,
  diffSettings,
  onDiffSettingsChange,
  onUpload,
  onPromote,
  onRunDiff,
  onRunDiffBatch,
  onDelete,
  busyCapturedImageId,
  batchBusy,
}: Props) {
  const [buildVersion, setBuildVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !buildVersion.trim()) return;
    setUploading(true);
    try {
      await onUpload(buildVersion.trim(), file);
      setBuildVersion("");
      setFile(null);
    } finally {
      setUploading(false);
    }
  }

  function handleDelete(img: CapturedImage) {
    if (!window.confirm(`「${img.build_version}」を削除しますか?この操作は取り消せません。`)) return;
    onDelete(img.captured_image_id);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const can = useCan();
  const canOperate = can("operator");
  const canAdmin = can("admin");

  async function handleBatchRun() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await onRunDiffBatch(ids);
    setSelected(new Set());
  }

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
      <div>
        <p className="eyebrow">Captured Images</p>
        <h2 style={{ fontSize: 24, marginTop: 4 }}>撮影画像</h2>
      </div>

      <form onSubmit={handleUpload} style={{ display: "flex", gap: "var(--spacing-md)", alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 14, color: "var(--color-body)" }}>build version</label>
          <input type="text" placeholder="git-sha or build#" value={buildVersion} onChange={(e) => setBuildVersion(e.target.value)} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 14, color: "var(--color-body)" }}>image file</label>
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!canOperate || uploading || !file || !buildVersion.trim()} title={needTitle(canOperate, "operator")}>
          {uploading ? "アップロード中…" : "アップロード"}
        </button>
      </form>

      <DiffSettings value={diffSettings} onChange={onDiffSettingsChange} />

      {capturedImages.length > 0 && (
        <div
          className="card-outline"
          style={{ padding: "var(--spacing-md) var(--spacing-lg)", display: "flex", gap: "var(--spacing-md)", alignItems: "center", flexWrap: "wrap" }}
        >
          <span style={{ fontSize: 14 }} className="text-body-mid">
            {selected.size}件選択中
          </span>
          <button className="btn btn-tertiary btn-sm" onClick={() => setSelected(new Set(capturedImages.map((i) => i.captured_image_id)))}>
            すべて選択
          </button>
          <button className="btn btn-tertiary btn-sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            選択解除
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!canOperate || selected.size === 0 || !activeReference || batchBusy} onClick={handleBatchRun} title={needTitle(canOperate, "operator")}>
            {batchBusy ? "一括実行中…" : `選択した画像をまとめて差分実行 (${selected.size})`}
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--spacing-md)" }}>
        {capturedImages.length === 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <EmptyState
              title="まだ撮影画像がありません"
              description="画像をアップロードすると、ここにカードが並びます。"
              steps={["build versionを入力する", "画像ファイル(PNG/JPEG)を選んで「アップロード」を押す"]}
            />
          </div>
        )}
        {capturedImages.map((img) => {
          const isReference = activeReference?.captured_image_id === img.captured_image_id;
          const busy = busyCapturedImageId === img.captured_image_id || batchBusy;
          const isSelected = selected.has(img.captured_image_id);
          return (
            <div
              key={img.captured_image_id}
              className="card-outline"
              style={{
                padding: "var(--spacing-md)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--spacing-sm)",
                outline: isSelected ? "2px solid var(--color-primary)" : "none",
                outlineOffset: 2,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)", fontSize: 12 }} className="text-body-mid">
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(img.captured_image_id)} />
                一括実行に含める
              </label>
              <img
                src={imageUrl("captures", img.captured_image_id)}
                alt={img.build_version}
                style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: "var(--rounded-sm)", background: "var(--color-mute)" }}
              />
              <strong style={{ fontSize: 14 }}>{img.build_version}</strong>
              <span style={{ fontSize: 12 }} className="text-body-mid">
                {img.resolution_width}×{img.resolution_height} · {img.dedup_hit ? "checksum dedupe" : "new blob"}
              </span>
              {isReference && <span className="badge-pill badge-pass">Active Reference</span>}
              <div style={{ display: "flex", gap: "var(--spacing-xs)", flexWrap: "wrap" }}>
                {!isReference && (
                  <button className="btn btn-tertiary btn-sm" disabled={busy || !canAdmin} onClick={() => onPromote(img.captured_image_id)} title={needTitle(canAdmin, "admin")}>
                    Referenceに昇格
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" disabled={busy || !canOperate || !activeReference} onClick={() => onRunDiff(img.captured_image_id)} title={needTitle(canOperate, "operator")}>
                  {busyCapturedImageId === img.captured_image_id ? "実行中…" : "差分実行"}
                </button>
                <button
                  className="btn btn-tertiary btn-sm"
                  style={{ borderColor: "var(--color-fail)", color: "var(--color-fail)" }}
                  disabled={busy || !canAdmin}
                  onClick={() => handleDelete(img)}
                  title={needTitle(canAdmin, "admin") ?? "Referenceに昇格済み、または差分評価履歴がある画像は削除できません"}
                >
                  削除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
