/**
 * Shared pdf.js bootstrap.
 *
 * Modern pdfjs-dist builds call Map.prototype.getOrInsertComputed, which many
 * Android WebViews still lack. Use the legacy build (polyfilled worker) and
 * install main-thread polyfills first.
 *
 * API and worker must be the same pdfjs-dist version. Vite can prebundle a
 * newer API while `?url` still serves an older worker from node_modules
 * (or a stale PWA cache), which throws:
 * `The API version "…" does not match the Worker version "…"`.
 * Resolve the worker from the same package and bust caches with the API version.
 */
import './pdfjsPolyfills';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const base = import.meta.env.BASE_URL || '/';
const prefix = base.endsWith('/') ? base : `${base}/`;
pdfjs.GlobalWorkerOptions.workerSrc =
  `${prefix}pdfjs/pdf.worker.min.mjs?v=${encodeURIComponent(String(pdfjs.version))}`;

export { pdfjs };
