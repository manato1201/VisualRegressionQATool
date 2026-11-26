import { useEffect, useRef, useState } from "react";
import { HOLD, reducedMotion, spring, type Spring } from "../motion";

interface Props {
  label: string;
  /** 終わったときに読み上げる文(見た目は ✓ だけになる)。 */
  doneLabel: string;
  /** 押し切ったら呼ぶ。false を返すか reject したら、失敗として元に戻して揺れる。 */
  onConfirm: () => unknown;
  /** ✓ を見せたあと(DONE_VISIBLE_MS 後)に呼ぶ。ダイアログを閉じるのに使う。 */
  onDone?: () => void;
  disabled?: boolean;
}

/** ✓ を見せてから onDone を呼ぶまで。HOLD.doneMs(1.7 秒)はボタンが残る画面の長さで、
 * 閉じるダイアログの中では長すぎるので、丸くなって ✓ が引かれ終わるくらいにした。 */
export const DONE_VISIBLE_MS = 900;

type Mode = "idle" | "holding" | "working" | "done";

/** Hold to confirm (2026-11-26): 置き換えると戻せない操作(基準画像の更新)の確定ボタン。
 * 押し続けている間だけ塗りが一定の速さで進み(進み具合の表示)、1.2 秒で満ちたら丸くなって ✓ になる。
 * 途中で離すと、塗りがばねで戻り、進んだ分だけ「いいえ」と横に揺れる。クリック(押してすぐ離す)では実行しない。
 * Space / Enter でも押し続けられる。値は motion.ts の HOLD。 */
export function HoldToConfirm({
  label,
  doneLabel,
  onConfirm,
  onDone,
  disabled = false,
}: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const topRef = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [announce, setAnnounce] = useState("");
  const live = useRef({
    mode: "idle" as Mode,
    progress: 0,
    holdStart: 0,
    squash: 1,
    shake: 0,
    width: 0,
    frame: 0,
    timer: 0,
  });
  const springs = useRef<{
    fill: Spring;
    squash: Spring;
    shake: Spring;
    morph: Spring;
  } | null>(null);
  const confirmRef = useRef(onConfirm);
  const doneRef = useRef(onDone);
  confirmRef.current = onConfirm;
  doneRef.current = onDone;

  const paint = () => {
    const s = live.current;
    const p = Math.min(1, Math.max(0, s.progress));
    if (fillRef.current) fillRef.current.style.width = `${p * 100}%`;
    if (topRef.current)
      topRef.current.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
    if (buttonRef.current)
      buttonRef.current.style.transform = `translateX(${s.shake}px) scale(${s.squash})`;
  };

  useEffect(() => {
    const s = live.current;
    springs.current = {
      fill: spring(HOLD.release, 0, (x) => {
        s.progress = x;
        paint();
      }),
      squash: spring(HOLD.squash, 1, (x) => {
        s.squash = x;
        paint();
      }),
      shake: spring(HOLD.shake, 0, (x) => {
        s.shake = x;
        paint();
      }),
      morph: spring(HOLD.morph, 0, (x) => {
        if (buttonRef.current && s.width)
          buttonRef.current.style.width = `${x}px`;
      }),
    };
    return () => {
      const all = springs.current;
      if (all) Object.values(all).forEach((sp) => sp.stop());
      cancelAnimationFrame(s.frame);
      window.clearTimeout(s.timer);
    };
  }, []);

  const setModeBoth = (m: Mode) => {
    live.current.mode = m;
    setMode(m);
  };

  const tick = (now: number) => {
    const s = live.current;
    if (s.mode !== "holding") return;
    s.progress = Math.min(1, Math.max(0, (now - s.holdStart) / HOLD.holdMs));
    paint();
    if (s.progress >= 1) {
      void complete();
      return;
    }
    s.frame = requestAnimationFrame(tick);
  };

  const start = () => {
    const s = live.current;
    const sp = springs.current;
    if (s.mode !== "idle" || disabled || !sp || !buttonRef.current) return;
    setModeBoth("holding");
    s.width = buttonRef.current.offsetWidth;
    s.holdStart = performance.now() - s.progress * HOLD.holdMs; // 戻りきる前に押し直したら、その位置から
    sp.fill.set(s.progress);
    sp.squash.to(0.96);
    s.frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    const s = live.current;
    const sp = springs.current;
    if (s.mode !== "holding" || !sp) return;
    setModeBoth("idle");
    cancelAnimationFrame(s.frame);
    const reached = s.progress;
    sp.squash.to(1);
    sp.fill.set(reached);
    sp.fill.to(0);
    sp.shake.kick(-260 * reached); // 途中で離した: 進んだ分だけ「いいえ」と揺れる
  };

  const reset = () => {
    const s = live.current;
    const sp = springs.current;
    if (!sp) return;
    setModeBoth("idle");
    sp.morph.to(s.width);
    sp.fill.set(0);
    sp.shake.kick(-260);
    s.timer = window.setTimeout(
      () => {
        if (buttonRef.current) buttonRef.current.style.width = "";
      },
      reducedMotion() ? 0 : 600,
    );
  };

  const complete = async () => {
    const s = live.current;
    const sp = springs.current;
    const button = buttonRef.current;
    if (!sp || !button) return;
    setModeBoth("working");
    sp.squash.to(1, 2.5);
    sp.morph.set(s.width);
    sp.morph.to(button.offsetHeight); // 丸くなる
    let ok = false;
    try {
      ok = (await confirmRef.current()) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      reset();
      return;
    }
    setModeBoth("done");
    setAnnounce(doneLabel);
    s.timer = window.setTimeout(() => doneRef.current?.(), DONE_VISIBLE_MS);
  };

  const finished = mode === "working" || mode === "done";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-sm hold${finished ? " is-done" : ""}${mode === "done" ? " is-ok" : ""}`}
        disabled={disabled && mode === "idle"}
        aria-busy={mode === "working" || undefined}
        aria-label={finished ? doneLabel : `${label}(押し続けると確定します)`}
        title="押し続けると確定します(1.2 秒)。途中で離すと取り消し"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // 捕捉できないポインタ(支援技術の合成イベントなど)でも、長押しはできる
          }
          start();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            stop();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        // クリック(押してすぐ離す)では実行しない。長押しが確認の代わり
        onClick={(e) => e.preventDefault()}
      >
        <span ref={fillRef} className="hold-fill" aria-hidden="true" />
        <span className="hold-label">{label}</span>
        <span
          ref={topRef}
          className="hold-label hold-label-top"
          aria-hidden="true"
        >
          {label}
        </span>
        <svg
          className="hold-check"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </>
  );
}
