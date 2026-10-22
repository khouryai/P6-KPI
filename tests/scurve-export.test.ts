/**
 * What the S-curve picture shows: a curve per phase chosen, in phase order, each
 * with its percent complete against the percent the baseline expected, and points
 * exactly on the data date and today so the two lines sit where they say.
 */
import { describe, it, expect } from 'vitest';
import { computeModel, withPointsAt, buildCurve, curvePointAt } from '../src/engine/compute';
import { scurveChoices, scurvePanels, panelTitle, panelSummary, WHOLE_PROJECT } from '../src/app/scurve';
import { exportFileNames, SCURVE_FILES } from '../src/app/exportSchedule';
import { makeActivity } from './helpers';
import type { ModelInput } from '../src/engine/types';
import { DEFAULT_SETTINGS } from '../src/engine/types';

const settings = { ...DEFAULT_SETTINGS, dataDate: '2026-09-15', defaultCrew: 1, defaultShiftHours: 8, defaultComplexity: 1 };

/** Phase 2 runs August, half done; phase 3 runs September to October, not started; phase 10 is later. */
function input(): ModelInput {
  const act = (id: string, start: string, finish: string, sortOrder: number) =>
    makeActivity({ activityId: id, startDate: start, finishDate: finish, originalDuration: 10, sortOrder });
  return {
    settings,
    locations: [{ code: 'X10' }],
    library: [{ matchKey: 'Test Type', basis: 'DUR', crewSize: 1, shiftHours: 8 }],
    overrides: [],
    testProgress: [{ activityId: 'A-P2-TC-X10-FA-0010', pctOverride: 0.5, testStartOverride: '2026-08-01', updatedAt: 'x' }],
    current: [
      act('A-P2-TC-X10-FA-0010', '2026-08-01', '2026-08-31', 0),
      act('A-P3-TC-X10-FA-0010', '2026-09-01', '2026-10-31', 1),
      act('A-P10-TC-X10-FA-0010', '2026-11-01', '2026-11-30', 2),
    ],
    baseline: null,
  };
}
const model = computeModel(input());

describe('the S-curve choices', () => {
  it('offers the whole project, then the phases in their own order', () => {
    expect(scurveChoices(model).map((c) => c.key)).toEqual([WHOLE_PROJECT, 'P2', 'P3', 'P10']);
  });

  it('stacks the panels in that order, whatever order they were ticked in', () => {
    const panels = scurvePanels(model, settings, ['P3', 'P2'], '2026-10-01');
    expect(panels.map((p) => p.label)).toEqual(['Phase 2', 'Phase 3']);
  });

  it('drops a phase with no work in the budget rather than drawing an empty chart', () => {
    expect(scurvePanels(model, settings, ['P2', 'P9'], '2026-10-01').map((p) => p.key)).toEqual(['P2']);
  });
});

describe('complete against expected', () => {
  const [p2, p3] = scurvePanels(model, settings, ['P2', 'P3'], '2026-10-01');

  it('takes each phase against its own budget', () => {
    expect(p2.complete).toBeCloseTo(0.5, 10);
    // The baseline (here the current dates) had phase 2 finished by the data date.
    expect(p2.expected).toBeCloseTo(1, 10);
    expect(p3.complete).toBe(0);
    // Phase 3 runs 1 Sep to 31 Oct: 14 of 60 days gone by the 15th.
    expect(p3.expected).toBeCloseTo(14 / 60, 6);
    expect(p3.expectedToday).toBeCloseTo(30 / 60, 6);
  });

  it('says it in the title and under it', () => {
    expect(panelTitle(p2)).toBe('Phase 2:  50.0% complete  ·  100.0% expected');
    const line = panelSummary(p2, { dataDateLabel: '15-Sep-26', todayLabel: '01-Oct-26', hours: false, fmtHours: String });
    expect(line).toContain('expected 100.0% by the data date 15-Sep-26');
    expect(line).toContain('50.0 points behind plan');
    expect(line).toContain('by today 01-Oct-26');
  });
});

describe('points on the data date and today', () => {
  it('adds them to a month-end curve so the lines sit on their dates', () => {
    const rows = model.rows;
    const monthly = buildCurve(rows, settings.dataDate, 'month').curve;
    expect(monthly.some((c) => c.periodEnd === '2026-09-15')).toBe(false);
    const withDates = withPointsAt(monthly, rows, ['2026-09-15', '2026-10-01'], settings.dataDate);
    const dd = withDates.find((c) => c.periodEnd === '2026-09-15')!;
    expect(dd.planned).toBeCloseTo(curvePointAt(rows, '2026-09-15', settings.dataDate).planned, 10);
    // Today is after the data date: nothing is earned on it yet.
    expect(withDates.find((c) => c.periodEnd === '2026-10-01')!.earned).toBeNull();
    expect(withDates.map((c) => c.periodEnd)).toEqual([...withDates.map((c) => c.periodEnd)].sort());
  });

  it('leaves a date outside the curve alone', () => {
    const curve = buildCurve(model.rows, settings.dataDate, 'month').curve;
    expect(withPointsAt(curve, model.rows, ['2030-01-01'], settings.dataDate)).toHaveLength(curve.length);
  });
});

describe('a finished phase', () => {
  it('reaches today on its picture, flat after its last period', () => {
    const [p2] = scurvePanels(model, settings, ['P2'], '2026-10-01');
    const last = p2.curve[p2.curve.length - 1];
    expect(last.periodEnd).toBe('2026-10-01');
    expect(last.plannedPct).toBeCloseTo(1, 10);
  });

  it('says when the earned line falls short of the percent, and why', () => {
    // Phase 3's activity has a P6 percent but no actual start.
    const m = computeModel({ ...input(), current: input().current.map((a) => (a.activityId.startsWith('A-P3') ? { ...a, remainingDuration: 5 } : a)) });
    const [p3] = scurvePanels(m, settings, ['P3'], '2026-10-01');
    expect(p3.complete).toBeCloseTo(0.5, 10);
    expect(p3.earnedOnLine).toBe(0);
    expect(panelSummary(p3, { dataDateLabel: 'd', todayLabel: 't', hours: false, fmtHours: String })).toContain('the earned line reaches 0.0%: the rest has no actual start');
  });
});

describe('the file', () => {
  it('is SCurve_Latest.png, with a dated copy when asked for', () => {
    const when = new Date(2026, 9, 22, 7, 0);
    expect(exportFileNames('latest', when, SCURVE_FILES)).toEqual(['SCurve_Latest.png']);
    expect(exportFileNames('both', when, SCURVE_FILES)).toEqual(['SCurve_2026-10-22_0700.png', 'SCurve_Latest.png']);
  });
});
