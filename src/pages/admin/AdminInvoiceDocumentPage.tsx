import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { PackagePlus } from 'lucide-react';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { RelatedSupportRequests } from '../../components/support/RelatedSupportRequests';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const {
    invoice,
    customerId,
    invoiceId,
    showManualLogistics,
    manualLogisticsPartnerId,
    onOpenManualLogistics,
    existingBooking,
  } = useOutletContext<AdminInvoiceDetailOutletContext>();

  if (!invoice) return null;

  const trackingLabel = existingBooking?.consignmentNo?.trim()
    || existingBooking?.trackingNo?.trim()
    || '';

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
        afterItems={
          showManualLogistics ? (
            <div className="invoice-manual-logistics panel glass">
              <button
                type="button"
                className="btn btn-secondary invoice-manual-logistics__btn"
                onClick={onOpenManualLogistics}
                title="Enter tracking number and box count only — no courier API booking"
              >
                <PackagePlus size={18} aria-hidden />
                Manual Logistics
              </button>
              <p className="text-muted text-sm invoice-manual-logistics__hint">
                Record an existing
                {' '}
                {logisticsPartnerLabel(manualLogisticsPartnerId)}
                {' '}
                tracking number and box count — no booking automation.
              </p>
            </div>
          ) : existingBooking && trackingLabel ? (
            <div className="invoice-manual-logistics panel glass">
              <p className="text-sm invoice-manual-logistics__saved">
                Logistics:
                {' '}
                <strong>{trackingLabel}</strong>
                {existingBooking.numberOfBoxes
                  ? ` · ${existingBooking.numberOfBoxes} box${existingBooking.numberOfBoxes === 1 ? '' : 'es'}`
                  : ''}
              </p>
            </div>
          ) : null
        }
      />
    </>
  );
};
