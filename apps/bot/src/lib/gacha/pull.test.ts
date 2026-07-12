import { describe, expect, it } from 'vitest';
import {
  MAX_LIMIT_BREAK_COPIES,
  NIKKE_BANNER_PILGRIM_RATE,
  NIKKE_BANNER_SSR_RATE,
  NIKKE_SSR_RATE,
  binomExactly,
  expectedCount,
  probAtLeast,
  probAtLeastOne,
  summarizePull,
} from './pull.js';

/**
 * Unit tests for the pure pull-odds math. Values are checked against
 * closed-form binomial results so nothing depends on randomness or the clock.
 */

describe('probAtLeastOne', () => {
  it('is 0 for no pulls', () => {
    expect(probAtLeastOne(0, 0.04)).toBe(0);
  });

  it('matches 1-(1-p)^n', () => {
    expect(probAtLeastOne(1, 0.04)).toBeCloseTo(0.04, 10);
    expect(probAtLeastOne(100, 0.04)).toBeCloseTo(1 - Math.pow(0.96, 100), 10);
  });

  it('clamps out-of-range rates', () => {
    expect(probAtLeastOne(5, 2)).toBe(1);
    expect(probAtLeastOne(5, -1)).toBe(0);
  });
});

describe('expectedCount', () => {
  it('is n*p', () => {
    expect(expectedCount(100, 0.04)).toBeCloseTo(4, 10);
    expect(expectedCount(100, 0.02)).toBeCloseTo(2, 10);
    expect(expectedCount(0, 0.04)).toBe(0);
  });

  it('treats negative/NaN pulls as zero', () => {
    expect(expectedCount(-5, 0.04)).toBe(0);
    expect(expectedCount(NaN, 0.04)).toBe(0);
  });
});

describe('binomExactly', () => {
  it('gives the (1-p)^n miss chance for exactly 0 copies', () => {
    expect(binomExactly(100, 0, 0.02)).toBeCloseTo(Math.pow(0.98, 100), 10);
  });

  it('matches C(n,k)·p^k·(1-p)^(n-k) for a small k', () => {
    // Exactly 1 rate-up SSR in 100 pulls: 100·0.02·0.98^99.
    expect(binomExactly(100, 1, 0.02)).toBeCloseTo(
      100 * 0.02 * Math.pow(0.98, 99),
      10
    );
  });

  it('is 0 when copies exceed pulls or go negative', () => {
    expect(binomExactly(3, 4, 0.5)).toBe(0);
    expect(binomExactly(10, -1, 0.5)).toBe(0);
  });
});

describe('probAtLeast', () => {
  it('is certain for zero or fewer copies', () => {
    expect(probAtLeast(100, 0, 0.02)).toBe(1);
    expect(probAtLeast(100, -3, 0.02)).toBe(1);
  });

  it('equals probAtLeastOne for exactly one copy', () => {
    expect(probAtLeast(100, 1, 0.02)).toBeCloseTo(
      probAtLeastOne(100, 0.02),
      10
    );
  });

  it('matches the hand-computed cumulative for 100 pulls at 2%', () => {
    // 1 - P(0) - P(1) = chance of ≥2 rate-up copies ≈ 0.597.
    const p0 = Math.pow(0.98, 100);
    const p1 = 100 * 0.02 * Math.pow(0.98, 99);
    expect(probAtLeast(100, 2, 0.02)).toBeCloseTo(1 - p0 - p1, 10);
  });

  it('is monotonically non-increasing as the copy threshold rises', () => {
    const a1 = probAtLeast(100, 1, 0.02);
    const a2 = probAtLeast(100, 2, 0.02);
    const a3 = probAtLeast(100, 3, 0.02);
    expect(a1).toBeGreaterThan(a2);
    expect(a2).toBeGreaterThan(a3);
  });
});

describe('summarizePull', () => {
  it('summarizes 100 pulls with the NIKKE defaults', () => {
    const s = summarizePull(100);
    expect(s.pulls).toBe(100);
    expect(s.maxCopies).toBe(MAX_LIMIT_BREAK_COPIES);

    // Any SSR: 4 expected, ~98.3% for at least one.
    expect(s.anySsr.rate).toBe(NIKKE_SSR_RATE);
    expect(s.anySsr.expected).toBeCloseTo(4, 10);
    expect(s.anySsr.atLeastOne).toBeCloseTo(1 - Math.pow(0.96, 100), 10);

    const rateUp = s.banners.find((b) => b.key === 'rate-up');
    const pilgrim = s.banners.find((b) => b.key === 'pilgrim');
    expect(rateUp?.rate).toBe(NIKKE_BANNER_SSR_RATE);
    expect(pilgrim?.rate).toBe(NIKKE_BANNER_PILGRIM_RATE);

    // Four cumulative tiers each (≥1 … ≥4/MLB), highest first-copy odds.
    expect(rateUp?.atLeast).toHaveLength(4);
    expect(rateUp?.expected).toBeCloseTo(2, 10);
    expect(rateUp?.atLeast[0]).toBeCloseTo(0.8674, 3); // ≥1
    expect(rateUp?.atLeast[3]).toBeCloseTo(0.1409, 3); // ≥4 (MLB)
    expect(pilgrim?.expected).toBeCloseTo(1, 10);
    expect(pilgrim?.atLeast[0]).toBeCloseTo(0.634, 3); // ≥1
    expect(pilgrim?.atLeast[3]).toBeCloseTo(0.0184, 3); // ≥4 (MLB)
  });

  it('clamps negative pulls to zero (all odds vanish)', () => {
    const s = summarizePull(-5);
    expect(s.pulls).toBe(0);
    expect(s.anySsr.atLeastOne).toBe(0);
    expect(s.banners[0].atLeast.every((p) => p === 0)).toBe(true);
  });

  it('honors custom banners and copy depth', () => {
    const s = summarizePull(50, {
      banners: [{ key: 'x', label: 'Test', rate: 0.5 }],
      maxCopies: 2,
    });
    expect(s.banners).toHaveLength(1);
    expect(s.banners[0].atLeast).toHaveLength(2);
    expect(s.banners[0].expected).toBeCloseTo(25, 10);
  });
});
