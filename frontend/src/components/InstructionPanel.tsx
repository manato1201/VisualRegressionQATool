import { useState } from "react";
import type { CaptureInstruction } from "../types";

interface Props {
  instructions: CaptureInstruction[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (sceneOrLevelId: string) => Promise<void>;
}

export function InstructionPanel({
  instructions,
  selectedId,
  onSelect,
  onCreate,
}: Props) {
  const [sceneId, setSceneId] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!sceneId.trim()) return;
    setCreating(true);
    try {
      await onCreate(sceneId.trim());
      setSceneId("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside
      className="card-outline"
      style={{
        minWidth: 280,
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-lg)",
      }}
    >
      <div>
        <p className="eyebrow">Capture Instructions</p>
        <h2 style={{ fontSize: 24, marginTop: 4 }}>撮影指示</h2>
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-sm)",
        }}
      >
        {instructions.length === 0 && (
          <li className="text-body-mid">まだ撮影指示がありません</li>
        )}
        {instructions.map((instr) => (
          <li key={instr.instruction_id}>
            <button
              onClick={() => onSelect(instr.instruction_id)}
              className="btn"
              style={{
                width: "100%",
                justifyContent: "flex-start",
                textAlign: "left",
                background:
                  instr.instruction_id === selectedId
                    ? "var(--color-ink)"
                    : "var(--color-canvas)",
                color:
                  instr.instruction_id === selectedId
                    ? "var(--color-on-primary)"
                    : "var(--color-ink)",
                border: "1px solid var(--color-ink)",
                fontSize: 16,
                padding: "var(--spacing-sm) var(--spacing-md)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <strong>{instr.scene_or_level_id}</strong>
                <span style={{ fontSize: 12, opacity: 0.75 }}>
                  seed={instr.seed} / fps={instr.frame_rate}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={handleCreate}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-sm)",
        }}
      >
        <label
          htmlFor="scene-id"
          style={{ fontSize: 14, color: "var(--color-body)" }}
        >
          新規シーンID
        </label>
        <input
          id="scene-id"
          type="text"
          placeholder="OutdoorsScene"
          value={sceneId}
          onChange={(e) => setSceneId(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={creating || !sceneId.trim()}
        >
          {creating ? "作成中…" : "撮影指示を作成"}
        </button>
      </form>
    </aside>
  );
}
