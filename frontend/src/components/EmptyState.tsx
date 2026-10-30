import type { ReactNode } from "react";

interface Props {
  /** Optional decorative picture above the text (e.g. the ASCII garden).
   * Never the only carrier of meaning -- the text below says everything. */
  art?: ReactNode;
  title: string;
  description?: string;
  /** What to do next, in order. An empty screen should say how to fill it. */
  steps?: string[];
  action?: ReactNode;
}

/** "Nothing here yet" that tells the person what to do next, instead of a
 * bare empty table or a blank panel. The panel itself never moves; only the
 * optional `art` may (and it is the one motion this screen adds). */
export function EmptyState({ art, title, description, steps, action }: Props) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-sm)",
        alignItems: "flex-start",
        padding: "var(--spacing-lg)",
        border: "1px dashed var(--color-untested)",
        borderRadius: "var(--rounded-md)",
        background: "var(--color-untested-bg)",
      }}
    >
      {art && <div style={{ alignSelf: "stretch" }}>{art}</div>}
      <strong style={{ fontSize: 16 }}>{title}</strong>
      {description && (
        <p className="text-body-mid" style={{ margin: 0, fontSize: 14 }}>
          {description}
        </p>
      )}
      {steps && steps.length > 0 && (
        <ol
          style={{ margin: 0, paddingLeft: "var(--spacing-xl)", fontSize: 14 }}
        >
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {action}
    </div>
  );
}
