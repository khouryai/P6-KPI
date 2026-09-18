/**
 * Which two weeks the log is showing.
 *
 * It lives here rather than in the screen's own `useState` because a review is not
 * one page: somebody steps back three fortnights on the log, opens Budget Master to
 * check an activity, comes back — and the log had unmounted, so the end date had
 * snapped forward to the data date and they were reading a different period than
 * the one they left. Every other remembered preference in this app works the same
 * way, for the same reason the column layouts and the hours/percent mode do: it is
 * about this person and this machine, so it goes to localStorage and never into the
 * shared OneDrive store, where it would become everybody's.
 *
 * `end` is null until somebody picks one, which is not the same as being set to
 * today's data date: null means "follow the data date", so the log a person has
 * never touched still opens on the current review after the next import moves it.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { isValidISO } from '../engine/dates';

export type PeriodWindow = {
  /** The last day of the window, or null to follow the data date. */
  end: string | null;
  /** How many days the window covers. 7, 14 or 28 on the screen. */
  span: number;
};

const KEY = 'tc-period-window';
const DEFAULT: PeriodWindow = { end: null, span: 14 };
const listeners = new Set<() => void>();

function read(): PeriodWindow {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<PeriodWindow>;
    const span = Number(parsed.span);
    return {
      end: typeof parsed.end === 'string' && isValidISO(parsed.end) ? parsed.end : null,
      span: Number.isFinite(span) && span > 0 ? span : DEFAULT.span,
    };
  } catch {
    // A private window, or a value written by hand and now unreadable. Neither is
    // worth breaking the screen over: the log opens on the current review instead.
    return DEFAULT;
  }
}

/**
 * Cached, because useSyncExternalStore compares snapshots by identity and calls the
 * getter on every render — parsing JSON each time would hand back a new object and
 * spin.
 */
let current: PeriodWindow = read();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** What the log is showing right now, for anything outside a React render. */
export function periodWindow(): PeriodWindow {
  return current;
}

function write(next: PeriodWindow): void {
  if (next.end === current.end && next.span === current.span) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window: the choice still holds for this session, it is just not kept */
  }
  for (const fn of listeners) fn();
}

/** Move the window's end. null hands it back to following the data date. */
export function setPeriodEnd(iso: string | null): void {
  write({ ...current, end: iso && isValidISO(iso) ? iso : null });
}

/** Change how many days the window covers. */
export function setPeriodSpan(days: number): void {
  write({ ...current, span: days > 0 ? days : DEFAULT.span });
}

/**
 * The window the log is on, and the two ways to move it. `end` is what was chosen;
 * a screen resolves null against its own data date, which is the only place that
 * date is known.
 */
export function usePeriodWindow(): {
  end: string | null;
  span: number;
  setEnd: (iso: string | null) => void;
  setSpan: (days: number) => void;
} {
  const w = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT,
  );
  const setEnd = useCallback((iso: string | null) => setPeriodEnd(iso), []);
  const setSpan = useCallback((days: number) => setPeriodSpan(days), []);
  return { end: w.end, span: w.span, setEnd, setSpan };
}
