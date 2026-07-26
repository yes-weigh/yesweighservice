import React, { useCallback, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  Ban,
  Check,
  FileText,
  ImageIcon,
  IndianRupee,
  Pencil,
  Trash2,
} from 'lucide-react';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import {
  SalesOrderDraftLineEditor,
  type DraftEditLine,
} from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage } from '../../lib/dealerOrders';
import {
  listCustomerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import {
  submitSalesOrderPayment,
  updateDraftSalesOrderLines,
  updateDraftSalesOrderShipping,
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
  const [editingShip, setEditingShip] = useState(false);
  const [shipAddresses, setShipAddresses] = useState<ShippingAddress[]>([]);
  const [shipLoading, setShipLoading] = useState(false);
  const [shipError, setShipError] = useState('');
  const [shipSelection, setShipSelection] = useState<ShippingSelection | null>(null);
  const [savingShip, setSavingShip] = useState(false);

  const stage = String(salesOrder?.yesOneStage || '');
  const zohoStatus = String(salesOrder?.status || '').toLowerCase().replace(/\s+/g, '_');
  const canEditDraft = isOps
    && (zohoStatus === 'draft' || zohoStatus === 'pending')
    && stage !== 'payment_submitted'
    && stage !== 'completed'
    && stage !== 'void';
  const canEditLines = canEditDraft;
  const canEditShipping = canEditDraft && Boolean(salesOrder?.customerId?.trim());
  const canPay = isDealer && (stage === 'ready_for_payment' || stage === 'payment_submitted');
  const pdfPath = `${listPath}/${salesOrderId}/view`;

  const loadShipAddresses = useCallback((customerId: string, currentAddressId?: string | null) => {
    setShipLoading(true);
    setShipError('');
    void listCustomerShippingAddresses(customerId)
      .then(rows => {
        setShipAddresses(rows);
        const id = currentAddressId?.trim();
        if (id && rows.some(r => r.addressId === id)) {
          setShipSelection({ mode: 'saved', addressId: id });
        }
      })
      .catch(err => {
        setShipAddresses([]);
        setShipError(dealerOrderErrorMessage(err));
      })
      .finally(() => setShipLoading(false));
  }, []);

  const startEditShipping = () => {
    if (!salesOrder?.customerId) return;
    setEditingShip(true);
    setShipSelection(null);
    loadShipAddresses(salesOrder.customerId, salesOrder.shippingAddressId);
  };

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

  const saveShipping = async () => {
    if (!salesOrderId || savingShip || !shipSelection) return;
    setSavingShip(true);
    try {
      const next = await updateDraftSalesOrderShipping(salesOrderId, shipSelection);
      setSalesOrder(next);
      setEditingShip(false);
      setShipSelection(null);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSavingShip(false);
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
    && (
      workflowActions.canReady
      || workflowActions.canVerify
      || workflowActions.canVoid
      || workflowActions.canDelete
    ),
  );
  const showPayment = canPay
    || (isOps && (stage === 'payment_submitted' || stage === 'completed' || salesOrder.paymentScreenshotUrl));

  const paymentScreenshotUrl = salesOrder.paymentScreenshotUrl?.trim() || '';
  const topActionClass = paymentScreenshotUrl
    ? 'invoice-detail-top__actions invoice-detail-top__actions--pair'
    : 'invoice-detail-top__actions invoice-detail-top__actions--single';

  return (
    <div className={`so-detail${showWorkflowActions ? ' so-detail--with-actions' : ''}`}>
      {/* Compact header: PDF (+ payment screenshot) + customer + shipping */}
      <header className="so-detail__header">
        <div className="invoice-detail-top so-detail__top-actions">
          <div className={topActionClass} role="group" aria-label="Sales order actions">
            <Link
              to={pdfPath}
              className="invoice-detail-top__card invoice-detail-top__card--blue is-active"
            >
              <span className="invoice-detail-top__card-icon">
                <FileText size={28} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="invoice-detail-top__card-label">Sales order</span>
            </Link>
            {paymentScreenshotUrl ? (
              <a
                href={paymentScreenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="invoice-detail-top__card invoice-detail-top__card--purple"
              >
                <span className="invoice-detail-top__card-icon">
                  <ImageIcon size={28} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="invoice-detail-top__card-label">Payment</span>
              </a>
            ) : null}
          </div>
        </div>

        <DocumentPartyBlock
          customerName={salesOrder.customerName}
          hideName={isDealer}
          address={salesOrder.shippingAddress}
          telHref={isOps ? salesOrder.customerTelHref : null}
          whatsappHref={isOps ? salesOrder.customerWhatsappHref : null}
          emptyAddressLabel="No address on file"
        >
          {editingShip ? (
            <div className="so-detail__ship-edit">
              <ShippingAddressPicker
                addresses={shipAddresses}
                loading={shipLoading}
                error={shipError}
                disabled={savingShip}
                value={shipSelection}
                onChange={setShipSelection}
                onRefresh={() => {
                  if (salesOrder.customerId) {
                    loadShipAddresses(salesOrder.customerId, salesOrder.shippingAddressId);
                  }
                }}
              />
              <div className="so-detail__ship-edit-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={savingShip}
                  onClick={() => {
                    setEditingShip(false);
                    setShipSelection(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={savingShip || !shipSelection || shipLoading}
                  onClick={() => { void saveShipping(); }}
                >
                  {savingShip ? 'Saving…' : 'Save address'}
                </button>
              </div>
            </div>
          ) : (
            canEditShipping ? (
              <button
                type="button"
                className="so-detail__edit-btn so-detail__ship-change"
                onClick={startEditShipping}
              >
                <Pencil size={14} aria-hidden />
                Change address
              </button>
            ) : null
          )}
        </DocumentPartyBlock>

        {isOps && (
          <DocumentKamStrip
            salespersonId={salesOrder.salespersonId}
            salespersonName={salesOrder.salespersonName}
          />
        )}
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
          {workflowActions.canDelete && (
            <button
              type="button"
              className="btn btn-secondary so-detail__delete-btn"
              disabled={Boolean(workflowActions.actionBusy)}
              onClick={workflowActions.onDelete}
            >
              <Trash2 size={16} aria-hidden />
              {workflowActions.actionBusy === 'delete' ? 'Deleting…' : 'Delete draft'}
            </button>
          )}
        </footer>
      )}
    </div>
  );
};
