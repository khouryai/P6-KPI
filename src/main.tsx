import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

declare const __STANDALONE__: boolean;

// The service worker needs a real origin. It is pointless in the single-file build and
// impossible on file://, so it is only registered for the served build.
if (!__STANDALONE__ && location.protocol !== 'file:' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('service worker registration failed', err));
  });
}
