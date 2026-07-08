import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { BookCourierEntryButton } from '../../components/logistics/BookCourierEntryButton';
import { RelatedSupportRequests } from '../../components/support/RelatedSupportRequests';
import { buildInvoiceBookingDraftPatch } from '../../lib/logisticsPrefill';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const { invoice, customerId, invoiceId } = useOutletContext<AdminInvoiceDetailOutletContext>();

  if (!invoice) return null;

  const entry = {
    draftPatch: buildInvoiceBookingDraftPatch(invoice, invoiceId, customerId, customerId),
    dealerQuery: invoice.customerName ?? undefined,
  };

  return (
    <>
      <section className="invoice-detail-actions panel glass">
        <BookCourierEntryButton entry={entry} size="sm" />
      </section>
      <RelatedSupportRequests
        dealerId={customerId}
        invoiceId={invoiceId}
        invoiceNumber={invoice.invoiceNumber}
      />
      <InvoiceDocumentBody invoice={invoice} itemClassName="admin-invoice-detail-item" />
    </>
  );
};
