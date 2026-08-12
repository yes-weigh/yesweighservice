import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { goodsReceiptLocationLabel } from '../../lib/admin-goods-receipts';
import { formatInvoiceDate, invoiceStatusLabel } from '../../lib/invoices';
import type { AdminGoodsReceiptDetailOutletContext } from './adminGoodsReceiptDetailContext';

export const AdminGoodsReceiptDocumentPage: React.FC = () => {
  const { goodsReceipt } = useOutletContext<AdminGoodsReceiptDetailOutletContext>();

  if (!goodsReceipt) return null;

  return (
    <>
      <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
        <div className="flex gap-4 flex-wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="text-muted text-sm">Vendor</div>
            <strong>{goodsReceipt.vendorName ?? '—'}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Date</div>
            <strong>{formatInvoiceDate(goodsReceipt.date)}</strong>
          </div>
          {goodsReceipt.dueDate && (
            <div>
              <div className="text-muted text-sm">Due date</div>
              <strong>{formatInvoiceDate(goodsReceipt.dueDate)}</strong>
            </div>
          )}
          <div>
            <div className="text-muted text-sm">Location</div>
            <strong>{goodsReceiptLocationLabel(goodsReceipt.inventorySite)}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Status</div>
            <strong>{invoiceStatusLabel(goodsReceipt.status)}</strong>
          </div>
        </div>
        {goodsReceipt.referenceNumber && (
          <p className="text-muted text-sm mt-3 mb-0">Ref {goodsReceipt.referenceNumber}</p>
        )}
        {goodsReceipt.notes && (
          <p className="text-muted text-sm mt-2 mb-0">{goodsReceipt.notes}</p>
        )}
      </section>
      <InvoiceDocumentBody
        invoice={goodsReceipt}
        hideAmounts
        itemClassName="admin-invoice-detail-item"
      />
    </>
  );
};
