import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import {
  buildSpareOrderListPdfBlob,
  buildSpareOrderListPdfInput,
  spareOrderListPdfFileName,
} from '../../lib/spareOrderListPdf';
import type { DealerInvoiceDetail } from '../../types/invoices';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import { ZoomablePdfPreview } from '../logistics/ZoomablePdfPreview';

type Props = {
  invoice: DealerInvoiceDetail;
  booking: LogisticsBooking | null;
  onClose: () => void;
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const SpareOrderListViewDialog: React.FC<Props> = ({
  invoice,
  booking,
  onClose,
}) => {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState('order-list.pdf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');
    setPdfBytes(null);
    setBlob(null);

    void (async () => {
      try {
        const input = await buildSpareOrderListPdfInput(invoice, booking);
        if (cancelled) return;
        const name = spareOrderListPdfFileName(input.orderNo);
        setFileName(name);
        const pdfBlob = await buildSpareOrderListPdfBlob(input);
        if (cancelled) return;
        const buffer = await pdfBlob.arrayBuffer();
        if (cancelled) return;
        setBlob(pdfBlob);
        setPdfBytes(new Uint8Array(buffer));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not build order list.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice, booking]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleDownload = useCallback(() => {
    if (!blob) return;
    downloadBlob(blob, fileName);
  }, [blob, fileName]);

  return createPortal(
    <div
      className="dealers-modal-backdrop courier-slip-view-dialog__backdrop"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel glass courier-slip-view-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spare-order-list-view-title"
      >
        <div className="dealers-modal__header courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <h2 id="spare-order-list-view-title">Order list</h2>
            <p className="text-muted text-sm">
              {invoice.invoiceNumber || invoice.id}
              {fileName ? ` · ${fileName}` : ''}
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

        <div className="courier-slip-view-dialog__body">
          {loading && (
            <p className="text-muted text-sm courier-slip-view-dialog__status">
              Preparing order list…
            </p>
          )}
          {!loading && pdfBytes && (
            <ZoomablePdfPreview data={pdfBytes} />
          )}
        </div>

        <div className="dealers-modal__actions courier-slip-view-dialog__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={loading || !blob || Boolean(error)}
          >
            <Download size={16} aria-hidden />
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
