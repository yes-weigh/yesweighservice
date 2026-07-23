import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { InvoiceCategoryBadge } from '../../components/invoices/InvoiceCategoryVisual';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { formatInvoiceDate, invoiceCategoryLabel, invoiceStatusLabel } from '../../lib/invoices';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

export const AdminSalesOrderDocumentPage: React.FC = () => {
  const { salesOrder } = useOutletContext<AdminSalesOrderDetailOutletContext>();

  if (!salesOrder) return null;

  const categoryLabel = invoiceCategoryLabel(salesOrder.salesOrderCategory);

  return (
    <>
      <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
        <div className="flex gap-4 flex-wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="text-muted text-sm">Customer</div>
            <strong>{salesOrder.customerName ?? '—'}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Date</div>
            <strong>{formatInvoiceDate(salesOrder.date)}</strong>
          </div>
          {salesOrder.shipmentDate && (
            <div>
              <div className="text-muted text-sm">Shipment</div>
              <strong>{formatInvoiceDate(salesOrder.shipmentDate)}</strong>
            </div>
          )}
          <div>
            <div className="text-muted text-sm">Status</div>
            <strong>{invoiceStatusLabel(salesOrder.status)}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Category</div>
            {categoryLabel ? (
              <InvoiceCategoryBadge category={salesOrder.salesOrderCategory} />
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </div>
        {salesOrder.referenceNumber && (
          <p className="text-muted text-sm mt-3 mb-0">Ref {salesOrder.referenceNumber}</p>
        )}
        {salesOrder.notes && (
          <p className="text-muted text-sm mt-2 mb-0">{salesOrder.notes}</p>
        )}
      </section>
      <InvoiceDocumentBody
        invoice={salesOrder}
        itemClassName="admin-invoice-detail-item"
      />
    </>
  );
};
