import { useCallback, useSyncExternalStore } from 'react';

/**
 * Man hours, or percent complete.
 *
 * The client does not care that a job is 93,240 hours. They care that it is 13%
 * done, and an hours figure in a client pack invites a conversation about rates
 * that nobody wanted to have. So the Dashboard and the Two-Week Log can drop hours
 * entirely and speak only in percentages.
 *
 * It is one setting shared by both screens rather than a toggle on each, because
 * "I am presenting to the client now" is a mode the person is in, not a property of
 * a page — flipping one screen and finding the other still full of hours would be
 * the whole point missed. It lives in localStorage for the same reason the column
 * layouts do: it is about this person and this machine, and writing it into the
 * OneDrive store would make one person's presentation mode everybody's.
 */
export type Unit = 'hours' | 'percent';

const KEY = 'tc-unit';
const listeners = new Set<() => void>();

function read(): Unit {
  try {
    return localStorage.getItem(KEY) === 'percent' ? 'percent' : 'hours';
  } catch {
    return 'hours';
  }
}

/**
 * Cached, because useSyncExternalStore compares snapshots by identity and calls
 * the getter on every render: reading localStorage each time is both wasteful and,
 * for a value that must stay stable between renders, wrong.
 */
let current: Unit = read();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUnit(next: Unit): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private window: the mode still works, it just will not be remembered */
  }
  for (const fn of listeners) fn();
}

/** The current unit, and a setter. Every screen using this stays in step. */
export function useUnit(): { unit: Unit; percent: boolean; setUnit: (u: Unit) => void; toggle: () => void } {
  const unit = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'hours' as Unit,
  );
  const toggle = useCallback(() => setUnit(current === 'percent' ? 'hours' : 'percent'), []);
  return { unit, percent: unit === 'percent', setUnit, toggle };
}
