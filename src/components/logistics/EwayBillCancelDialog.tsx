import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  EWAY_BILL_CANCEL_REASONS,
  type EwayBillCancelReason,
} from '../../constants/ewayBill';

type Props = {
  ewaybillNumber?: string | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (input: { reason: EwayBillCancelReason; remarks: string }) => void | Promise<void>;
  onConfirmLocalOnly?: (input: { reason: EwayBillCancelReason; remarks: string }) => void | Promise<void>;
};

export const EwayBillCancelDialog: React.FC<Props> = ({
  ewaybillNumber,
  busy = false,
  error = '',
  onClose,
  onConfirm,
  onConfirmLocalOnly,
}) => {
  const [reason, setReason] = useState<EwayBillCancelReason>('order_cancelled');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="dealers-modal panel glass logistics-eway-cancel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eway-cancel-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="eway-cancel-title">Cancel e-way bill</h3>
            <p className="text-muted text-sm">
              {ewaybillNumber
                ? `This cancels EWB ${ewaybillNumber} on the GST portal (within 24 hours if not verified in transit).`
                : 'This cancels the e-way bill on the GST portal (within 24 hours if not verified in transit).'}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="logistics-eway-cancel__body">
          <label className="settings-courier-rates__field settings-courier-rates__field--plain">
            <span>Reason</span>
            <select
              value={reason}
              disabled={busy}
              onChange={event => {
                setReason(event.target.value as EwayBillCancelReason);
              }}
            >
              {EWAY_BILL_CANCEL_REASONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-courier-rates__field settings-courier-rates__field--plain">
            <span>Remarks (optional)</span>
            <input
              type="text"
              maxLength={50}
              value={remarks}
              disabled={busy}
              placeholder="Up to 50 characters"
              onChange={event => setRemarks(event.target.value)}
            />
          </label>
          {error ? (
            <p className="logistics-booking__docs-error" role="alert">{error}</p>
          ) : null}
        </div>

        <div className="dealers-modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Keep e-way bill
          </button>
          {error && onConfirmLocalOnly ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                void onConfirmLocalOnly({ reason, remarks: remarks.trim() });
              }}
            >
              {busy ? 'Clearing…' : 'Clear locally for retest'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              void onConfirm({ reason, remarks: remarks.trim() });
            }}
          >
            {busy ? 'Cancelling…' : 'Cancel on GST portal'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
