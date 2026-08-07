export const DEFAULT_VIDEO_NEGATIVE_PROMPT =
  "low quality, worst quality, deformed, distorted, blurry, watermark, text, static, jittery motion";

export type SeedanceResolution = "480p" | "720p" | "1080p" | "4K";

/** Seedance 2.0 series tiers. The playground bills against the mainline 2.0 model. */
export type SeedanceTier = "2.0" | "2.0-fast" | "2.0-mini";

/**
 * Official BytePlus pricing examples (Dreamina Seedance 2.0 series, 16:9, 5s output,
 * input without video), normalized to USD per output second.
 *
 * Mainline 2.0: 0.35 / 0.76 / 1.87 / 3.89 USD per 5s video.
 * `null` means the tier does not support that resolution.
 */
export const SEEDANCE_USD_PER_OUTPUT_SECOND: Record<
  SeedanceTier,
  Record<SeedanceResolution, number | null>
> = {
  "2.0": { "480p": 0.35 / 5, "720p": 0.76 / 5, "1080p": 1.87 / 5, "4K": 3.89 / 5 },
  "2.0-fast": { "480p": 0.28 / 5, "720p": 0.6 / 5, "1080p": null, "4K": null },
  "2.0-mini": { "480p": 0.18 / 5, "720p": 0.38 / 5, "1080p": null, "4K": null },
};

/** Default tier used for playground estimates. */
export const DEFAULT_SEEDANCE_TIER: SeedanceTier = "2.0";

/** Backwards-compatible alias: mainline Seedance 2.0 per-second rates. */
export const SEEDANCE_2_USD_PER_OUTPUT_SECOND = SEEDANCE_USD_PER_OUTPUT_SECOND["2.0"];

export function estimateSeedanceVideoCost(
  resolution: SeedanceResolution,
  durationSeconds: number,
  tier: SeedanceTier = DEFAULT_SEEDANCE_TIER,
) {
  const rate =
    SEEDANCE_USD_PER_OUTPUT_SECOND[tier][resolution] ??
    SEEDANCE_USD_PER_OUTPUT_SECOND["2.0"][resolution] ??
    0;
  return rate * durationSeconds;
}
