/** Loads an image into an offscreen canvas so individual pixels can be
 * sampled without re-decoding on every mouse move. Requires the image
 * response to carry CORS headers (the backend's CORSMiddleware already
 * allows the dev origin) plus `crossOrigin = "anonymous"` on the <img>,
 * otherwise the canvas is "tainted" and getImageData() throws. */
export interface PixelSampler {
  width: number;
  height: number;
  /** Returns [r, g, b, a] (0-255 each), or null if out of bounds or the
   * canvas turned out to be tainted (sampling degrades gracefully to "no
   * data" rather than crashing the viewer). */
  sample(x: number, y: number): [number, number, number, number] | null;
}

export function loadPixelSampler(url: string): Promise<PixelSampler> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2d canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0);

      let imageData: ImageData | null = null;
      let taintedLogged = false;

      resolve({
        width,
        height,
        sample(x: number, y: number) {
          if (x < 0 || y < 0 || x >= width || y >= height) return null;
          if (!imageData) {
            try {
              imageData = ctx.getImageData(0, 0, width, height);
            } catch (err) {
              if (!taintedLogged) {
                console.warn(
                  "PixelSampler: canvas is tainted, pixel inspection unavailable",
                  err,
                );
                taintedLogged = true;
              }
              return null;
            }
          }
          const idx = (y * width + x) * 4;
          const d = imageData.data;
          return [d[idx], d[idx + 1], d[idx + 2], d[idx + 3]];
        },
      });
    };
    img.onerror = () =>
      reject(new Error(`failed to load image for pixel sampling: ${url}`));
    img.src = url;
  });
}
