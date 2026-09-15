import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { startUpdateWatch } from './app/update';
import './app/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Registers the service worker and watches for a newer build. It is a no-op in the
// single-file build and on file://, where there is no origin to run a worker on.
if (import.meta.env.PROD) window.addEventListener('load', startUpdateWatch);
