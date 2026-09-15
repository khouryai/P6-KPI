/**
 * Notices a newer build and offers to switch to it.
 *
 * Only the served build (http://localhost:47800) has a service worker, and that
 * is the only thing here that touches the network — and only its own origin. The
 * app still makes no call to the internet at runtime. Fetching a new version from
 * GitHub is a deliberate, separate act: Update.cmd. This module's whole job is to
 * spot that the files on disk changed underneath a window that is already open.
 *
 * The single-file build on file:// needs none of this: there is no cache and no
 * worker, so closing and reopening the window always reads the newer file.
 */
import { useEffect, useState } from 'react';
import { IS_STANDALONE } from './build';

type Listener = (ready: boolean) => void;

let ready = false;
let waiting: ServiceWorker | null = null;
let reloading = false;
let switching = false;
const listeners = new Set<Listener>();

function announce(next: boolean) {
  if (ready === next) return;
  ready = next;
  listeners.forEach((fn) => fn(ready));
}

/** True when the app is served over http(s) and can therefore run a worker. */
export function canSelfUpdate(): boolean {
  return !IS_STANDALONE && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && location.protocol.startsWith('http');
}

export function startUpdateWatch(): void {
  if (!canSelfUpdate()) return;

  // A first visit has no controller. The freshly installed worker then claims the
  // page, which fires controllerchange, and reloading on that would bounce the
  // window on every first launch for no gain: the worker is serving the very build
  // the page already loaded. Only a handover to a DIFFERENT build is worth a reload.
  const hadController = !!navigator.serviceWorker.controller;

  // A worker that takes over mid-session would serve new assets to a page running
  // old code. The new worker therefore waits until applyUpdate() releases it.
  const armWaiting = (reg: ServiceWorkerRegistration) => {
    if (!reg.waiting || !navigator.serviceWorker.controller) return;
    waiting = reg.waiting;
    announce(true);
  };

  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      armWaiting(reg);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed') armWaiting(reg);
        });
      });

      // Ask whether sw.js changed whenever the window comes back to the front, and
      // on a slow timer for a window that is simply left open all day. sw.js is
      // served no-cache, so this is a conditional request against localhost.
      const check = () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('focus', check);
      window.setInterval(check, 5 * 60 * 1000);
    })
    .catch((err) => console.warn('service worker registration failed', err));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // Reload when this window asked for the switch, or when another window did and
    // this one was already under a worker. Not on a first visit's initial claim:
    // hadController is false there and nothing asked for a switch.
    if (!switching && !hadController) return;
    reloading = true;
    location.reload();
  });
}

/** Switch to the new build. Reload happens on controllerchange, above. */
export function applyUpdate(): void {
  if (!waiting) {
    location.reload();
    return;
  }
  switching = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // If the worker does not hand over, do not leave the user stuck on a bar that
  // does nothing. A plain reload picks up the new index.html regardless.
  window.setTimeout(() => {
    if (!reloading) {
      reloading = true;
      location.reload();
    }
  }, 3000);
}

export function useUpdateReady(): boolean {
  const [flag, setFlag] = useState(ready);
  useEffect(() => {
    listeners.add(setFlag);
    setFlag(ready);
    return () => {
      listeners.delete(setFlag);
    };
  }, []);
  return flag;
}
