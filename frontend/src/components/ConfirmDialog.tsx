import { useEffect, useId, useRef, type ReactNode } from "react";
import { HoldToConfirm } from "./HoldToConfirm";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  /** 渡すと、確定ボタンが長押し式(HoldToConfirm)になる。onConfirm は成功で true・失敗で false を返す。
   * doneLabel は終わったときの読み上げ、onDone は ✓ を見せたあとに呼ぶ(ここでダイアログを閉じる)。 */
  hold?: { doneLabel: string; onDone: () => void };
  onConfirm: () => unknown;
  onCancel: () => void;
}

/** Confirmation for a destructive action (plan: モーダル01 -- updating the
 * baseline image). Built on the native <dialog>: showModal() gives a real
 * focus trap, makes the page behind inert, restores focus on close and handles
 * Esc, none of which a hand-rolled overlay does reliably. Focus starts on
 * "cancel" so a stray Enter cannot confirm a destructive change. No
 * open/close animation -- a confirmation should appear instantly and quietly.
 * With `hold`, the confirm button must be held down (HoldToConfirm) -- used
 * where the change cannot be undone by the next click (replacing the baseline). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "キャンセル",
  busy = false,
  hold,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      // Esc: let the parent decide, so React state and the dialog never disagree.
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      // A click on the backdrop lands on the <dialog> element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-md)",
        }}
      >
        <h2 id={titleId} style={{ fontSize: 20 }}>
          {title}
        </h2>
        <div style={{ fontSize: 14 }}>{children}</div>
        <div
          style={{
            display: "flex",
            gap: "var(--spacing-sm)",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            autoFocus
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          {hold ? (
            // key: 開くたびに作り直し、前回の ✓ や幅を持ち越さない
            <HoldToConfirm key={String(open)} label={confirmLabel} doneLabel={hold.doneLabel} onConfirm={onConfirm} onDone={hold.onDone} />
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "更新中…" : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
