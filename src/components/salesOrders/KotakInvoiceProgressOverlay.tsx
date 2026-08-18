import React, { useEffect } from 'react';
import { VerifyInvoiceClock } from './VerifyInvoiceClock';

const PAID_HOLD_MS = 2800;

export type KotakInvoicePhase = 'invoicing' | 'categorizing' | 'paid';

/** Full-screen clocks + PAID stamp for Select & Invoice. */
export const KotakInvoiceProgressOverlay: React.FC<{
  phase: KotakInvoicePhase;
  onPaidDone: () => void;
}> = ({ phase, onPaidDone }) => {
  useEffect(() => {
    if (phase !== 'paid') return;
    const id = window.setTimeout(onPaidDone, PAID_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase, onPaidDone]);

  if (phase === 'paid') {
    return (
      <div
        className="so-invoiced-overlay kotak-invoice-progress kotak-invoice-progress--paid"
        role="status"
        aria-live="polite"
        aria-label="Paid"
        onClick={onPaidDone}
      >
        <div className="kotak-paid-stamp" aria-hidden>
          <span>PAID</span>
        </div>
      </div>
    );
  }

  const copy = phase === 'invoicing'
    ? 'Creating invoice…'
    : 'Categorizing bank feeds…';

  return (
    <div
      className="so-invoiced-overlay kotak-invoice-progress"
      role="status"
      aria-live="polite"
      aria-label={copy}
    >
      <div className="kotak-invoice-progress__card">
        <VerifyInvoiceClock size={72} />
        <p className="kotak-invoice-progress__copy mb-0">{copy}</p>
      </div>
    </div>
  );
};
