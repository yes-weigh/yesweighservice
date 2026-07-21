import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { pdfjs } from '../../lib/pdfjsSetup';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

type Props = {
  data: Uint8Array;
};

/** PDF canvas preview with fit-width default, pinch/wheel zoom, and drag/scroll pan. */
export const ZoomablePdfPreview: React.FC<Props> = ({ data }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');
  const [fitWidthPx, setFitWidthPx] = useState(0);
  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const pinchRef = useRef<{
    active: boolean;
    startDistance: number;
    startZoom: number;
  }>({ active: false, startDistance: 0, startZoom: 1 });

  const clampZoom = useCallback((value: number) => (
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
  ), []);

  const setZoomAroundCenter = useCallback((nextZoom: number) => {
    const viewport = viewportRef.current;
    const clamped = clampZoom(nextZoom);
    if (!viewport) {
      setZoom(clamped);
      return;
    }
    const prevZoom = zoom;
    if (clamped === prevZoom) return;

    const rect = viewport.getBoundingClientRect();
    const centerX = viewport.scrollLeft + rect.width / 2;
    const centerY = viewport.scrollTop + rect.height / 2;
    const ratio = clamped / prevZoom;

    setZoom(clamped);
    requestAnimationFrame(() => {
      viewport.scrollLeft = centerX * ratio - rect.width / 2;
      viewport.scrollTop = centerY * ratio - rect.height / 2;
    });
  }, [clampZoom, zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const render = async () => {
      setRendering(true);
      setError('');
      stage.replaceChildren();

      try {
        const pdf = await pdfjs.getDocument({ data: data.slice() }).promise;
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        if (cancelled) return;

        const containerWidth = Math.max(viewport.clientWidth - 8, 240);
        setFitWidthPx(containerWidth);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          // Render sharp enough for up to ~2.5× zoom on fit-width.
          const renderScale = Math.min(
            Math.max((containerWidth * 2.5) / baseViewport.width, 1),
            4,
          );
          const viewportPdf = page.getViewport({ scale: renderScale });
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);

          const canvas = document.createElement('canvas');
          canvas.className = 'courier-slip-pdf__page';
          const context = canvas.getContext('2d');
          if (!context) continue;

          canvas.width = Math.floor(viewportPdf.width * outputScale);
          canvas.height = Math.floor(viewportPdf.height * outputScale);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

          stage.appendChild(canvas);
          await page.render({
            canvasContext: context,
            viewport: viewportPdf,
            canvas,
          }).promise;
        }

        stage.style.width = `${containerWidth}px`;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render PDF.');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void render();

    resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(viewport.clientWidth - 8, 240);
      setFitWidthPx(nextWidth);
    });
    resizeObserver.observe(viewport);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [data]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoomAroundCenter(zoom + delta);
    };

    const onTouchMoveNative = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch.active || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = [event.touches[0], event.touches[1]];
      const current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.startDistance <= 0) return;
      setZoomAroundCenter(pinch.startZoom * (current / pinch.startDistance));
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('touchmove', onTouchMoveNative, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('touchmove', onTouchMoveNative);
    };
  }, [setZoomAroundCenter, zoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag.active || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    viewport?.classList.remove('is-panning');
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      pinchRef.current = {
        active: true,
        startDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        startZoom: zoom,
      };
    }
  };

  const onTouchEnd = () => {
    if (pinchRef.current.active) {
      pinchRef.current.active = false;
    }
  };

  const stageWidth = fitWidthPx > 0 ? fitWidthPx * zoom : undefined;

  return (
    <div className="courier-slip-pdf">
      <div className="courier-slip-pdf__toolbar" role="toolbar" aria-label="PDF zoom">
        <button
          type="button"
          className="courier-slip-pdf__zoom-btn"
          onClick={() => setZoomAroundCenter(zoom - ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          className="courier-slip-pdf__zoom-btn courier-slip-pdf__zoom-fit"
          onClick={() => {
            setZoom(1);
            const viewport = viewportRef.current;
            if (viewport) {
              viewport.scrollLeft = 0;
              viewport.scrollTop = 0;
            }
          }}
          aria-label="Fit width"
          title="Fit width"
        >
          <Maximize2 size={14} aria-hidden />
          Fit
        </button>
        <button
          type="button"
          className="courier-slip-pdf__zoom-btn"
          onClick={() => setZoomAroundCenter(zoom + ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <Plus size={16} />
        </button>
        <span className="courier-slip-pdf__zoom-label">{Math.round(zoom * 100)}%</span>
      </div>

      <div
        ref={viewportRef}
        className="courier-slip-pdf__viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {rendering && (
          <div className="courier-slip-pdf__loading">
            <FetchingLoader label="Rendering slip…" />
          </div>
        )}
        {error && <p className="courier-slip-pdf__error text-sm">{error}</p>}
        <div
          ref={stageRef}
          className="courier-slip-pdf__stage"
          style={stageWidth ? { width: `${stageWidth}px` } : undefined}
        />
      </div>
    </div>
  );
};
