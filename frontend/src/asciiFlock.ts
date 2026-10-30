/** A tiny flocking simulation for the decorative ASCII garden shown in empty
 * states ("no diff -- a garden with no bugs in it"). Written from the idea of
 * boids only (cohesion / alignment / separation + a little wander); no code is
 * taken from any upstream project.
 *
 * Pure and seedable so the same seed always yields the same garden -- which is
 * what lets the reduced-motion path draw one stable still frame, and lets the
 * rules be checked without a browser. */

export interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Index into whatever glyph set the renderer uses. */
  glyph: number;
}

export interface Bounds {
  width: number;
  /** Height of the sky: agents live above the ground line. */
  height: number;
}

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEIGHBOUR_RADIUS = 70;
const TOO_CLOSE = 22;
const MIN_SPEED = 0.25;
const MAX_SPEED = 1.1;

export function createAgents(
  count: number,
  bounds: Bounds,
  rng: Rng,
  glyphCount: number,
): Agent[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = rng() * Math.PI * 2;
    const speed = MIN_SPEED + rng() * (MAX_SPEED - MIN_SPEED);
    return {
      x: rng() * bounds.width,
      y: rng() * bounds.height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      glyph: i % Math.max(1, glyphCount),
    };
  });
}

/** Advance every agent by one tick (mutates `agents`). */
export function stepFlock(agents: Agent[], bounds: Bounds, rng: Rng): void {
  for (const a of agents) {
    let cx = 0;
    let cy = 0;
    let avx = 0;
    let avy = 0;
    let sx = 0;
    let sy = 0;
    let neighbours = 0;

    for (const b of agents) {
      if (a === b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > NEIGHBOUR_RADIUS) continue;
      neighbours++;
      cx += b.x;
      cy += b.y;
      avx += b.vx;
      avy += b.vy;
      if (dist < TOO_CLOSE && dist > 0) {
        sx -= dx / dist;
        sy -= dy / dist;
      }
    }

    if (neighbours > 0) {
      a.vx += (cx / neighbours - a.x) * 0.0006; // cohesion
      a.vy += (cy / neighbours - a.y) * 0.0006;
      a.vx += (avx / neighbours - a.vx) * 0.04; // alignment
      a.vy += (avy / neighbours - a.vy) * 0.04;
      a.vx += sx * 0.06; // separation
      a.vy += sy * 0.06;
    }

    a.vx += (rng() - 0.5) * 0.08; // wander
    a.vy += (rng() - 0.5) * 0.08;

    const speed = Math.hypot(a.vx, a.vy) || 1;
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
    a.vx = (a.vx / speed) * clamped;
    a.vy = (a.vy / speed) * clamped;

    a.x += a.vx;
    a.y += a.vy;

    // The garden wraps sideways and bounces off the sky's top and ground line.
    if (a.x < 0) a.x += bounds.width;
    if (a.x > bounds.width) a.x -= bounds.width;
    if (a.y < 0) {
      a.y = 0;
      a.vy = Math.abs(a.vy);
    }
    if (a.y > bounds.height) {
      a.y = bounds.height;
      a.vy = -Math.abs(a.vy);
    }
  }
}
