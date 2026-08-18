import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  EwayBillGeneratePreviewBody,
  isEwayTransporterMissing,
  type EwayBillGeneratePreview,
} from './EwayBillGeneratePreview';
import type { InvoiceEwayBillResult } from '../../lib/invoiceEwayBill';

export type { EwayBillGeneratePreview };

export type EwayClubbedBillRow = {
  invoiceId: string;
  invoiceNumber: string;
  ewaybillNumber?: string | null;
  status?: string | null;
  error?: string;
  result?: InvoiceEwayBillResult | null;
};

type Props = {
  preview: EwayBillGeneratePreview;
  intro?: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  manualAssociateEnabled?: boolean;
  manualAssociateBusy?: boolean;
  manualAssociateError?: string;
  onManualAssociate?: (input: { ewayBillNumber: string }) => void | Promise<void>;
};

export const EwayBillGenerateDialog: React.FC<Props> = ({
  preview,
  intro,
  confirmLabel,
  busy = false,
  error = '',
  onClose,
  onConfirm,
  manualAssociateEnabled = false,
  manualAssociateBusy = false,
  manualAssociateError = '',
  onManualAssociate,
}) => {
  const [manualEwayBillNumber, setManualEwayBillNumber] = useState('');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const transporterMissing = isEwayTransporterMissing(preview);

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="dealers-modal panel glass logistics-eway-generate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eway-generate-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="eway-generate-title">Generate e-way bill</h3>
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

        <div className="logistics-eway-generate__body">
          <EwayBillGeneratePreviewBody preview={preview} error={error} intro={intro} />
          {manualAssociateEnabled && onManualAssociate ? (
            <div className="logistics-eway-generate__manual">
              <p className="book-courier__hint text-muted text-sm" role="note">
                Enter the GST e-way bill number manually and tap <strong>Associate &amp; push</strong>.
              </p>
              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>GST e-way bill number (12 digits)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={20}
                  disabled={manualAssociateBusy}
                  placeholder="e.g. 123456789012"
                  value={manualEwayBillNumber}
                  onChange={event => setManualEwayBillNumber(event.target.value)}
                />
              </label>
              {manualAssociateError ? (
                <p className="logistics-booking__docs-error" role="alert">{manualAssociateError}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="dealers-modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Not now
          </button>
          {manualAssociateEnabled && onManualAssociate ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || manualAssociateBusy || !manualEwayBillNumber.trim()}
              onClick={() => {
                void onManualAssociate({ ewayBillNumber: manualEwayBillNumber.trim() });
              }}
            >
              {manualAssociateBusy ? 'Associating…' : 'Associate & push'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || transporterMissing}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? 'Generating…' : (confirmLabel || 'Generate e-way bill')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

type ClubbedProps = {
  rows: EwayClubbedBillRow[];
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onView: (row: EwayClubbedBillRow) => void;
};

export const EwayClubbedBillsDialog: React.FC<ClubbedProps> = ({
  rows,
  busy = false,
  error = '',
  onClose,
  onView,
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const readyCount = rows.filter(row => row.result?.contentBase64).length;

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="dealers-modal panel glass logistics-eway-generate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eway-clubbed-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="eway-clubbed-title">E-way bills</h3>
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

        <div className="logistics-eway-generate__body">
          <p className="book-courier__hint text-muted text-sm">
            {busy
              ? `Loading ${rows.length} e-way bills…`
              : `${readyCount} of ${rows.length} e-way bills ready. Tap one to view.`}
          </p>
          <ul className="logistics-eway-clubbed-list">
            {rows.map(row => {
              const ready = Boolean(row.result?.contentBase64);
              return (
                <li key={row.invoiceId}>
                  <div>
                    <strong>{row.invoiceNumber}</strong>
                    <span className="text-muted text-sm">
                      {row.error
                        ? row.error
                        : row.ewaybillNumber
                          ? `EWB ${row.ewaybillNumber}`
                          : (row.status || 'Missing')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || !ready}
                    onClick={() => onView(row)}
                  >
                    View
                  </button>
                </li>
              );
            })}
          </ul>
          {error ? (
            <p className="logistics-booking__docs-error" role="alert">{error}</p>
          ) : null}
        </div>

        <div className="dealers-modal__actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
