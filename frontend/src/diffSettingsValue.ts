export interface DiffSettingsValue {
  perPixelTolerance: number;
  maxDiffPixels: number;
  minDiffRegionPixels: number;
  allowCenterCrop: boolean;
}

/** The strict defaults: no tolerance, no allowance, no cropping. */
export const DEFAULT_DIFF_SETTINGS: DiffSettingsValue = {
  perPixelTolerance: 0,
  maxDiffPixels: 0,
  minDiffRegionPixels: 1,
  allowCenterCrop: false,
};
