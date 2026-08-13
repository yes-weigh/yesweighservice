import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { markInvoiceDelivered } from '../../lib/invoiceManualDelivery';
import type { DealerInvoiceDetail } from '../../types/invoices';

type Props = {
  open: boolean;
  invoice: DealerInvoiceDetail;
  customerId: string;
  invoiceId: string;
  hasLogisticsBooking: boolean;
  onClose: () => void;
  onComplete: (result: Awaited<ReturnType<typeof markInvoiceDelivered>>) => void;
};

export const InvoiceMarkDeliveredDialog: React.FC<Props> = ({
  open,
  invoice,
  customerId,
  invoiceId,
  hasLogisticsBooking,
  onClose,
  onComplete,
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setError('');
  }, [open, invoiceId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await markInvoiceDelivered({ customerId, invoiceId });
      onComplete(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark invoice delivered.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !saving && onClose()}>
      <div
        className="dealers-modal panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-mark-delivered-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="invoice-mark-delivered-title">Mark as delivered</h3>
            <p className="text-muted text-sm">
              {invoice.invoiceNumber || invoiceId}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <form onSubmit={e => void handleSubmit(e)}>
          <div className="invoice-customer-pickup-dialog__body">
            <p className="text-sm">
              {hasLogisticsBooking
                ? 'Mark this invoice delivered. The linked logistics booking will be set to Delivered.'
                : 'Mark this invoice delivered without creating a logistics booking or AWB.'}
            </p>
            {error ? (
              <p className="text-danger text-sm" role="alert">{error}</p>
            ) : null}
          </div>

          <div className="dealers-modal__actions">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden />
                  Mark as delivered
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
