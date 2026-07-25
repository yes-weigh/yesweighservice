import React, { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Ban, Check, FileText, IndianRupee, MapPin, Pencil } from 'lucide-react';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import {
  SalesOrderDraftLineEditor,
  type DraftEditLine,
} from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage } from '../../lib/dealerOrders';
import {
  submitSalesOrderPayment,
  updateDraftSalesOrderLines,
  uploadSalesOrderPaymentScreenshot,
} from '../../lib/salesOrderWorkflow';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

export const AdminSalesOrderDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const isDealer = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const isOps = user?.role === 'staff' || user?.role === 'super_admin';
  const {
    salesOrder,
    salesOrderId,
    listPath,
    setSalesOrder,
    workflowActions,
  } = useOutletContext<AdminSalesOrderDetailOutletContext>();

  const [editLines, setEditLines] = useState<DraftEditLine[]>([]);
  const [editing, setEditing] = useState(false);
  const [savingLines, setSavingLines] = useState(false);
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
  const pdfPath = `${listPath}/${salesOrderId}/view`;

  const startEdit = () => {
    if (!salesOrder) return;
    setEditLines(
      salesOrder.lineItems.map(line => ({
        productId: line.itemId || line.id,
        name: line.name,
        sku: line.sku ?? null,
        imageUrl: line.imageUrl ?? null,
        rate: Number(line.rate) || 0,
        unit: 'pcs',
        quantity: Math.max(1, Math.floor(line.quantity || 1)),
        stockStatus: null,
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

  if (!salesOrder) return null;

  const showWorkflowActions = Boolean(
    workflowActions
    && (workflowActions.canReady || workflowActions.canVerify || workflowActions.canVoid),
  );
  const showPayment = canPay
    || (isOps && (stage === 'payment_submitted' || stage === 'completed' || salesOrder.paymentScreenshotUrl));

  return (
    <div className={`so-detail${showWorkflowActions ? ' so-detail--with-actions' : ''}`}>
      {/* Compact header: PDF + customer + shipping */}
      <header className="so-detail__header">
        <Link to={pdfPath} className="so-detail__pdf">
          <FileText size={16} aria-hidden />
          View PDF
        </Link>

        <div className="so-detail__party">
          {!isDealer && (
            <h2 className="so-detail__customer">{salesOrder.customerName ?? '—'}</h2>
          )}
          {salesOrder.shippingAddress && (
            <p className="so-detail__ship">
              <MapPin size={14} aria-hidden />
              <span>{salesOrder.shippingAddress}</span>
            </p>
          )}
        </div>
      </header>

      {/* Products + totals as one surface */}
      <section className="so-detail__doc">
        {canEditLines && editing ? (
          <>
            <SalesOrderDraftLineEditor
              lines={editLines}
              onChange={setEditLines}
              saving={savingLines}
              onSave={() => { void saveLines(); }}
              onCancel={() => setEditing(false)}
              embedded
            />
            <div className="so-detail__totals">
              <div className="so-detail__totals-row">
                <span>Sub Total</span>
                <span>{formatCurrency(salesOrder.subtotal, salesOrder.currencyCode)}</span>
              </div>
              <div className="so-detail__totals-row">
                <span>GST</span>
                <span>{formatCurrency(salesOrder.taxTotal, salesOrder.currencyCode)}</span>
              </div>
              <div className="so-detail__totals-row so-detail__totals-row--grand">
                <span>Grand Total</span>
                <strong>{formatCurrency(salesOrder.total, salesOrder.currencyCode)}</strong>
              </div>
            </div>
          </>
        ) : (
          <>
            {canEditLines && (
              <div className="so-detail__doc-toolbar">
                <button type="button" className="so-detail__edit-btn" onClick={startEdit}>
                  <Pencil size={14} aria-hidden />
                  Edit items
                </button>
              </div>
            )}
            <InvoiceDocumentBody
              invoice={salesOrder}
              itemClassName="admin-invoice-detail-item"
              totalsAfterItems
            />
          </>
        )}
      </section>

      {showPayment && (
        <section className="so-detail__payment">
          <h3 className="so-detail__section-title">Payment</h3>
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
            <div className="so-detail__payment-form">
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
              Payment submitted. Waiting for verification.
            </p>
          )}
        </section>
      )}

      {showWorkflowActions && workflowActions && (
        <footer className="so-detail__actions">
          {workflowActions.canReady && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(workflowActions.actionBusy)}
              onClick={workflowActions.onReady}
            >
              <IndianRupee size={16} aria-hidden />
              {workflowActions.actionBusy === 'ready' ? 'Updating…' : 'Ready for payment'}
            </button>
          )}
          {workflowActions.canVerify && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(workflowActions.actionBusy)}
              onClick={workflowActions.onVerify}
            >
              <Check size={16} aria-hidden />
              {workflowActions.actionBusy === 'verify' ? 'Verifying…' : 'Verify & invoice'}
            </button>
          )}
          {workflowActions.canVoid && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(workflowActions.actionBusy)}
              onClick={workflowActions.onVoid}
            >
              <Ban size={16} aria-hidden />
              {workflowActions.actionBusy === 'void' ? 'Voiding…' : 'Void'}
            </button>
          )}
        </footer>
      )}
    </div>
  );
};
