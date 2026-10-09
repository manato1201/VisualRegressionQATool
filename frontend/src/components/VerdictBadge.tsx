import type { Verdict } from "../types";

/** Verdict labels carry a glyph as well as a colour, so pass / fail /
 * not-inspected stay distinguishable without colour (decision table: 判定). */
const LABEL: Record<Verdict | "untested", string> = {
  pass: "✓ 合格",
  fail: "✕ 不合格",
  flaky: "△ 不安定",
  untested: "— 未検査",
};

export const VERDICT_DESCRIPTION: Record<Verdict | "untested", string> = {
  pass: "合格: 差分ピクセル数が許容範囲(max_diff_pixels)以内。Referenceと見た目が一致しているとみなされた状態です。",
  fail: "不合格: 差分ピクセル数が許容範囲(max_diff_pixels)を超えました。意図しない見た目の変化(回帰)が起きた可能性があります。",
  flaky: "不安定: 同一条件での再撮影結果が安定しない状態です。",
  untested: "未検査: まだ差分評価が実行されていません。",
};

/** `verdict === null` means no evaluation exists yet -> "未検査". */
export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  const key = verdict ?? "untested";
  const tone = verdict ?? "na";
  return (
    <span className={`badge-pill badge-${tone}`} title={VERDICT_DESCRIPTION[key]}>
      {LABEL[key]}
    </span>
  );
}
