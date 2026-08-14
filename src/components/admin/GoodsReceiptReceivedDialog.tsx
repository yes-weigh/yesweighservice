import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, PackageCheck, X } from 'lucide-react';
import { formatInvoiceDateTime } from '../../lib/invoices';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type Props = {
  open: boolean;
  billNumber?: string | null;
  canBackdate: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (receivedAtIso: string) => void;
};

export const GoodsReceiptReceivedDialog: React.FC<Props> = ({
  open,
  billNumber,
  canBackdate,
  saving,
  error,
  onClose,
  onConfirm,
}) => {
  const [value, setValue] = useState(() => toDatetimeLocalValue(new Date()));
  const [localError, setLocalError] = useState('');

  const bounds = useMemo(() => {
    const now = new Date();
    const min = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
    return {
      min: toDatetimeLocalValue(min),
      max: toDatetimeLocalValue(now),
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setValue(toDatetimeLocalValue(new Date()));
    setLocalError('');
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  if (!open) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canBackdate) {
      setLocalError('');
      onConfirm(new Date().toISOString());
      return;
    }
    const picked = fromDatetimeLocalValue(value);
    if (!picked) {
      setLocalError('Enter a valid date and time.');
      return;
    }
    if (picked.getTime() > Date.now() + 60_000) {
      setLocalError('Received datetime cannot be in the future.');
      return;
    }
    setLocalError('');
    onConfirm(picked.toISOString());
  };

  const displayError = localError || error;

  return createPortal(
    <div
      className="dealers-modal-backdrop"
      role="presentation"
      onClick={() => !saving && onClose()}
    >
      <div
        className="dealers-modal panel glass goods-receipt-received-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goods-receipt-received-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="goods-receipt-received-title">Goods received</h3>
            <p className="text-muted text-sm">
              {billNumber || 'Record the received date and time'}
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

        <form onSubmit={handleSubmit}>
          <div className="goods-receipt-received-dialog__body">
            {canBackdate ? (
              <>
                <label className="dealers-modal__field">
                  Received date & time
                  <input
                    type="datetime-local"
                    value={value}
                    min={bounds.min}
                    max={bounds.max}
                    disabled={saving}
                    required
                    onChange={event => {
                      setValue(event.target.value);
                      setLocalError('');
                    }}
                  />
                </label>
                <p className="text-muted text-sm mb-0">
                  Later product audit logs will be updated to match this physical count.
                </p>
              </>
            ) : (
              <p className="text-sm mb-0">
                Received will be recorded as{' '}
                <strong>{formatInvoiceDateTime(new Date().toISOString(), new Date().toISOString())}</strong>.
              </p>
            )}
            {displayError ? (
              <p className="dealers-modal__error" role="alert">{displayError}</p>
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
                  <PackageCheck size={16} aria-hidden />
                  Confirm received
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
