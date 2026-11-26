// 状態変化のばね(2026-11-26)。長押しで確定するボタン(HoldToConfirm)が使う。
// 値は designbookmark の Hold to publish に合わせた(コードは写していない。ライセンスの記載が無いため、値とふるまいの決まりだけ)。
// 解き方は ToolOrchestrationHub・DevelopmentRAGEnvironment と同じ: 質量 1、a = -k(x - 目標) - c·v、
// 半陰的オイラー(速度を先に更新)を 1 フレーム 4 回、1 フレームは最大 1/30 秒、止まる条件は |x-目標| < 0.001 かつ |v| < 0.01。
// 動きを減らす設定(prefers-reduced-motion)のときは、すぐに目標の値にし、揺れ(kick)は無し。

export type SpringParams = readonly [stiffness: number, damping: number];

export const HOLD = {
  holdMs: 1200, // 押し続ける長さ
  doneMs: 1700, // ✓ を見せる長さ
  release: [260, 14], // 途中で離したとき、塗りが戻る
  morph: [320, 20], // 満ちたら丸くなる
  squash: [520, 20], // 押している間、少し縮む
  shake: [700, 9], // 途中で離したとき、進んだ分だけ「いいえ」と揺れる
} as const satisfies Record<string, number | SpringParams>;

const SUBSTEPS = 4;
const MAX_DT = 1 / 30;

export function step(
  x: number,
  v: number,
  target: number,
  [k, c]: SpringParams,
  dt: number,
): [number, number] {
  const h = Math.min(Math.max(dt, 0), MAX_DT) / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
  }
  return [x, v];
}

export function atRest(x: number, v: number, target: number): boolean {
  return Math.abs(x - target) < 0.001 && Math.abs(v) < 0.01;
}

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export interface Spring {
  readonly value: number;
  /** 動かさずに、その値にする。 */
  set(value: number): void;
  /** 目標を変える(velocity を渡すと、その速さから動き出す)。 */
  to(target: number, velocity?: number): void;
  /** 速さを足す(揺れ)。 */
  kick(velocity: number): void;
  stop(): void;
}

export function spring(
  params: SpringParams,
  initial: number,
  onUpdate: (x: number) => void,
): Spring {
  let x = initial;
  let v = 0;
  let target = initial;
  let frame = 0;
  let last = 0;

  const tick = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    [x, v] = step(x, v, target, params, dt);
    if (atRest(x, v, target)) {
      x = target;
      v = 0;
      frame = 0;
    } else {
      frame = requestAnimationFrame(tick);
    }
    onUpdate(x);
  };
  const run = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    get value() {
      return x;
    },
    set(value) {
      stop();
      x = target = value;
      v = 0;
      onUpdate(x);
    },
    to(next, velocity) {
      if (reducedMotion()) {
        this.set(next);
        return;
      }
      target = next;
      if (velocity !== undefined) v = velocity;
      run();
    },
    kick(velocity) {
      if (reducedMotion()) return;
      v += velocity;
      run();
    },
    stop,
  };
}
