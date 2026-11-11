import { useCallback, useEffect, useState } from "react";
import { api, describeApiError, imageUrl } from "../api";
import { adminApi } from "../adminApi";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PromoteSummary } from "../components/PromoteSummary";
import { useCan } from "../role";
import type { CaptureInstruction, CapturedImage, ReferenceImage } from "../types";

/**
 * 管理者だけの画面: 基準画像(Reference)の更新と、撮影画像の削除。
 * 権限の判断は常にサーバー側(promote・delete は admin 以外 403)。ここは入口の出し分けと操作の置き場所。
 */
export default function AdminApp() {
  const can = useCan();
  const [instructions, setInstructions] = useState<CaptureInstruction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [activeReference, setActiveReference] = useState<ReferenceImage | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingPromoteId, setPendingPromoteId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CapturedImage | null>(null);

  const isAdmin = can("admin");

  const refreshDetail = useCallback(async (instructionId: string) => {
    const list = await api.listCapturedImages(instructionId);
    setImages(list);
    try {
      setActiveReference(await api.getActiveReference(instructionId));
    } catch {
      setActiveReference(null);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .listInstructions()
      .then((list) => {
        setInstructions(list);
        if (list.length > 0) setSelectedId(list[0].instruction_id);
      })
      .catch((e) => setBanner(describeApiError(e)));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedId) return;
    refreshDetail(selectedId).catch((e) => setBanner(describeApiError(e)));
  }, [isAdmin, selectedId, refreshDetail]);

  async function run(id: string, action: () => Promise<unknown>) {
    if (!selectedId) return;
    setBusyId(id);
    setBanner(null);
    try {
      await action();
      await refreshDetail(selectedId);
    } catch (e) {
      setBanner(describeApiError(e));
    } finally {
      setBusyId(null);
    }
  }

  // 最初の昇格は基準を作るだけ。既存の基準を置き換えると、以降の差分の基準が変わるので確認する。
  function requestPromote(id: string) {
    if (activeReference && activeReference.captured_image_id !== id) {
      setPendingPromoteId(id);
      return;
    }
    void run(id, () => adminApi.promoteReference(id, "web-ui"));
  }

  async function confirmPromote() {
    const id = pendingPromoteId;
    if (!id) return;
    await run(id, () => adminApi.promoteReference(id, "web-ui"));
    setPendingPromoteId(null);
  }

  async function confirmDelete() {
    const img = pendingDelete;
    if (!img) return;
    await run(img.captured_image_id, () => adminApi.deleteCapturedImage(img.captured_image_id));
    setPendingDelete(null);
  }

  if (!isAdmin) {
    return (
      <main style={{ maxWidth: 520, margin: "12vh auto", padding: "0 16px", display: "grid", gap: 12 }} role="alert">
        <h1 style={{ fontSize: 20 }}>管理画面</h1>
        <p>この画面は管理者(admin)だけが使えます。サーバー側でも、基準画像の更新と撮影画像の削除は admin に限っています。</p>
        <p>
          <a href="/">差分ビューアへ戻る</a>
        </p>
      </main>
    );
  }

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <ConfirmDialog
        open={pendingPromoteId !== null}
        title="基準画像(Reference)を更新しますか?"
        confirmLabel="Referenceを更新する"
        busy={busyId !== null && busyId === pendingPromoteId}
        onConfirm={confirmPromote}
        onCancel={() => setPendingPromoteId(null)}
      >
        <PromoteSummary
          current={images.find((c) => c.captured_image_id === activeReference?.captured_image_id) ?? null}
          next={images.find((c) => c.captured_image_id === pendingPromoteId) ?? null}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="撮影画像を削除しますか?"
        confirmLabel="削除する"
        busy={busyId !== null && busyId === pendingDelete?.captured_image_id}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        <p>「{pendingDelete?.build_version}」を削除します。この操作は取り消せません。Referenceに昇格済み、または差分評価履歴がある画像は削除できません。</p>
      </ConfirmDialog>

      <header
        style={{
          padding: "var(--spacing-md) var(--spacing-xl)",
          borderBottom: "1px solid var(--color-mute)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--spacing-md)",
        }}
      >
        <div>
          <p className="eyebrow">管理者のみ · サーバー側で権限を検査</p>
          <h1 style={{ fontSize: 32 }}>管理</h1>
          <p className="text-body-mid" style={{ fontSize: 12 }}>基準画像の更新と、撮影画像の削除。変更は監査ログに残ります。</p>
        </div>
        <a className="btn btn-tertiary btn-sm" href="/">
          ← 差分ビューアへ戻る
        </a>
      </header>

      {banner && (
        <div
          role="alert"
          style={{
            margin: "var(--spacing-md) var(--spacing-xl) 0",
            padding: "var(--spacing-md)",
            background: "var(--color-fail-bg)",
            color: "var(--color-fail)",
            borderRadius: "var(--rounded-md)",
            whiteSpace: "pre-line",
          }}
        >
          {banner}
        </div>
      )}

      <main style={{ padding: "var(--spacing-xl)", display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
          <label htmlFor="admin-instruction" style={{ fontSize: 14 }}>
            撮影指示
          </label>
          <select id="admin-instruction" value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value || null)}>
            {instructions.length === 0 && <option value="">撮影指示がありません</option>}
            {instructions.map((i) => (
              <option key={i.instruction_id} value={i.instruction_id}>
                {i.scene_or_level_id}
              </option>
            ))}
          </select>
        </section>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
          <div>
            <p className="eyebrow">Captured Images</p>
            <h2 style={{ fontSize: 24, marginTop: 4 }}>撮影画像</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--spacing-md)" }}>
            {images.length === 0 && <p className="text-body-mid" style={{ gridColumn: "1 / -1" }}>この撮影指示には、撮影画像がありません。</p>}
            {images.map((img) => {
              const isReference = activeReference?.captured_image_id === img.captured_image_id;
              const busy = busyId === img.captured_image_id;
              return (
                <div key={img.captured_image_id} className="card-outline" style={{ padding: "var(--spacing-md)", display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
                  <img
                    src={imageUrl("captures", img.captured_image_id)}
                    alt={img.build_version}
                    style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: "var(--rounded-sm)", background: "var(--color-mute)" }}
                  />
                  <strong style={{ fontSize: 14 }}>{img.build_version}</strong>
                  <span style={{ fontSize: 12 }} className="text-body-mid">
                    {img.resolution_width}×{img.resolution_height}
                  </span>
                  {isReference && <span className="badge-pill badge-pass">Active Reference</span>}
                  <div style={{ display: "flex", gap: "var(--spacing-xs)", flexWrap: "wrap" }}>
                    {!isReference && (
                      <button className="btn btn-tertiary btn-sm" disabled={busy} onClick={() => requestPromote(img.captured_image_id)}>
                        Referenceに昇格
                      </button>
                    )}
                    <button
                      className="btn btn-tertiary btn-sm"
                      style={{ borderColor: "var(--color-fail)", color: "var(--color-fail)" }}
                      disabled={busy}
                      onClick={() => setPendingDelete(img)}
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
      </main>
    </div>
  );
}
