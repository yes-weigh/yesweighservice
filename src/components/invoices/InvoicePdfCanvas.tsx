import React, { useEffect, useRef, useState } from 'react';
import { FetchingLoader } from '../FetchingLoader';
import { pdfjs } from '../../lib/pdfjsSetup';

export const InvoicePdfCanvas: React.FC<{ data: Uint8Array }> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setRendering(true);
    setError('');
    container.replaceChildren();

    void (async () => {
      try {
        // pdf.js transfers the buffer to its worker; keep a copy for React strict-mode remounts.
        const pdf = await pdfjs.getDocument({ data: data.slice() }).promise;

        await new Promise<void>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        if (cancelled) return;

        const containerWidth = Math.max(container.clientWidth, window.innerWidth - 24, 280);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          if (cancelled) return;

          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(Math.max((containerWidth - 12) / baseViewport.width, 0.5), 2.5);
          const viewport = page.getViewport({ scale });
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);

          const canvas = document.createElement('canvas');
          canvas.className = 'invoice-detail-pdf__page';
          const context = canvas.getContext('2d');
          if (!context) continue;

          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          context.scale(outputScale, outputScale);

          container.appendChild(canvas);
          await page.render({
            canvasContext: context,
            viewport,
            canvas,
          }).promise;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render PDF.');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    <div className="invoice-detail-pdf__canvas-wrap">
      {rendering && (
        <div className="invoice-detail-pdf__canvas-loading">
          <FetchingLoader label="Rendering invoice…" />
        </div>
      )}
      {error && (
        <p className="invoice-detail-pdf__canvas-error text-sm">{error}</p>
      )}
      <div ref={containerRef} className="invoice-detail-pdf__canvas" />
    </div>
  );
};
