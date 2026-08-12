import { useState } from "react";
import { imageUrl } from "../api";
import type { CapturedImage, ReferenceImage } from "../types";

interface Props {
  capturedImages: CapturedImage[];
  activeReference: ReferenceImage | null;
  onUpload: (buildVersion: string, file: File) => Promise<void>;
  onPromote: (capturedImageId: string) => Promise<void>;
  onRunDiff: (capturedImageId: string) => Promise<void>;
  onDelete: (capturedImageId: string) => Promise<void>;
  busyCapturedImageId: string | null;
}

export function CapturePanel({ capturedImages, activeReference, onUpload, onPromote, onRunDiff, onDelete, busyCapturedImageId }: Props) {
  const [buildVersion, setBuildVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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
        <button type="submit" className="btn btn-primary btn-sm" disabled={uploading || !file || !buildVersion.trim()}>
          {uploading ? "アップロード中…" : "アップロード"}
        </button>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--spacing-md)" }}>
        {capturedImages.length === 0 && <p className="text-body-mid">まだ撮影画像がありません</p>}
        {capturedImages.map((img) => {
          const isReference = activeReference?.captured_image_id === img.captured_image_id;
          const busy = busyCapturedImageId === img.captured_image_id;
          return (
            <div key={img.captured_image_id} className="card-outline" style={{ padding: "var(--spacing-md)", display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
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
                  <button className="btn btn-tertiary btn-sm" disabled={busy} onClick={() => onPromote(img.captured_image_id)}>
                    Referenceに昇格
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" disabled={busy || !activeReference} onClick={() => onRunDiff(img.captured_image_id)}>
                  {busy ? "実行中…" : "差分実行"}
                </button>
                <button
                  className="btn btn-tertiary btn-sm"
                  style={{ borderColor: "var(--color-fail)", color: "var(--color-fail)" }}
                  disabled={busy}
                  onClick={() => handleDelete(img)}
                  title="Referenceに昇格済み、または差分評価履歴がある画像は削除できません"
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
