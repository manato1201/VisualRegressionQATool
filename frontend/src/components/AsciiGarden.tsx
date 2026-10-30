import { useEffect, useRef, useState } from "react";
import { createAgents, mulberry32, stepFlock, type Agent } from "../asciiFlock";

/** calm    = no difference found: a garden with no bugs in it, only butterflies.
 * waiting = nothing compared yet: the same garden, muted and idle.
 *
 * Deliberately never drawn in the red "fail" colour: that colour is reserved
 * for "a bug showed up", and this is only ever shown when none has. It lives
 * in empty / waiting states only (never beside body text or controls), so a
 * screen that shows it carries at most its usual toast plus this one motion. */
export type GardenMood = "calm" | "waiting";

const GLYPHS = ["(o)", "}{", "<>"];
const HEIGHT = 72;
const GROUND = 16;
const AGENT_COUNT = 10;
const FRAME_MS = 1000 / 24;
const WARM_UP_TICKS = 160;

function readColors(el: HTMLElement, mood: GardenMood) {
  const style = getComputedStyle(el);
  const token = (name: string) =>
    style.getPropertyValue(name).trim() || "currentColor";
  return {
    grass: token("--color-untested"),
    bug: mood === "calm" ? token("--color-pass") : token("--color-untested"),
    font: `13px ${token("--font-mono")}`,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Decorative only (aria-hidden): the empty state's text carries the meaning.
 * Under prefers-reduced-motion it draws one still frame and runs no timer. */
export function AsciiGarden({ mood }: { mood: GardenMood }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const rng = mulberry32(mood === "calm" ? 11 : 29);
    const bounds = {
      width: canvas.clientWidth || 300,
      height: HEIGHT - GROUND,
    };
    const agents: Agent[] = createAgents(
      AGENT_COUNT,
      bounds,
      rng,
      GLYPHS.length,
    );
    for (let i = 0; i < WARM_UP_TICKS; i++) stepFlock(agents, bounds, rng);
    const grass = Array.from({ length: 60 }, () => ({
      x: rng(),
      ch: ["'", '"', ",", ".", "`"][Math.floor(rng() * 5)],
    }));

    let colors = readColors(canvas, mood);
    let dpr = window.devicePixelRatio || 1;

    function resize() {
      if (!canvas || !ctx) return;
      const width = canvas.clientWidth || 300;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bounds.width = width;
    }

    function draw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.clientWidth, HEIGHT);
      ctx.font = colors.font;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = colors.grass;
      for (const g of grass)
        ctx.fillText(g.ch, g.x * bounds.width, HEIGHT - GROUND / 2);
      ctx.fillStyle = colors.bug;
      for (const a of agents) ctx.fillText(GLYPHS[a.glyph], a.x, a.y + 6);
    }

    resize();
    draw();

    // Theme switches change the tokens; re-read them (and redraw a still frame).
    const themeObserver = new MutationObserver(() => {
      colors = readColors(canvas, mood);
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const sizeObserver = new ResizeObserver(() => {
      resize();
      draw();
    });
    sizeObserver.observe(canvas);

    let frame = 0;
    let last = 0;
    let visible = true;
    let intersectionObserver: IntersectionObserver | null = null;

    function tick(now: number) {
      frame = 0;
      if (!visible || document.hidden) return;
      if (now - last >= FRAME_MS) {
        last = now;
        stepFlock(agents, bounds, rng);
        draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function start() {
      if (!frame && !reduced) frame = requestAnimationFrame(tick);
    }

    if (!reduced) {
      // Don't animate what nobody can see: off-screen or in a background tab.
      intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
      });
      intersectionObserver.observe(canvas);
      document.addEventListener("visibilitychange", start);
      start();
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", start);
      intersectionObserver?.disconnect();
      sizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [mood, reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: "100%", height: HEIGHT, display: "block" }}
    />
  );
}
