import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ToastItem } from "../types";

const POLL_INTERVAL_MS = 4000;
const AUTO_DISMISS_MS = 6000;

/** Phase 6, feature 4 (stack toast): polls GET /api/alerts/toasts and renders
 * new entries as a stack of auto-dismissing toasts. Backed by
 * WebUiToastAlertSink -- when a different sink is configured the endpoint
 * always returns an empty list, so this component just renders nothing. */
export function ToastStack() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastIdRef = useRef(0);
  const syncedRef = useRef(false);
  const timersRef = useRef(new Map<number, number>());

  useEffect(() => {
    const timers = timersRef.current;
    let cancelled = false;

    function dismiss(id: number) {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      const timer = timers.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timers.delete(id);
      }
    }

    async function poll() {
      try {
        const res = await api.listToasts(lastIdRef.current);
        if (cancelled) return;
        lastIdRef.current = res.last_id;

        if (!syncedRef.current) {
          // First tick after mount: adopt the current tip without replaying
          // a backlog of alerts that fired before this tab was open.
          syncedRef.current = true;
          return;
        }
        if (res.toasts.length === 0) return;

        setToasts((prev) => [...prev, ...res.toasts]);
        for (const toast of res.toasts) {
          // Each toast gets its own independent timer set once, so a steady
          // stream of new alerts can't keep resetting an older one's clock.
          const timer = window.setTimeout(
            () => dismiss(toast.id),
            AUTO_DISMISS_MS,
          );
          timers.set(toast.id, timer);
        }
      } catch {
        // Polling errors are non-critical -- just skip this tick.
      }
    }

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.severity === "error" ? "toast-error" : "toast-success"}`}
          onClick={() =>
            setToasts((prev) => prev.filter((t) => t.id !== toast.id))
          }
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
