/** Phase 6, feature 1 (focus ring): finds connected clusters of diff pixels
 * in a rendered Diff Highlight image, entirely client-side -- no new backend
 * API. Reuses the same trick as pixelSampler.ts (offscreen canvas +
 * getImageData), then does a simple flood fill over pixels matching the
 * backend's HIGHLIGHT_COLOR (see backend/app/diff_engine.py) to group
 * touching diff pixels into bounding boxes. */

export interface DiffCluster {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
}

// Must match HIGHLIGHT_COLOR in backend/app/diff_engine.py. Dimmed
// background pixels are darkened captured-image color, which can never
// reach pure (255,0,0): the background-dim factor caps every channel at
// ~90, so this exact color is a reliable diff-pixel signature.
const HIGHLIGHT_R = 255;
const HIGHLIGHT_G = 0;
const HIGHLIGHT_B = 0;

export async function findDiffClusters(
  diffImageUrl: string,
  maxClusters = 5,
): Promise<DiffCluster[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () =>
      reject(
        new Error(`failed to load diff image for clustering: ${diffImageUrl}`),
      );
    img.src = diffImageUrl;
  });

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (width === 0 || height === 0) return [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return []; // tainted canvas -- degrade to "no clusters" rather than throw
  }

  const isDiffPixel = (x: number, y: number): boolean => {
    const idx = (y * width + x) * 4;
    return (
      data[idx] === HIGHLIGHT_R &&
      data[idx + 1] === HIGHLIGHT_G &&
      data[idx + 2] === HIGHLIGHT_B
    );
  };

  const visited = new Uint8Array(width * height);
  const clusters: DiffCluster[] = [];
  const stackX = new Int32Array(width * height);
  const stackY = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (visited[startIdx] || !isDiffPixel(x, y)) continue;

      let stackSize = 0;
      stackX[stackSize] = x;
      stackY[stackSize] = y;
      stackSize++;
      visited[startIdx] = 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixelCount = 0;

      while (stackSize > 0) {
        stackSize--;
        const cx = stackX[stackSize];
        const cy = stackY[stackSize];
        pixelCount++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-connectivity neighbors, inlined to avoid per-pixel allocation.
        if (cx > 0) {
          const nIdx = cy * width + (cx - 1);
          if (!visited[nIdx] && isDiffPixel(cx - 1, cy)) {
            visited[nIdx] = 1;
            stackX[stackSize] = cx - 1;
            stackY[stackSize] = cy;
            stackSize++;
          }
        }
        if (cx < width - 1) {
          const nIdx = cy * width + (cx + 1);
          if (!visited[nIdx] && isDiffPixel(cx + 1, cy)) {
            visited[nIdx] = 1;
            stackX[stackSize] = cx + 1;
            stackY[stackSize] = cy;
            stackSize++;
          }
        }
        if (cy > 0) {
          const nIdx = (cy - 1) * width + cx;
          if (!visited[nIdx] && isDiffPixel(cx, cy - 1)) {
            visited[nIdx] = 1;
            stackX[stackSize] = cx;
            stackY[stackSize] = cy - 1;
            stackSize++;
          }
        }
        if (cy < height - 1) {
          const nIdx = (cy + 1) * width + cx;
          if (!visited[nIdx] && isDiffPixel(cx, cy + 1)) {
            visited[nIdx] = 1;
            stackX[stackSize] = cx;
            stackY[stackSize] = cy + 1;
            stackSize++;
          }
        }
      }

      clusters.push({ minX, minY, maxX, maxY, pixelCount });
    }
  }

  clusters.sort((a, b) => b.pixelCount - a.pixelCount);
  return clusters.slice(0, maxClusters);
}

export function clusterContains(
  cluster: DiffCluster,
  x: number,
  y: number,
): boolean {
  return (
    x >= cluster.minX &&
    x <= cluster.maxX &&
    y >= cluster.minY &&
    y <= cluster.maxY
  );
}
