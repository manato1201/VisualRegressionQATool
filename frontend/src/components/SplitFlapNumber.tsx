import { useEffect, useRef, useState } from "react";

const FLIP_DURATION_MS = 350;

interface Props {
  /** Pre-formatted display string, e.g. "1,234" or "12.3456%". */
  value: string;
}

/** Phase 6, feature 3: flips each character card when `value` changes,
 * swapping the character mid-rotation so the animation reads as the old
 * value flipping away to reveal the new one underneath -- a classic
 * split-flap display, applied to the diff pixel count / diff percentage
 * numbers in DiffViewer. */
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
    <span className="flap-number" aria-label={value}>
      {displayValue.split("").map((char, i) => (
        <span className="flap-digit" key={i} aria-hidden="true">
          <span className={`card ${flipping ? "flipping" : ""}`}>{char}</span>
        </span>
      ))}
    </span>
  );
}
