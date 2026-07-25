import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { InvoiceCategoryBadge } from '../../components/invoices/InvoiceCategoryVisual';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage } from '../../lib/dealerOrders';
import { formatInvoiceDate, invoiceCategoryLabel, invoiceStatusLabel } from '../../lib/invoices';
import {
  submitSalesOrderPayment,
  updateDraftSalesOrderLines,
  uploadSalesOrderPaymentScreenshot,
  yesOneStageLabel,
} from '../../lib/salesOrderWorkflow';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

export const AdminSalesOrderDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const isDealer = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const isOps = user?.role === 'staff' || user?.role === 'super_admin';
  const { salesOrder, salesOrderId, setSalesOrder } = useOutletContext<AdminSalesOrderDetailOutletContext>();

  const [editLines, setEditLines] = useState<Array<{ productId: string; name: string; quantity: number }>>([]);
  const [editing, setEditing] = useState(false);
  const [savingLines, setSavingLines] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [paymentUtr, setPaymentUtr] = useState('');
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const stage = String(salesOrder?.yesOneStage || '');
  const zohoStatus = String(salesOrder?.status || '').toLowerCase().replace(/\s+/g, '_');
  const canEditLines = isOps
    && (zohoStatus === 'draft' || zohoStatus === 'pending')
    && stage !== 'payment_submitted'
    && stage !== 'completed'
    && stage !== 'void';
  const canPay = isDealer && (stage === 'ready_for_payment' || stage === 'payment_submitted');

  const categoryLabel = salesOrder
    ? invoiceCategoryLabel(salesOrder.salesOrderCategory)
    : null;

  const startEdit = () => {
    if (!salesOrder) return;
    setEditLines(
      salesOrder.lineItems.map(line => ({
        productId: line.itemId || line.id,
        name: line.name,
        quantity: Math.max(1, Math.floor(line.quantity || 1)),
      })),
    );
    setEditing(true);
  };

  const saveLines = async () => {
    if (!salesOrderId || savingLines) return;
    const lines = editLines
      .filter(line => line.productId && line.quantity > 0)
      .map(line => ({ productId: line.productId, quantity: line.quantity }));
    if (!lines.length) {
      window.alert('Add at least one line item.');
      return;
    }
    setSavingLines(true);
    try {
      const next = await updateDraftSalesOrderLines(salesOrderId, lines);
      setSalesOrder(next);
      setEditing(false);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSavingLines(false);
    }
  };

  const handleSubmitPayment = async () => {
    if (!salesOrderId || submittingPayment) return;
    if (!paymentFile && !salesOrder?.paymentScreenshotStoragePath) {
      window.alert('Attach a payment screenshot.');
      return;
    }
    setSubmittingPayment(true);
    try {
      let storagePath = salesOrder?.paymentScreenshotStoragePath || '';
      if (paymentFile) {
        const uploaded = await uploadSalesOrderPaymentScreenshot(salesOrderId, paymentFile);
        storagePath = uploaded.storagePath;
      }
      const next = await submitSalesOrderPayment({
        salesOrderId,
        paymentScreenshotStoragePath: storagePath,
        paymentUtr: paymentUtr.trim() || undefined,
      });
      setSalesOrder(next);
      setPaymentFile(null);
      window.alert('Payment proof submitted. Staff will verify and complete your order.');
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSubmittingPayment(false);
    }
  };

  const workflowHint = useMemo(() => {
    if (!salesOrder) return null;
    if (stage === 'review' || !stage) {
      return isDealer
        ? 'Your order is a Zoho Draft. Staff will review stock and mark it ready for payment.'
        : 'Review stock, edit lines if needed, then mark Ready for payment.';
    }
    if (stage === 'ready_for_payment') {
      return isDealer
        ? 'Upload your payment screenshot and UTR to continue.'
        : 'Waiting for the dealer to submit payment proof.';
    }
    if (stage === 'payment_submitted') {
      return isDealer
        ? 'Payment submitted. Waiting for verification.'
        : 'Review the payment screenshot, then Verify payment & invoice (super admin).';
    }
    if (stage === 'completed') {
      return salesOrder.zohoInvoiceNumber
        ? `Completed. Invoice ${salesOrder.zohoInvoiceNumber} created in Zoho.`
        : 'Completed in Zoho.';
    }
    return null;
  }, [salesOrder, stage, isDealer]);

  if (!salesOrder) return null;

  return (
    <>
      <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
        <div className="flex gap-4 flex-wrap" style={{ justifyContent: 'space-between' }}>
          {!isDealer && (
            <div>
              <div className="text-muted text-sm">Customer</div>
              <strong>{salesOrder.customerName ?? '—'}</strong>
            </div>
          )}
          <div>
            <div className="text-muted text-sm">Date</div>
            <strong>{formatInvoiceDate(salesOrder.date)}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Zoho status</div>
            <strong>{invoiceStatusLabel(salesOrder.status)}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">YesOne stage</div>
            <strong>{salesOrder.yesOneStage ? yesOneStageLabel(salesOrder.yesOneStage) : '—'}</strong>
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
        {workflowHint && (
          <p className="text-sm mt-3 mb-0">{workflowHint}</p>
        )}
        {salesOrder.notes && (
          <p className="text-muted text-sm mt-2 mb-0">{salesOrder.notes}</p>
        )}
      </section>

      {canEditLines && (
        <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
          <div className="flex gap-3 flex-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="mb-0" style={{ fontSize: '1rem' }}>Edit draft lines</h3>
            {!editing ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={startEdit}>
                Edit items
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={savingLines}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={savingLines}
                  onClick={() => { void saveLines(); }}
                >
                  {savingLines ? 'Saving…' : 'Save to Zoho'}
                </button>
              </div>
            )}
          </div>
          {editing && (
            <div className="mt-4">
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {editLines.map((line, index) => (
                  <li
                    key={`${line.productId}-${index}`}
                    className="flex gap-3 flex-wrap"
                    style={{ alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border, #333)' }}
                  >
                    <div style={{ flex: 1, minWidth: '10rem' }}>
                      <strong>{line.name}</strong>
                      <div className="text-muted text-sm">{line.productId}</div>
                    </div>
                    <div className="flex gap-2" style={{ alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label="Decrease"
                        onClick={() => setEditLines(rows => rows.map((row, i) => (
                          i === index
                            ? { ...row, quantity: Math.max(1, row.quantity - 1) }
                            : row
                        )))}
                      >
                        <Minus size={14} />
                      </button>
                      <span style={{ minWidth: '2rem', textAlign: 'center' }}>{line.quantity}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label="Increase"
                        onClick={() => setEditLines(rows => rows.map((row, i) => (
                          i === index
                            ? { ...row, quantity: row.quantity + 1 }
                            : row
                        )))}
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label="Remove"
                        onClick={() => setEditLines(rows => rows.filter((_, i) => i !== index))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3 flex-wrap" style={{ alignItems: 'center' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Catalog product id or Zoho item id"
                  value={addProductId}
                  onChange={e => setAddProductId(e.target.value)}
                  style={{ minWidth: '16rem' }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const productId = addProductId.trim();
                    if (!productId) return;
                    setEditLines(rows => {
                      const existing = rows.find(row => row.productId === productId);
                      if (existing) {
                        return rows.map(row => (
                          row.productId === productId
                            ? { ...row, quantity: row.quantity + 1 }
                            : row
                        ));
                      }
                      return [...rows, { productId, name: productId, quantity: 1 }];
                    });
                    setAddProductId('');
                  }}
                >
                  Add product
                </button>
              </div>
              <p className="text-muted text-sm mt-2 mb-0">
                Rates come from the catalog when you save. Out-of-stock items are allowed for staff edits.
              </p>
            </div>
          )}
        </section>
      )}

      {(canPay || (isOps && (stage === 'payment_submitted' || stage === 'completed' || salesOrder.paymentScreenshotUrl))) && (
        <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
          <h3 className="mb-3" style={{ fontSize: '1rem' }}>Payment</h3>
          {salesOrder.paymentAmount != null && (
            <p className="mb-2">
              Amount due: <strong>{formatCurrency(salesOrder.paymentAmount, salesOrder.currencyCode)}</strong>
            </p>
          )}
          {salesOrder.paymentUtr && (
            <p className="text-sm mb-2">UTR: <strong>{salesOrder.paymentUtr}</strong></p>
          )}
          {salesOrder.paymentScreenshotUrl && (
            <p className="mb-3">
              <a href={salesOrder.paymentScreenshotUrl} target="_blank" rel="noreferrer">
                View payment screenshot
              </a>
            </p>
          )}
          {isDealer && stage === 'ready_for_payment' && (
            <div className="flex gap-3 flex-wrap" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <label className="text-sm">
                UTR / reference
                <input
                  type="text"
                  className="input mt-1"
                  value={paymentUtr}
                  onChange={e => setPaymentUtr(e.target.value)}
                  placeholder="Bank UTR or transaction id"
                />
              </label>
              <label className="text-sm">
                Payment screenshot
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1"
                  onChange={e => setPaymentFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submittingPayment}
                onClick={() => { void handleSubmitPayment(); }}
              >
                {submittingPayment ? 'Submitting…' : 'Submit payment proof'}
              </button>
            </div>
          )}
          {isDealer && stage === 'payment_submitted' && (
            <p className="text-muted text-sm mb-0">
              You can re-upload by contacting support if details were wrong. Staff will verify shortly.
            </p>
          )}
        </section>
      )}

      <InvoiceDocumentBody
        invoice={salesOrder}
        itemClassName="admin-invoice-detail-item"
      />
    </>
  );
};
