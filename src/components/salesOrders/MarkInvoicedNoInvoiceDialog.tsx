import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { markInvoicedPortalRouteSteps } from '../../lib/salesOrderWorkflow';

interface MarkInvoicedNoInvoiceDialogProps {
  errorMessage: string;
  yesOneStage: string | null | undefined;
  onClose: () => void;
}

export const MarkInvoicedNoInvoiceDialog: React.FC<MarkInvoicedNoInvoiceDialogProps> = ({
  errorMessage,
  yesOneStage,
  onClose,
}) => {
  const steps = markInvoicedPortalRouteSteps(yesOneStage);

  return (
    <div className="dealers-modal-backdrop" onClick={onClose}>
      <div
        className="dealers-modal panel glass mark-invoiced-guide-dialog"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="mark-invoiced-guide-title"
        aria-describedby="mark-invoiced-guide-body"
      >
        <div className="dealers-modal__header">
          <div className="mark-invoiced-guide-dialog__title-row">
            <AlertCircle size={22} aria-hidden className="mark-invoiced-guide-dialog__icon" />
            <div>
              <h2 id="mark-invoiced-guide-title">No Zoho invoice found</h2>
              <p className="text-muted text-sm mb-0">Mark as invoiced only syncs an invoice that already exists in Zoho.</p>
            </div>
          </div>
          <button type="button" className="dealers-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div id="mark-invoiced-guide-body" className="mark-invoiced-guide-dialog__body">
          <p className="mark-invoiced-guide-dialog__error">{errorMessage}</p>
          <p className="mark-invoiced-guide-dialog__lead">
            To invoice this order from the portal, follow these steps:
          </p>
          <ol className="mark-invoiced-guide-dialog__steps">
            {steps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-muted text-sm mb-0">
            Use Mark as invoiced only when someone already created the invoice directly in Zoho.
          </p>
        </div>

        <div className="mark-invoiced-guide-dialog__actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            OK, got it
          </button>
        </div>
      </div>
    </div>
  );
};
