import { describe, expect, it } from 'vitest';
import {
  NIKKE_MILEAGE_TARGET,
  NIKKE_SSR_RATE,
  expectedCount,
  probAtLeastOne,
  pullsForConfidence,
  pullsToMileage,
  summarizePulls,
} from './pity.js';

/**
 * Unit tests for the pure pity/pull math. Values are checked against
 * closed-form results so nothing depends on randomness or the clock.
 */

describe('probAtLeastOne', () => {
  it('is 0 for no pulls', () => {
    expect(probAtLeastOne(0, 0.04)).toBe(0);
  });

  it('matches 1-(1-p)^n', () => {
    expect(probAtLeastOne(1, 0.04)).toBeCloseTo(0.04, 10);
    expect(probAtLeastOne(10, 0.04)).toBeCloseTo(1 - Math.pow(0.96, 10), 10);
  });

  it('clamps out-of-range rates', () => {
    expect(probAtLeastOne(5, 2)).toBe(1);
    expect(probAtLeastOne(5, -1)).toBe(0);
  });
});

describe('expectedCount', () => {
  it('is n*p', () => {
    expect(expectedCount(200, 0.04)).toBeCloseTo(8, 10);
    expect(expectedCount(0, 0.04)).toBe(0);
  });
});

describe('pullsForConfidence', () => {
  it('needs ~57 pulls for 90% at 4%', () => {
    // ceil(ln(0.1)/ln(0.96)) = 57
    expect(pullsForConfidence(0.04, 0.9)).toBe(57);
  });

  it('is 0 at 0 confidence and Infinity at full certainty', () => {
    expect(pullsForConfidence(0.04, 0)).toBe(0);
    expect(pullsForConfidence(0.04, 1)).toBe(Infinity);
  });

  it('is Infinity when the rate is 0', () => {
    expect(pullsForConfidence(0, 0.5)).toBe(Infinity);
  });
});

describe('pullsToMileage', () => {
  it('counts remaining pulls to the pity ceiling', () => {
    expect(pullsToMileage(0)).toBe(NIKKE_MILEAGE_TARGET);
    expect(pullsToMileage(180)).toBe(20);
  });

  it('is 0 once the target is met or exceeded', () => {
    expect(pullsToMileage(200)).toBe(0);
    expect(pullsToMileage(250)).toBe(0);
  });

  it('honors a custom target and per-pull rate', () => {
    expect(pullsToMileage(0, 120, 2)).toBe(60);
  });
});

describe('summarizePulls', () => {
  it('summarizes a plain 10-pull with defaults', () => {
    const s = summarizePulls(10);
    expect(s.pulls).toBe(10);
    expect(s.ssrRate).toBe(NIKKE_SSR_RATE);
    expect(s.expectedSsr).toBeCloseTo(0.4, 10);
    expect(s.chanceAtLeastOneSsr).toBeCloseTo(1 - Math.pow(0.96, 10), 10);
    expect(s.mileageAfter).toBe(10);
    expect(s.pullsToPity).toBe(NIKKE_MILEAGE_TARGET);
    expect(s.guaranteedAtPity).toBe(false);
  });

  it('reaches guaranteed pity from a running mileage', () => {
    const s = summarizePulls(20, { currentMileage: 180 });
    expect(s.mileageAfter).toBe(200);
    expect(s.pullsToPity).toBe(20);
    expect(s.guaranteedAtPity).toBe(true);
  });

  it('clamps negative pulls to zero', () => {
    expect(summarizePulls(-5).pulls).toBe(0);
  });
});
