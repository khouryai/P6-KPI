/**
 * Which two weeks the log is showing, remembered.
 *
 * The bug this exists for is small and constant: step back three fortnights, open
 * Budget Master to check an activity, come back — and the log had unmounted, so its
 * `useState` had re-run and the end date had snapped forward to the data date. The
 * person is now reading a different period than the one they left, and nothing on
 * screen says so. The choice therefore lives outside the screen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A localStorage good enough to prove what is written survives, and to fail. */
function fakeStorage(fail = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => {
      if (fail) throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (fail) throw new Error('blocked');
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

/** A fresh module each time: the store caches the value it read at load. */
async function load(storage: ReturnType<typeof fakeStorage>) {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  return import('../src/app/periodWindow');
}

beforeEach(() => vi.unstubAllGlobals());

describe('the remembered window', () => {
  it('follows the data date until somebody chooses an end', () => {
    // null is not "today": it is the log saying it has no opinion yet, so the next
    // import moving the data date still moves an untouched log with it.
    const s = fakeStorage();
    return load(s).then((m) => {
      expect(m.periodWindow()).toEqual({ end: null, span: 14 });
    });
  });

  it('keeps the end date and the span that were chosen', async () => {
    const s = fakeStorage();
    const m = await load(s);
    m.setPeriodEnd('2026-09-09');
    m.setPeriodSpan(28);
    expect(m.periodWindow()).toEqual({ end: '2026-09-09', span: 28 });

    // A fresh load — the app reopened, or the screen was left and come back to.
    const again = await load(s);
    expect(again.periodWindow()).toEqual({ end: '2026-09-09', span: 28 });
  });

  it('hands the window back to the data date when the end is cleared', async () => {
    const m = await load(fakeStorage());
    m.setPeriodEnd('2026-09-09');
    m.setPeriodEnd(null);
    expect(m.periodWindow().end).toBeNull();
  });

  it('ignores a date that is not one, rather than showing a broken window', async () => {
    const m = await load(fakeStorage());
    m.setPeriodEnd('not-a-date');
    expect(m.periodWindow().end).toBeNull();
    m.setPeriodSpan(0);
    expect(m.periodWindow().span).toBe(14);
  });

  it('still works in a private window, where storage throws', async () => {
    const m = await load(fakeStorage(true));
    expect(m.periodWindow()).toEqual({ end: null, span: 14 });
    // The choice holds for the session; it is only the remembering that is lost.
    m.setPeriodEnd('2026-09-09');
    expect(m.periodWindow().end).toBe('2026-09-09');
  });

  it('survives a stored value written by hand and now nonsense', async () => {
    const s = fakeStorage();
    s.map.set('tc-period-window', '{not json');
    expect((await load(s)).periodWindow()).toEqual({ end: null, span: 14 });
    s.map.set('tc-period-window', '{"end":"whenever","span":"lots"}');
    expect((await load(s)).periodWindow()).toEqual({ end: null, span: 14 });
  });
});
