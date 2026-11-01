import type { OptimizeOptions, ProfileId } from "./types";

/**
 * Initial calibration (Milestone 1 measurements, docs §6/§7).
 * Quality values are on the IJG libjpeg scale used by MuPDF.
 */
export const PROFILES: Record<ProfileId, OptimizeOptions & { label: string; summary: string }> = {
  lossless: {
    profile: "lossless",
    label: "Lossless",
    summary: "Image data untouched. Removes unused and duplicate objects and packs the file structure.",
    jpegQuality: null,
    downsampleAboveDpi: null,
    downsampleToDpi: 300,
    minGain: 0.05,
  },
  high: {
    profile: "high",
    label: "High Quality",
    summary: "JPEG q95, original dimensions. Visually indistinguishable.",
    jpegQuality: 95,
    downsampleAboveDpi: null,
    downsampleToDpi: 300,
    minGain: 0.05,
  },
  balanced: {
    profile: "balanced",
    label: "Balanced",
    summary: "JPEG q90. Images above 400 DPI reduced to 300 DPI.",
    jpegQuality: 90,
    downsampleAboveDpi: 400,
    downsampleToDpi: 300,
    minGain: 0.05,
  },
  compact: {
    profile: "compact",
    label: "Compact",
    summary: "JPEG q85. Images above 250 DPI reduced to 200 DPI. Text stays legible.",
    jpegQuality: 85,
    downsampleAboveDpi: 250,
    downsampleToDpi: 200,
    minGain: 0.05,
  },
};

export const PROFILE_ORDER: ProfileId[] = ["lossless", "high", "balanced", "compact"];

export function optionsFor(id: ProfileId): OptimizeOptions {
  const { label: _l, summary: _s, ...opts } = PROFILES[id];
  return opts;
}
