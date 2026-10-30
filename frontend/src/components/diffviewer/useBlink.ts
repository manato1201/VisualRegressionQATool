import { useEffect, useState } from "react";

/** Half-period of the flicker. A full Reference -> Captured -> Reference cycle
 * takes 2 x 800 ms = 1.6 s (0.625 Hz), safely under the 1 Hz ceiling that
 * photosensitivity guidance asks for. */
export const BLINK_INTERVAL_MS = 800;

export const BLINK_WHICH_OPTIONS = [
  { key: "reference", label: "Reference" },
  { key: "captured", label: "Captured" },
] as const;

export type BlinkWhich = (typeof BLINK_WHICH_OPTIONS)[number]["key"];

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface BlinkState {
  which: BlinkWhich;
  setWhich: (which: BlinkWhich) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
}

/** Blink state lives in the parent so the controls can sit above the stage
 * while the image stack sits inside it. Only ticks while `active`, so leaving
 * the blink mode never leaves a timer running. Starts stopped for people who
 * ask the OS for reduced motion. */
export function useBlink(active: boolean): BlinkState {
  const [which, setWhich] = useState<BlinkWhich>("reference");
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    if (!active || !playing) return;
    const id = window.setInterval(
      () => setWhich((w) => (w === "reference" ? "captured" : "reference")),
      BLINK_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [active, playing]);

  return { which, setWhich, playing, setPlaying };
}
