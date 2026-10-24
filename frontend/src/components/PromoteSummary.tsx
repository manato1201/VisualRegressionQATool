import { imageUrl } from "../api";
import { formatResolution } from "../format";
import type { CapturedImage } from "../types";

function Side({ label, image }: { label: string; image: CapturedImage | null }) {
  return (
    <figure style={{ margin: 0, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <figcaption className="text-body-mid" style={{ fontSize: 12, fontWeight: 600 }}>
        {label}
      </figcaption>
      {image ? (
        <>
          <img
            src={imageUrl("captures", image.captured_image_id)}
            alt={`${label}: ${image.build_version}`}
            style={{
              width: "100%",
              aspectRatio: "4/3",
              objectFit: "cover",
              borderRadius: "var(--rounded-sm)",
              border: "1px solid var(--color-mute)",
            }}
          />
          <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {image.build_version}
          </strong>
          <span className="num text-body-mid" style={{ fontSize: 12 }}>
            {formatResolution(image.resolution_width, image.resolution_height)}
          </span>
        </>
      ) : (
        <span className="text-body-mid">—</span>
      )}
    </figure>
  );
}

/** Body of the "update the baseline?" confirmation: the image being replaced
 * next to the one replacing it, and what the change does and doesn't affect. */
export function PromoteSummary({
  current,
  next,
}: {
  current: CapturedImage | null;
  next: CapturedImage | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
      <div style={{ display: "flex", gap: "var(--spacing-md)", alignItems: "flex-start" }}>
        <Side label="現在の基準画像" image={current} />
        <span aria-hidden="true" style={{ alignSelf: "center", fontSize: 20 }}>
          →
        </span>
        <Side label="新しい基準画像" image={next} />
      </div>
      <ul style={{ margin: 0, paddingLeft: "var(--spacing-xl)", display: "flex", flexDirection: "column", gap: 2 }}>
        <li>これ以降の差分比較は、新しい基準画像を基準に行われます。</li>
        <li>これまでの判定結果と履歴は変わりません(旧基準画像は履歴として残ります)。</li>
        <li>元に戻すには、以前の画像をもう一度「Referenceに昇格」してください。</li>
      </ul>
    </div>
  );
}
