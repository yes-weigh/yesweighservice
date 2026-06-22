import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { RelatedSupportRequests } from '../../components/support/RelatedSupportRequests';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const { invoice, customerId, invoiceId } = useOutletContext<AdminInvoiceDetailOutletContext>();

  if (!invoice) return null;

  return (
    <>
      <RelatedSupportRequests
        dealerId={customerId}
        invoiceId={invoiceId}
        invoiceNumber={invoice.invoiceNumber}
      />
      <InvoiceDocumentBody invoice={invoice} itemClassName="admin-invoice-detail-item" />
    </>
  );
};
