import React from 'react';
import { useOutletContext } from 'react-router-dom';
import type { InvoiceDetailOutletContext } from './invoiceDetailContext';
import type { InvoiceDetailSection } from '../../components/invoices/InvoiceDetailTop';

const PLACEHOLDER_COPY: Record<Exclude<InvoiceDetailSection, 'invoice'>, { title: string; body: string }> = {
  payments: {
    title: 'Payments',
    body: 'Payment history is not available in the portal yet. Contact YesWeigh accounts for payment details.',
  },
  logistic: {
    title: 'Logistics',
    body: 'Shipment tracking is not available in the portal yet. Contact YesWeigh support for delivery updates.',
  },
  qc: {
    title: 'Quality control',
    body: 'QC records for this invoice are not available in the portal yet. Contact YesWeigh support for inspection details.',
  },
};

export const InvoiceSectionPlaceholderPage: React.FC<{
  section: Exclude<InvoiceDetailSection, 'invoice'>;
}> = ({ section }) => {
  const { invoice } = useOutletContext<InvoiceDetailOutletContext>();
  const copy = PLACEHOLDER_COPY[section];

  if (!invoice) return null;

  return (
    <section className="invoice-detail-panel panel glass invoice-detail-panel--placeholder">
      <h3 className="invoice-detail-panel__title">{copy.title}</h3>
      {section === 'qc' && (
        <div className="invoice-detail-qc-hero">
          <img src="/icons/qc-checked.png" alt="" className="invoice-detail-qc-hero__badge" />
        </div>
      )}
      <p className="invoice-detail-panel__empty text-muted text-sm">{copy.body}</p>
    </section>
  );
};
