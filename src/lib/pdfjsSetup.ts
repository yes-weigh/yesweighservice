/**
 * Shared pdf.js bootstrap.
 *
 * Modern pdfjs-dist builds call Map.prototype.getOrInsertComputed, which many
 * Android WebViews still lack. Use the legacy build (polyfilled worker) and
 * install main-thread polyfills first.
 */
import './pdfjsPolyfills';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export { pdfjs };
