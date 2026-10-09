import { useEffect, useRef, useState } from "react";

const FLIP_DURATION_MS = 350;

interface Props {
  /** Pre-formatted display string, e.g. "1,234" or "12.3456%". */
  value: string;
}

/** Flips each character when `value` changes, swapping the character at the
 * midpoint of the squash so it reads as the old value flipping away to reveal
 * the new one -- a split-flap display.
 *
 * Use it only where the point is "this count just changed" (the dashboard's
 * pass/fail/untested tallies). It must not wrap a figure people compare, like
 * a diff rate: that number should sit still and be readable (decision table:
 * 数字の演出). */
export function SplitFlapNumber({ value }: Props) {
  const [displayValue, setDisplayValue] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (value === displayValue) return;

    setFlipping(true);
    const swapTimer = window.setTimeout(() => {
      setDisplayValue(value);
    }, FLIP_DURATION_MS / 2);
    const settleTimer = window.setTimeout(() => {
      setFlipping(false);
    }, FLIP_DURATION_MS);

    timers.current.push(swapTimer, settleTimer);
    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="flap-number num" aria-label={value}>
      {displayValue.split("").map((char, i) => (
        <span className="flap-digit" key={i} aria-hidden="true">
          {/* Not named "card": that class is the app-wide panel style
              (padding, background, radius) and would balloon every digit. */}
          <span className={`flap-card ${flipping ? "flipping" : ""}`}>
            {char}
          </span>
        </span>
      ))}
    </span>
  );
}
