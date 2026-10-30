import type { Verdict } from "../types";
import { VERDICT_DESCRIPTION, VERDICT_LABEL } from "../verdictText";

/** `verdict === null` means no evaluation exists yet -> "未検査". */
export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  const key = verdict ?? "untested";
  const tone = verdict ?? "na";
  return (
    <span className={`badge-pill badge-${tone}`} title={VERDICT_DESCRIPTION[key]}>
      {VERDICT_LABEL[key]}
    </span>
  );
}
