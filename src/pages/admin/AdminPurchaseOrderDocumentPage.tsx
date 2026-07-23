import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { InvoiceCategoryBadge } from '../../components/invoices/InvoiceCategoryVisual';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { formatInvoiceDate, invoiceCategoryLabel, invoiceStatusLabel } from '../../lib/invoices';
import type { AdminPurchaseOrderDetailOutletContext } from './adminPurchaseOrderDetailContext';

export const AdminPurchaseOrderDocumentPage: React.FC = () => {
  const { purchaseOrder } = useOutletContext<AdminPurchaseOrderDetailOutletContext>();

  if (!purchaseOrder) return null;

  const categoryLabel = invoiceCategoryLabel(purchaseOrder.purchaseOrderCategory);

  return (
    <>
      <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
        <div className="flex gap-4 flex-wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="text-muted text-sm">Vendor</div>
            <strong>{purchaseOrder.vendorName ?? '—'}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Date</div>
            <strong>{formatInvoiceDate(purchaseOrder.date)}</strong>
          </div>
          {purchaseOrder.deliveryDate && (
            <div>
              <div className="text-muted text-sm">Delivery</div>
              <strong>{formatInvoiceDate(purchaseOrder.deliveryDate)}</strong>
            </div>
          )}
          <div>
            <div className="text-muted text-sm">Status</div>
            <strong>{invoiceStatusLabel(purchaseOrder.status)}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Category</div>
            {categoryLabel ? (
              <InvoiceCategoryBadge category={purchaseOrder.purchaseOrderCategory} />
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </div>
        {purchaseOrder.referenceNumber && (
          <p className="text-muted text-sm mt-3 mb-0">Ref {purchaseOrder.referenceNumber}</p>
        )}
        {purchaseOrder.notes && (
          <p className="text-muted text-sm mt-2 mb-0">{purchaseOrder.notes}</p>
        )}
      </section>
      <InvoiceDocumentBody
        invoice={purchaseOrder}
        itemClassName="admin-invoice-detail-item"
      />
    </>
  );
};
