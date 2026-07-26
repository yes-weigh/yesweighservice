import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { RelatedSupportRequests } from '../../components/support/RelatedSupportRequests';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const { invoice, customerId, invoiceId } = useOutletContext<AdminInvoiceDetailOutletContext>();

  if (!invoice) return null;

  return (
    <>
      <DocumentPartyBlock
        className="mb-4"
        customerName={invoice.customerName}
        address={invoice.shippingAddress}
        telHref={invoice.customerTelHref}
        whatsappHref={invoice.customerWhatsappHref}
        emptyAddressLabel="No address on file"
      />

      <DocumentKamStrip
        className="mb-4"
        salespersonId={invoice.salespersonId}
        salespersonName={invoice.salespersonName}
      />
      <RelatedSupportRequests
        dealerId={customerId}
        invoiceId={invoiceId}
        invoiceNumber={invoice.invoiceNumber}
      />
      <InvoiceDocumentBody
        invoice={invoice}
        itemClassName="admin-invoice-detail-item"
        totalsAfterItems
      />
    </>
  );
};
