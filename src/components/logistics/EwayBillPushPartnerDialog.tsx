import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { DelhiveryPartnerEwayStatus } from '../../lib/invoiceEwayBill';

type Props = {
  checking?: boolean;
  pushing?: boolean;
  error?: string;
  status?: DelhiveryPartnerEwayStatus | null;
  onClose: () => void;
  onCheckStatus: () => void | Promise<void>;
  onPush: () => void | Promise<void>;
};

function formatEwayList(values: string[] | undefined): string {
  if (!values?.length) return 'None';
  return values.join(', ');
}

export const EwayBillPushPartnerDialog: React.FC<Props> = ({
  checking = false,
  pushing = false,
  error = '',
  status = null,
  onClose,
  onCheckStatus,
  onPush,
}) => {
  const busy = checking || pushing;

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
        className="dealers-modal panel glass logistics-eway-partner"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eway-partner-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="eway-partner-title">Push e-way to logistics</h3>
            <p className="text-muted text-sm">
              Check Delhivery first. If the e-way is already on the LR (including a portal update),
              there is nothing to push.
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

        <div className="logistics-eway-partner__body">
          {status ? (
            <dl className="logistics-eway-generate__preview">
              <div className="logistics-eway-generate__row">
                <dt>Partner status</dt>
                <dd className={status.onPartner ? 'logistics-booking__partner-eway-ok' : undefined}>
                  {status.onPartner
                    ? 'E-way bills already on partner'
                    : 'E-way bills not on partner yet'}
                </dd>
              </div>
              <div className="logistics-eway-generate__row">
                <dt>On Delhivery</dt>
                <dd>{formatEwayList(status.partnerEwaybills)}</dd>
              </div>
              <div className="logistics-eway-generate__row">
                <dt>Our e-way bills</dt>
                <dd>{formatEwayList(status.expected)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted text-sm">
              Update status from partner to see whether Delhivery already has the e-way bill.
            </p>
          )}
          {error ? (
            <p className="logistics-booking__docs-error" role="alert">{error}</p>
          ) : null}
        </div>

        <div className="dealers-modal__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {status?.onPartner ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { void onCheckStatus(); }}
            disabled={busy}
          >
            {checking ? 'Checking partner…' : 'Update status from partner'}
          </button>
          {status && !status.onPartner ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { void onPush(); }}
              disabled={busy}
            >
              {pushing ? 'Pushing to logistics…' : 'Push to logistics'}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};
