import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CheckCircle2, PackagePlus } from 'lucide-react';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { InvoiceLocalFreightEditor } from '../../components/invoices/InvoiceLocalFreightEditor';
import { RelatedSupportRequests } from '../../components/support/RelatedSupportRequests';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { useAuth } from '../../context/AuthContext';
import { isFreightInvoiceLineItem } from '../../lib/invoices';
import {
  effectiveInvoiceFreightSku,
  overlayLocalFreightOnLineItems,
  type LocalFreightSelectSku,
} from '../../lib/invoiceLocalFreight';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const {
    invoice,
    customerId,
    invoiceId,
    showManualLogistics,
    manualLogisticsPartnerId,
    manualLogisticsPartnerFromFreight,
    onOpenManualLogistics,
    showMarkDelivered,
    onOpenMarkDelivered,
    existingBooking,
    kamCardOpen,
    canEditLocalFreight = false,
    localFreightBusy = false,
    localFreightError = '',
    onChangeLocalFreight,
  } = useOutletContext<AdminInvoiceDetailOutletContext>();

  const isOps = isInternalOpsUser(user);
  const showKamCard = Boolean(invoice) && (!isOps || Boolean(kamCardOpen));
  const [freightOpen, setFreightOpen] = useState(true);

  useEffect(() => {
    if (!kamCardOpen) return;
    window.requestAnimationFrame(() => {
      document.getElementById('invoice-detail-kam')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, [kamCardOpen]);

  const displayInvoice = useMemo(() => {
    if (!invoice) return null;
    return {
      ...invoice,
      lineItems: overlayLocalFreightOnLineItems(invoice),
    };
  }, [invoice]);

  if (!displayInvoice || !invoice) return null;

  const trackingLabel = existingBooking?.consignmentNo?.trim()
    || existingBooking?.trackingNo?.trim()
    || '';
  const selectedFreightSku = (effectiveInvoiceFreightSku(invoice) || null) as LocalFreightSelectSku | null;
  const freightItem = displayInvoice.lineItems.find(item => isFreightInvoiceLineItem(item));
  const selectedLineItemId = canEditLocalFreight && freightOpen
    ? (freightItem?.id ?? null)
    : null;

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

      {showKamCard ? (
        <div id="invoice-detail-kam">
          <DocumentKamStrip
            className="mb-4"
            salespersonId={invoice.salespersonId}
            salespersonName={invoice.salespersonName}
          />
        </div>
      ) : null}
      <RelatedSupportRequests
        dealerId={customerId}
        invoiceId={invoiceId}
        invoiceNumber={invoice.invoiceNumber}
      />
      <InvoiceDocumentBody
        invoice={displayInvoice}
        itemClassName="admin-invoice-detail-item"
        totalsAfterItems
        selectFreightOnly={canEditLocalFreight}
        selectedLineItemId={selectedLineItemId}
        onSelectLineItem={canEditLocalFreight ? (item) => {
          if (!isFreightInvoiceLineItem(item)) return;
          setFreightOpen(open => !open);
        } : undefined}
        renderExpanded={canEditLocalFreight && onChangeLocalFreight
          ? (item) => (
            isFreightInvoiceLineItem(item) ? (
              <InvoiceLocalFreightEditor
                invoice={invoice}
                selectedSku={selectedFreightSku}
                busy={localFreightBusy}
                error={localFreightError}
                onSelect={onChangeLocalFreight}
              />
            ) : null
          )
          : undefined}
        afterItems={
          showManualLogistics || showMarkDelivered ? (
            <div className="invoice-manual-logistics panel glass">
              <div className="invoice-manual-logistics__actions">
                {showManualLogistics ? (
                  <button
                    type="button"
                    className="btn btn-secondary invoice-manual-logistics__btn"
                    onClick={onOpenManualLogistics}
                    title="Enter tracking number and box count only — no courier API booking"
                  >
                    <PackagePlus size={18} aria-hidden />
                    Manual Logistics
                  </button>
                ) : null}
                {showMarkDelivered ? (
                  <button
                    type="button"
                    className="btn btn-primary invoice-manual-logistics__btn"
                    onClick={onOpenMarkDelivered}
                    title="Mark delivered without a logistics booking"
                  >
                    <CheckCircle2 size={18} aria-hidden />
                    Mark as delivered
                  </button>
                ) : null}
              </div>
              {showManualLogistics ? (
                <p className="text-muted text-sm invoice-manual-logistics__hint">
                  {manualLogisticsPartnerFromFreight
                    ? (
                      <>
                        Record an existing
                        {' '}
                        {logisticsPartnerLabel(manualLogisticsPartnerId)}
                        {' '}
                        tracking number and box count — no booking automation.
                      </>
                    )
                    : (
                      <>
                        No freight line on this invoice — choose the delivery partner,
                        then enter tracking number and box count.
                      </>
                    )}
                </p>
              ) : (
                <p className="text-muted text-sm invoice-manual-logistics__hint">
                  Mark this invoice delivered even if no AWB or logistics booking exists.
                </p>
              )}
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
