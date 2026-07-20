import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import {
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../../constants/localPrinterSettings';
import { isNativePrintAvailable } from '../../lib/localPrinterPrint';
import {
  printShippingLabelCanvases,
  tryPrintShippingLabelsThermal,
} from '../../lib/logisticsLabelPrint';
import { buildShippingLabelsFromBooking } from '../../lib/shippingLabel';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import { ShippingLabelBitmapPreview } from './ShippingLabelBitmapPreview';

type Props = {
  booking: LogisticsBooking;
  onClose: () => void;
  /** Called after a successful print (thermal or browser). */
  onPrinted?: () => void;
};

export const ShippingLabelPrintDialog: React.FC<Props> = ({
  booking,
  onClose,
  onPrinted,
}) => {
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const native = isNativePrintAvailable();

  const labels = useMemo(
    () => buildShippingLabelsFromBooking(booking),
    [booking],
  );

  const handlePrint = useCallback(async () => {
    if (!labels.length) {
      setError('No shipping label to print.');
      return;
    }
    setPrinting(true);
    setError('');
    setSuccess('');
    try {
      try {
        const thermal = await tryPrintShippingLabelsThermal(labels);
        if (thermal.usedThermal) {
          setSuccess(
            `Sent ${labels.length} label${labels.length === 1 ? '' : 's'} to the logistics printer `
            + `(${thermal.bytesSent} bytes).`,
          );
          onPrinted?.();
          return;
        }
      } catch (err) {
        const fallback = window.confirm(
          `${err instanceof Error ? err.message : 'Thermal print failed.'}\n\nPrint with the system dialog instead?`,
        );
        if (!fallback) return;
      }

      printShippingLabelCanvases(
        canvasRefs.current,
        `Shipping Label ${booking.consignmentNo || booking.trackingNo}`,
      );
      setSuccess('Opened system print dialog.');
      onPrinted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setPrinting(false);
    }
  }, [labels, booking.consignmentNo, booking.trackingNo, onPrinted]);

  return createPortal(
    <div
      className="dealers-modal-backdrop shipping-label-print-dialog__backdrop"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel glass shipping-label-print-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipping-label-print-title"
      >
        <div className="dealers-modal__header">
          <div>
            <h2 id="shipping-label-print-title">Shipping label</h2>
            <p className="text-muted text-sm">
              {booking.consignmentNo || booking.trackingNo || booking.orderRef}
              {` · ${LOGISTICS_LABEL_WIDTH_MM} × ${LOGISTICS_LABEL_HEIGHT_MM} mm · 203 DPI`}
              {labels.length > 1 ? ` · ${labels.length} labels` : ''}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {error && <p className="dealers-modal__error">{error}</p>}
        {success && <p className="shipping-label-print-dialog__success text-sm">{success}</p>}

        <div className="shipping-label-print-dialog__preview book-courier__label-preview book-courier__label-preview--stack">
          {labels.map((label, index) => (
            <ShippingLabelBitmapPreview
              key={`${label.consignmentNo}-${label.boxIndex}`}
              label={label}
              ref={el => {
                canvasRefs.current[index] = el;
              }}
            />
          ))}
        </div>

        {!native && (
          <p className="text-muted text-sm shipping-label-print-dialog__hint">
            Preview is the exact 203 DPI bitmap. Thermal print uses the YesWeigh Android APK on the same Wi‑Fi as the logistics printer.
            On web, Print opens the system dialog for {LOGISTICS_LABEL_WIDTH_MM}×{LOGISTICS_LABEL_HEIGHT_MM} mm stock.
          </p>
        )}
        {native && (
          <p className="text-muted text-sm shipping-label-print-dialog__hint">
            Preview matches the 203 DPI bitmap sent to the logistics printer (same pixels as print).
            If you see TSPL text/hex on the label, power-cycle the printer to leave dump mode, then print again.
          </p>
        )}

        <div className="dealers-modal__actions shipping-label-print-dialog__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={printing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handlePrint()}
            disabled={printing || labels.length === 0}
          >
            <Printer size={16} aria-hidden />
            {printing ? 'Printing…' : 'Print'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
