import { formatCount } from "../../format";
import type { DiffCluster } from "../../diffClusters";

const ZOOM_VIEW_SIZE = 220;
const ZOOM_PADDING_FACTOR = 3;
const ZOOM_MIN_WINDOW_PX = 12;

interface Props {
  cluster: DiffCluster;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onClose: () => void;
}

/** A pixelated CSS-background crop of the diff image centred on a pinned
 * cluster, scaled so the cluster (plus some padding) fills the view -- lets a
 * tiny regression be inspected without leaving the page or opening the raw
 * image at full resolution. */
export function ZoomPanel({
  cluster,
  imageUrl,
  imageWidth,
  imageHeight,
  onClose,
}: Props) {
  const clusterWidth = cluster.maxX - cluster.minX + 1;
  const clusterHeight = cluster.maxY - cluster.minY + 1;
  const windowSize =
    Math.max(clusterWidth, clusterHeight, ZOOM_MIN_WINDOW_PX) *
    ZOOM_PADDING_FACTOR;
  const scale = ZOOM_VIEW_SIZE / windowSize;
  const centerX = (cluster.minX + cluster.maxX + 1) / 2;
  const centerY = (cluster.minY + cluster.maxY + 1) / 2;

  return (
    <div
      className="card-outline"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-sm)",
        padding: "var(--spacing-md)",
        alignSelf: "flex-start",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--spacing-md)",
        }}
      >
        <span
          style={{ fontSize: 12, fontWeight: 600 }}
          className="text-body-mid"
        >
          拡大表示(
          <span className="num">{formatCount(cluster.pixelCount)}</span> px)
        </span>
        <button className="btn btn-sm btn-tertiary" onClick={onClose}>
          閉じる
        </button>
      </div>
      <div
        role="img"
        aria-label="選択した差分領域の拡大"
        style={{
          width: ZOOM_VIEW_SIZE,
          height: ZOOM_VIEW_SIZE,
          borderRadius: "var(--rounded-sm)",
          border: "1px solid var(--color-mute)",
          backgroundImage: `url(${imageUrl})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${imageWidth * scale}px ${imageHeight * scale}px`,
          backgroundPosition: `${-(centerX * scale - ZOOM_VIEW_SIZE / 2)}px ${-(centerY * scale - ZOOM_VIEW_SIZE / 2)}px`,
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}
