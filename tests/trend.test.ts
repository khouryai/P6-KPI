/**
 * Which way the job is moving.
 *
 * Every other figure reports a position. This one reports direction, and the thing
 * it must not do is manufacture a direction out of a calendar artefact — a quiet
 * December must not read as a collapsing rate every January.
 */
import { describe, it, expect } from 'vitest';
import { trendFrom, direction } from '../src/engine/trend';
import type { BurnRow } from '../src/engine/types';

let cumE = 0;
let cumB = 0;
const reset = () => {
  cumE = 0;
  cumB = 0;
};
const row = (month: string, earned: number, built: number): BurnRow => {
  cumE += earned;
  cumB += built;
  return {
    month,
    earned,
    built,
    variance: earned - built,
    cumEarned: cumE,
    cumBuilt: cumB,
    cumVariance: cumE - cumB,
    factor: built ? earned / built : null,
    bySubsystem: [],
  };
};

describe('reading the trend off the monthly rows', () => {
  it('reports the recent window against the one before it', () => {
    reset();
    // Three months at 0.5, then three at 1.0: clearly improving.
    const months = [
      row('2026-01', 50, 100), row('2026-02', 50, 100), row('2026-03', 50, 100),
      row('2026-04', 100, 100), row('2026-05', 100, 100), row('2026-06', 100, 100),
    ];
    const t = trendFrom(months, 1000, 3);
    expect(t.priorFactor).toBeCloseTo(0.5, 9);
    expect(t.recentFactor).toBeCloseTo(1.0, 9);
    expect(direction(t.recentFactor, t.priorFactor)).toBe('better');
  });

  it('calls a small move flat rather than a trend', () => {
    expect(direction(1.01, 1.0, 0.03)).toBe('flat');
    expect(direction(1.1, 1.0, 0.03)).toBe('better');
    expect(direction(0.9, 1.0, 0.03)).toBe('worse');
  });

  it('says nothing when there is nothing to compare with', () => {
    reset();
    const t = trendFrom([row('2026-01', 50, 100)], 1000, 3);
    expect(t.priorFactor).toBeNull();
    expect(direction(t.recentFactor, t.priorFactor)).toBe('unknown');
  });

  it('drops quiet months before taking the windows', () => {
    /*
     * Without this, a shutdown month sits in the recent window as a zero and drags
     * the average down — a fact about the calendar reported as a fact about the work.
     */
    reset();
    const months = [
      row('2026-01', 100, 100), row('2026-02', 0, 0), row('2026-03', 100, 100),
    ];
    const t = trendFrom(months, 1000, 3);
    expect(t.points.map((p) => p.month)).toEqual(['2026-01', '2026-03']);
    expect(t.recentFactor).toBeCloseTo(1, 9);
  });

  it('reports percentage points gained in each month', () => {
    reset();
    const months = [row('2026-01', 100, 100), row('2026-02', 150, 100)];
    const t = trendFrom(months, 1000, 2);
    expect(t.points[0].pctGained).toBeCloseTo(0.1, 9);
    expect(t.points[1].pctGained).toBeCloseTo(0.15, 9);
    expect(t.points[1].pctComplete).toBeCloseTo(0.25, 9);
  });

  it('projects the finish from the recent pace', () => {
    reset();
    // 10% a month, 25% done: seven and a half months of work left.
    const months = [row('2026-01', 100, 100), row('2026-02', 150, 100)];
    const t = trendFrom(months, 1000, 2);
    expect(t.monthsToFinish).toBeCloseTo(0.75 / 0.125, 6);
  });

  it('refuses to project a finish when nothing is moving', () => {
    // Dividing by a zero pace would produce a date rather than an admission.
    reset();
    const months = [row('2026-01', 0, 100), row('2026-02', 0, 100)];
    const t = trendFrom(months, 1000, 2);
    expect(t.monthsToFinish).toBeNull();
    expect(t.recentFactor).toBeCloseTo(0, 9);
  });

  it('carries the cumulative factor alongside the monthly one', () => {
    reset();
    const months = [row('2026-01', 50, 100), row('2026-02', 150, 100)];
    const t = trendFrom(months, 1000, 2);
    expect(t.points[1].factor).toBeCloseTo(1.5, 9);
    expect(t.points[1].cumFactor).toBeCloseTo(1.0, 9);
  });
});
