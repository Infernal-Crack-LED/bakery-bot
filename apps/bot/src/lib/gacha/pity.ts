/**
 * Pity / pull calculator for NIKKE recruitment.
 *
 * PURE math (no I/O, no clock) so it's trivially unit-testable — mirrors the
 * style of discordTime.ts. The probability helpers are game-agnostic; the
 * exported NIKKE_* constants are the documented defaults and can be overridden
 * by the caller. We deliberately model only the two mechanics that are exact
 * and well-known — the per-pull SSR rate and the Gold Mileage "hard pity"
 * ceiling — rather than inventing gem/voucher costs that vary by shop and event.
 */

/** NIKKE Advanced Recruit base SSR rate (per pull). */
export const NIKKE_SSR_RATE = 0.04;
/** Gold Mileage earned per Advanced Recruit pull. */
export const NIKKE_MILEAGE_PER_PULL = 1;
/** Gold Mileage needed to exchange for a guaranteed SSR of choice (hard pity). */
export const NIKKE_MILEAGE_TARGET = 200;

/** Probability of AT LEAST ONE success across `pulls` at per-pull `rate`. */
export function probAtLeastOne(pulls: number, rate: number): number {
  if (pulls <= 0) {
    return 0;
  }
  const p = clampRate(rate);
  return 1 - Math.pow(1 - p, pulls);
}

/** Expected number of successes across `pulls` at per-pull `rate` (n·p). */
export function expectedCount(pulls: number, rate: number): number {
  if (pulls <= 0) {
    return 0;
  }
  return pulls * clampRate(rate);
}

/**
 * Smallest number of pulls for which the cumulative chance of at least one
 * success reaches `confidence` (0-1). E.g. how many pulls to be 90% sure of an
 * SSR. Returns Infinity if confidence is 1 (never guaranteed by rate alone).
 */
export function pullsForConfidence(rate: number, confidence: number): number {
  const c = Math.max(0, Math.min(1, confidence));
  if (c <= 0) {
    return 0;
  }
  if (c >= 1) {
    return Infinity;
  }
  const p = clampRate(rate);
  if (p <= 0) {
    return Infinity;
  }
  // 1-(1-p)^n >= c  →  n >= ln(1-c)/ln(1-p)
  return Math.ceil(Math.log(1 - c) / Math.log(1 - p));
}

/**
 * Pulls still needed to reach a mileage target (hard pity) from `current`
 * mileage. Zero once the target is already met.
 */
export function pullsToMileage(
  current: number,
  target: number = NIKKE_MILEAGE_TARGET,
  perPull: number = NIKKE_MILEAGE_PER_PULL
): number {
  const remaining = target - Math.max(0, current);
  if (remaining <= 0) {
    return 0;
  }
  if (perPull <= 0) {
    return Infinity;
  }
  return Math.ceil(remaining / perPull);
}

/** Options for {@link summarizePulls}; all optional with NIKKE defaults. */
export interface PityOptions {
  /** Current Gold Mileage before these pulls (default 0). */
  currentMileage?: number;
  /** Per-pull SSR rate (default {@link NIKKE_SSR_RATE}). */
  ssrRate?: number;
  /** Mileage per pull (default {@link NIKKE_MILEAGE_PER_PULL}). */
  mileagePerPull?: number;
  /** Mileage hard-pity target (default {@link NIKKE_MILEAGE_TARGET}). */
  mileageTarget?: number;
}

/** A ready-to-render summary of what a planned number of pulls yields. */
export interface PitySummary {
  pulls: number;
  ssrRate: number;
  /** Expected SSR count over the pulls (n·p). */
  expectedSsr: number;
  /** Chance of at least one SSR over the pulls (0-1). */
  chanceAtLeastOneSsr: number;
  /** Mileage after these pulls (current + pulls·perPull). */
  mileageAfter: number;
  /** Pulls remaining from `current` to reach the pity target. */
  pullsToPity: number;
  /** True when these pulls alone reach the pity target (guaranteed SSR). */
  guaranteedAtPity: boolean;
}

/**
 * Summarize a planned number of pulls: expected SSRs, chance of ≥1 SSR, and
 * mileage/hard-pity progress. Negative/NaN `pulls` are treated as 0.
 */
export function summarizePulls(
  pulls: number,
  opts: PityOptions = {}
): PitySummary {
  const n = Number.isFinite(pulls) && pulls > 0 ? Math.floor(pulls) : 0;
  const ssrRate = clampRate(opts.ssrRate ?? NIKKE_SSR_RATE);
  const perPull = opts.mileagePerPull ?? NIKKE_MILEAGE_PER_PULL;
  const target = opts.mileageTarget ?? NIKKE_MILEAGE_TARGET;
  const current = Math.max(0, opts.currentMileage ?? 0);

  const mileageAfter = current + n * perPull;
  return {
    pulls: n,
    ssrRate,
    expectedSsr: expectedCount(n, ssrRate),
    chanceAtLeastOneSsr: probAtLeastOne(n, ssrRate),
    mileageAfter,
    pullsToPity: pullsToMileage(current, target, perPull),
    guaranteedAtPity: mileageAfter >= target,
  };
}

/** Clamp a probability into [0, 1]; non-finite → 0. */
function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }
  return Math.max(0, Math.min(1, rate));
}
