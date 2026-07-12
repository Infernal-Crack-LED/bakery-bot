/**
 * Pull-odds calculator for NIKKE recruitment.
 *
 * PURE math (no I/O, no clock) so it's trivially unit-testable — mirrors the
 * style of discordTime.ts. The probability helpers are game-agnostic; the
 * exported NIKKE_* rate constants are the documented defaults and can be
 * overridden by the caller.
 *
 * Each pull is an independent trial, so the number of copies of a given unit
 * across `n` pulls is Binomial(n, rate). We report CUMULATIVE odds ("≥k copies")
 * because that's what players actually plan around — copies map to limit breaks,
 * and 4 copies is a max limit break (MLB). We deliberately model only the
 * per-pull rates (the exact, well-documented numbers) and not gem/voucher costs
 * or mileage spark mechanics, which vary by shop/event and would be guesswork.
 */

/** NIKKE base rate for ANY SSR (per pull). */
export const NIKKE_SSR_RATE = 0.04;
/** Featured rate-up SSR on a normal banner (per pull). */
export const NIKKE_BANNER_SSR_RATE = 0.02;
/** Featured Pilgrim on a Pilgrim banner (per pull). */
export const NIKKE_BANNER_PILGRIM_RATE = 0.01;
/** Copies of one unit that make a max limit break (0★ → 3★). */
export const MAX_LIMIT_BREAK_COPIES = 4;

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
  const n = asPullCount(pulls);
  if (n <= 0) {
    return 0;
  }
  return n * clampRate(rate);
}

/**
 * Binomial probability of EXACTLY `copies` successes in `pulls` trials at
 * per-pull `rate`. Computed as C(n,k)·p^k·(1-p)^(n-k); for the small `k` we use
 * (copies ≤ ~a handful) the binomial coefficient is built by an exact product,
 * so there is no factorial overflow.
 */
export function binomExactly(
  pulls: number,
  copies: number,
  rate: number
): number {
  const n = asPullCount(pulls);
  const k = Math.trunc(copies);
  if (k < 0 || k > n) {
    return 0;
  }
  const p = clampRate(rate);
  let coeff = 1;
  for (let i = 0; i < k; i++) {
    coeff = (coeff * (n - i)) / (i + 1);
  }
  return coeff * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

/**
 * Cumulative probability of AT LEAST `copies` successes in `pulls` trials.
 * `copies` ≤ 0 is always certain (1). Computed as 1 minus the tail below `k`.
 */
export function probAtLeast(
  pulls: number,
  copies: number,
  rate: number
): number {
  const k = Math.trunc(copies);
  if (k <= 0) {
    return 1;
  }
  let below = 0;
  for (let j = 0; j < k; j++) {
    below += binomExactly(pulls, j, rate);
  }
  return Math.max(0, 1 - below);
}

/** A banner/unit whose copy odds we want to report. */
export interface BannerRate {
  /** Short key used in the compact header (e.g. "rate-up"). */
  key: string;
  /** Display label used in the table (e.g. "Rate-up SSR"). */
  label: string;
  /** Per-pull rate for landing one copy of this unit. */
  rate: number;
}

/** The two featured-unit banners NIKKE `/pull` reports by default. */
export const NIKKE_BANNERS: BannerRate[] = [
  { key: 'rate-up', label: 'Rate-up SSR', rate: NIKKE_BANNER_SSR_RATE },
  { key: 'pilgrim', label: 'Pilgrim', rate: NIKKE_BANNER_PILGRIM_RATE },
];

/** Cumulative copy odds for one featured unit over a planned number of pulls. */
export interface UnitCopyOdds {
  key: string;
  label: string;
  rate: number;
  /** Expected copies over the pulls (n·rate). */
  expected: number;
  /** atLeast[i] = P(at least i+1 copies); length === maxCopies. */
  atLeast: number[];
}

/** Options for {@link summarizePull}; all optional with NIKKE defaults. */
export interface PullOptions {
  /** Base rate for "any SSR" (default {@link NIKKE_SSR_RATE}). */
  anySsrRate?: number;
  /** Featured banners to report (default {@link NIKKE_BANNERS}). */
  banners?: BannerRate[];
  /** Highest copy count to report per unit (default {@link MAX_LIMIT_BREAK_COPIES}). */
  maxCopies?: number;
}

/** A ready-to-render summary of what a planned number of pulls yields. */
export interface PullSummary {
  pulls: number;
  maxCopies: number;
  /** Headline "any SSR" line: expected count and chance of at least one. */
  anySsr: { rate: number; expected: number; atLeastOne: number };
  /** Per-featured-unit cumulative copy odds. */
  banners: UnitCopyOdds[];
}

/**
 * Summarize a planned number of pulls: the expected count and ≥1 odds for any
 * SSR, plus cumulative copy odds (≥1 … ≥maxCopies) for each featured unit.
 * Negative/NaN `pulls` are treated as 0.
 */
export function summarizePull(
  pulls: number,
  opts: PullOptions = {}
): PullSummary {
  const n = asPullCount(pulls);
  const anySsrRate = clampRate(opts.anySsrRate ?? NIKKE_SSR_RATE);
  const banners = opts.banners ?? NIKKE_BANNERS;
  const maxCopies = Math.max(
    1,
    Math.trunc(opts.maxCopies ?? MAX_LIMIT_BREAK_COPIES)
  );

  return {
    pulls: n,
    maxCopies,
    anySsr: {
      rate: anySsrRate,
      expected: expectedCount(n, anySsrRate),
      atLeastOne: probAtLeastOne(n, anySsrRate),
    },
    banners: banners.map((b) => {
      const rate = clampRate(b.rate);
      const atLeast: number[] = [];
      for (let k = 1; k <= maxCopies; k++) {
        atLeast.push(probAtLeast(n, k, rate));
      }
      return {
        key: b.key,
        label: b.label,
        rate,
        expected: expectedCount(n, rate),
        atLeast,
      };
    }),
  };
}

/** Coerce a pull count to a non-negative integer; non-finite/negative → 0. */
function asPullCount(pulls: number): number {
  return Number.isFinite(pulls) && pulls > 0 ? Math.floor(pulls) : 0;
}

/** Clamp a probability into [0, 1]; non-finite → 0. */
function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }
  return Math.max(0, Math.min(1, rate));
}
