import React, { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { InvoiceCategoryBadge } from '../../components/invoices/InvoiceCategoryVisual';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { findDealerOrderIdByOrderNumber } from '../../lib/dealerOrders';
import { formatInvoiceDate, invoiceCategoryLabel, invoiceStatusLabel } from '../../lib/invoices';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

export const AdminSalesOrderDocumentPage: React.FC = () => {
  const { salesOrder, listPath } = useOutletContext<AdminSalesOrderDetailOutletContext>();
  const [portalOrderId, setPortalOrderId] = useState<string | null>(null);

  useEffect(() => {
    const ref = salesOrder?.referenceNumber?.trim() ?? '';
    if (!ref) {
      setPortalOrderId(null);
      return;
    }
    let cancelled = false;
    void findDealerOrderIdByOrderNumber(ref).then(id => {
      if (!cancelled) setPortalOrderId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [salesOrder?.referenceNumber]);

  if (!salesOrder) return null;

  const categoryLabel = invoiceCategoryLabel(salesOrder.salesOrderCategory);
  const portalHref = portalOrderId ? `${listPath}/portal/${portalOrderId}` : null;

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
        {portalHref && (
          <p className="mt-3 mb-0">
            <Link to={portalHref} className="btn btn-secondary btn-sm">
              <ExternalLink size={14} aria-hidden /> Open portal order
            </Link>
          </p>
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
