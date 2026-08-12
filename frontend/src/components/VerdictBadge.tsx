import type { Verdict } from "../types";

const LABEL: Record<Verdict, string> = {
  pass: "Pass",
  fail: "Fail",
  flaky: "Flaky",
};

export const VERDICT_DESCRIPTION: Record<Verdict, string> = {
  pass: "PASS: 差分ピクセル数が許容範囲(max_diff_pixels)以内。Referenceと見た目が一致しているとみなされた状態です。",
  fail: "FAIL: 差分ピクセル数が許容範囲(max_diff_pixels)を超えました。意図しない見た目の変化(回帰)が起きた可能性があります。",
  flaky: "FLAKY: 同一条件での再撮影結果が安定しない(不安定な)状態です。",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`badge-pill badge-${verdict}`} title={VERDICT_DESCRIPTION[verdict]}>
      {LABEL[verdict]}
    </span>
  );
}
