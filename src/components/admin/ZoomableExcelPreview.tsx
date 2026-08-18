import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { parseVendorPiExcel, type VendorPiExcelTotal } from '../../lib/vendorPiExcel';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

type Props = {
  data: Uint8Array;
  onTotalDetected?: (total: VendorPiExcelTotal) => void;
};

/** Excel grid preview with fit-width default, pinch/wheel zoom, and drag/scroll pan. */
export const ZoomableExcelPreview: React.FC<Props> = ({ data, onTotalDetected }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const parsed = useMemo(() => {
    try {
      return { grid: parseVendorPiExcel(data), error: '' };
    } catch (err) {
      return {
        grid: null,
        error: err instanceof Error ? err.message : 'Could not read this Excel file.',
      };
    }
  }, [data]);
  const grid = parsed.grid;
  const error = parsed.error;
  const reportedMeta = useRef<string>('');
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);

  useEffect(() => {
    reportedMeta.current = '';
    setSelected(null);
  }, [data]);

  useEffect(() => {
    if (!grid) return;
    const key = `${grid.totalAmount ?? ''}:${grid.currencyCode ?? ''}:${grid.piDate ?? ''}`;
    if (reportedMeta.current === key) return;
    reportedMeta.current = key;
    onTotalDetected?.({
      amount: grid.totalAmount ?? 0,
      currencyCode: grid.currencyCode,
      piDate: grid.piDate,
    });
  }, [grid, onTotalDetected]);

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

  const colCount = grid?.cells.reduce((max, row) => Math.max(max, row.length), 0) ?? 0;
  const mergeKey = (r: number, c: number) => (
    grid?.merges.find(merge => merge.r === r && merge.c === c) ?? null
  );
  const isCovered = (r: number, c: number) => (
    Boolean(grid?.merges.some(merge => (
      r >= merge.r
      && r < merge.r + merge.rowspan
      && c >= merge.c
      && c < merge.c + merge.colspan
      && !(r === merge.r && c === merge.c)
    )))
  );

  const colLabel = (index: number) => {
    let n = index;
    let label = '';
    while (n >= 0) {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  };

  const selectedText = selected && grid
    ? (grid.cells[selected.r]?.[selected.c] || '')
    : '';
  const selectedRef = selected
    ? `${colLabel(selected.c)}${selected.r + 1}`
    : '';
  const isNumericCell = (text: string) => /^-?[\d,.]+$/.test(text.trim());

  return (
    <div className="courier-slip-pdf po-pi-excel">
      <div className="courier-slip-pdf__toolbar" role="toolbar" aria-label="Excel zoom">
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
          aria-label="Fit to screen"
          title="Fit to screen"
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
      {grid && grid.cells.length > 0 ? (
        <div className="po-pi-excel__formula" aria-hidden={!selectedText}>
          <span className="po-pi-excel__formula-fx">fx</span>
          <span className="po-pi-excel__formula-ref">{selectedRef || 'A1'}</span>
          <span className="po-pi-excel__formula-value">{selectedText || grid.cells[0]?.[0] || ''}</span>
        </div>
      ) : null}
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
        {error ? (
          <p className="courier-slip-pdf__error text-sm">{error}</p>
        ) : !grid ? (
          <div className="courier-slip-pdf__loading">
            <FetchingLoader label="Loading Excel…" />
          </div>
        ) : grid.cells.length === 0 ? (
          <p className="courier-slip-pdf__error text-sm">This spreadsheet is empty.</p>
        ) : (
          <div
            className="po-pi-excel__stage"
            style={{ width: `${Math.max(zoom * 100, 100)}%` }}
          >
            <table className="po-pi-excel__table">
              <thead>
                <tr>
                  <th className="po-pi-excel__corner" aria-hidden />
                  {Array.from({ length: colCount }, (_, colIndex) => (
                    <th key={colIndex} className="po-pi-excel__col-head">{colLabel(colIndex)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.cells.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <th className="po-pi-excel__row-head">{rowIndex + 1}</th>
                    {Array.from({ length: colCount }, (_, colIndex) => {
                      if (isCovered(rowIndex, colIndex)) return null;
                      const merge = mergeKey(rowIndex, colIndex);
                      const text = row[colIndex] || '';
                      const isSelected = selected?.r === rowIndex && selected?.c === colIndex;
                      return (
                        <td
                          key={colIndex}
                          colSpan={merge?.colspan}
                          rowSpan={merge?.rowspan}
                          className={[
                            isNumericCell(text) ? 'is-numeric' : '',
                            isSelected ? 'is-selected' : '',
                          ].filter(Boolean).join(' ')}
                          onPointerDown={event => {
                            event.stopPropagation();
                            setSelected({ r: rowIndex, c: colIndex });
                          }}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {grid && grid.cells.length > 0 ? (
        <div className="po-pi-excel__tabs">
          <span className="po-pi-excel__tab is-active">{grid.sheetName}</span>
        </div>
      ) : null}
    </div>
  );
};
