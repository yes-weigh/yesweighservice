import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  BadgeCheck,
  Ban,
  Check,
  FileText,
  ImageIcon,
  IndianRupee,
  Pencil,
  Trash2,
  UserRound,
} from 'lucide-react';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { ThemeSelect } from '../../components/ThemeSelect';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import {
  SalesOrderDraftLineEditor,
  draftLinesFromSalesOrderItems,
  type DraftEditLine,
} from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { ZoomableImageDialog } from '../../components/ZoomableImageDialog';
import { useAuth } from '../../context/AuthContext';
import { fetchCatalog, formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage } from '../../lib/dealerOrders';
import {
  listCustomerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import { hasStaffPermission } from '../../lib/staffAccess';
import {
  submitSalesOrderPayment,
  canEditSalesOrderDraft,
  updateDraftSalesOrderLines,
  updateDraftSalesOrderShipping,
  uploadSalesOrderPaymentScreenshot,
} from '../../lib/salesOrderWorkflow';
import { formatInvoiceDate } from '../../lib/invoices';
import { Capacitor } from '@capacitor/core';
import {
  buildSoShareDocument,
  buildSpareInchargeSoShareMessage,
  createSoShareLink,
} from '../../lib/soShareLinks';
import { loadSpareInchargeSettings } from '../../lib/spareIncharge';
import {
  openWhatsAppWithText,
  prepareWhatsAppWindow,
  whatsappPhoneDigits,
} from '../../lib/whatsappShareCard';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';
import { portalSalesOrderRemarks } from '../../lib/admin-sales-orders';

function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export const AdminSalesOrderDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const isDealer = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const isOps = user?.role === 'staff' || user?.role === 'super_admin';
  const canManageOrders = isOps && (
    user?.role === 'super_admin' || hasStaffPermission(user, 'orders.manage')
  );
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
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [editingShip, setEditingShip] = useState(false);
  const [shipAddresses, setShipAddresses] = useState<ShippingAddress[]>([]);
  const [shipLoading, setShipLoading] = useState(false);
  const [shipError, setShipError] = useState('');
  const [shipSelection, setShipSelection] = useState<ShippingSelection | null>(null);
  const [savingShip, setSavingShip] = useState(false);
  const [catalogDescByItemId, setCatalogDescByItemId] = useState<Record<string, string>>({});
  const [salespersonStaffUid, setSalespersonStaffUid] = useState('');
  const [showPaymentProof, setShowPaymentProof] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareCaptureRef = useRef<HTMLDivElement>(null);
  const soDetailRef = useRef<HTMLDivElement>(null);

  const stage = String(salesOrder?.yesOneStage || '');
  const canEditDraft = isOps
    && (user?.role === 'super_admin' || canManageOrders)
    && canEditSalesOrderDraft({
      role: user?.role,
      yesOneStage: stage,
      zohoStatus: salesOrder?.status,
    });
  const canEditLines = canEditDraft;
  const canEditShipping = canEditDraft && Boolean(salesOrder?.customerId?.trim());
  const canPay = (
    (isDealer || canManageOrders)
    && (stage === 'ready_for_payment' || stage === 'payment_submitted')
  );
  const canUploadPayment = canPay && stage === 'ready_for_payment';
  const pdfPath = `${listPath}/${salesOrderId}/view`;

  useEffect(() => {
    if (!salesOrder?.lineItems?.length) return;
    const missing = salesOrder.lineItems.filter(line => !line.description?.trim());
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchCatalog()
      .then(res => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const product of res.items) {
          const desc = product.description?.trim();
          if (!desc) continue;
          next[product.id] = desc;
          if (product.sku) next[`sku:${product.sku}`] = desc;
        }
        setCatalogDescByItemId(next);
      })
      .catch(() => { /* keep SO usable without catalog specs */ });
    return () => { cancelled = true; };
  }, [salesOrder?.lineItems]);

  const documentInvoice = useMemo(() => {
    if (!salesOrder) return null;
    return {
      ...salesOrder,
      lineItems: salesOrder.lineItems.map(line => {
        if (line.description?.trim()) return line;
        const fromCatalog = catalogDescByItemId[line.itemId || '']
          || catalogDescByItemId[line.id]
          || (line.sku ? catalogDescByItemId[`sku:${line.sku}`] : null)
          || null;
        return fromCatalog ? { ...line, description: fromCatalog } : line;
      }),
    };
  }, [salesOrder, catalogDescByItemId]);

  const portalRemarks = useMemo(
    () => (salesOrder ? portalSalesOrderRemarks(salesOrder) : null),
    [salesOrder],
  );

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
    void draftLinesFromSalesOrderItems(
      salesOrder.lineItems.map(line => {
        const productId = line.itemId || line.id;
        const description = line.description?.trim()
          || catalogDescByItemId[productId]
          || catalogDescByItemId[line.id]
          || (line.sku ? catalogDescByItemId[`sku:${line.sku}`] : null)
          || null;
        return {
          productId,
          itemId: line.itemId,
          name: line.name,
          sku: line.sku ?? null,
          description,
          imageUrl: line.imageUrl ?? null,
          rate: Number(line.rate) || 0,
          quantity: Math.max(1, Math.floor(line.quantity || 1)),
          unit: 'pcs',
          stockStatus: null,
        };
      }),
    ).then(next => {
      setEditLines(next);
      setEditing(true);
    }).catch(err => {
      window.alert(err instanceof Error ? err.message : 'Could not open line editor.');
    });
  };

  const saveLines = async () => {
    if (!salesOrderId || savingLines) return;
    const lines = editLines
      .filter(line => line.productId && line.quantity > 0)
      .map(line => ({
        productId: line.productId,
        quantity: line.quantity,
        rate: line.catalogRate,
        gatcStampingPriceId: line.gatcStampingPriceId ?? null,
      }));
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
      });
      setSalesOrder(next);
      setPaymentFile(null);
      window.alert(
        isDealer
          ? 'Payment proof submitted. Staff will verify and complete your order.'
          : 'Payment proof submitted. Super admin can verify and invoice.',
      );
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSubmittingPayment(false);
    }
  };

  useEffect(() => {
    if (!workflowActions?.assignableStaff.length || salespersonStaffUid) return;
    setSalespersonStaffUid(workflowActions.assignableStaff[0]?.uid ?? '');
  }, [workflowActions?.assignableStaff, salespersonStaffUid]);

  const handleShareScreenshot = useCallback(async () => {
    if (!salesOrder || sharing) return;
    // Web: pre-open so WhatsApp is not popup-blocked after the quick Firestore write.
    const isNative = Capacitor.isNativePlatform();
    const whatsappWindow = isNative ? null : prepareWhatsAppWindow();
    setSharing(true);
    try {
      const soNumber = salesOrder.salesOrderNumber || salesOrderId || 'sales-order';
      const dateLabel = salesOrder.date ? formatInvoiceDate(salesOrder.date) : '';
      const document = buildSoShareDocument({
        salesOrderId,
        salesOrderNumber: soNumber,
        dateLabel,
        customerName: salesOrder.customerName,
        shippingAddress: salesOrder.shippingAddress,
        currencyCode: salesOrder.currencyCode,
        subtotal: salesOrder.subtotal,
        taxTotal: salesOrder.taxTotal,
        total: salesOrder.total,
        notes: portalSalesOrderRemarks(salesOrder),
        lineItems: salesOrder.lineItems,
      });

      const [settings, link] = await Promise.all([
        loadSpareInchargeSettings(),
        createSoShareLink(document),
      ]);
      const sparePhone = whatsappPhoneDigits(settings.whatsappNumber);
      if (!sparePhone) {
        whatsappWindow?.close();
        window.alert(
          'No spare incharge WhatsApp number set. Add it under HR → Spare Incharge.',
        );
        return;
      }

      openWhatsAppWithText(
        buildSpareInchargeSoShareMessage({
          salesOrderNumber: soNumber,
          dateLabel,
          shareUrl: link.url,
        }),
        sparePhone,
        whatsappWindow,
      );
    } catch (err) {
      whatsappWindow?.close();
      if (err instanceof Error && err.name === 'AbortError') return;
      window.alert(err instanceof Error ? err.message : 'Could not share sales order.');
    } finally {
      setSharing(false);
    }
  }, [salesOrder, salesOrderId, sharing]);

  if (!salesOrder) return null;

  const showWorkflowActions = Boolean(
    workflowActions
    && (
      workflowActions.canReady
      || workflowActions.canVerify
      || workflowActions.needsSalesperson
      || workflowActions.canApplySalesperson
      || workflowActions.canAssignSalespersonStaff
      || workflowActions.canMarkInvoiced
      || workflowActions.canVoid
      || workflowActions.canDelete
    ),
  );
  const showPayment = canPay
    || (isOps && (stage === 'payment_submitted' || stage === 'completed' || salesOrder.paymentScreenshotUrl));
  const priceChanges = salesOrder.yesOnePriceChanges ?? [];
  const showPriceChanges = Boolean(salesOrder.yesOnePriceCustomized && priceChanges.length);

  const paymentScreenshotUrl = salesOrder.paymentScreenshotUrl?.trim() || '';
  const topActionClass = paymentScreenshotUrl
    ? 'invoice-detail-top__actions invoice-detail-top__actions--pair'
    : 'invoice-detail-top__actions invoice-detail-top__actions--single';

  return (
    <div ref={soDetailRef} className="so-detail so-detail--with-actions">
      <div ref={shareCaptureRef} className="so-detail__share-capture">
        <div className="so-detail__share-title">
          <strong>{salesOrder.salesOrderNumber || 'Sales order'}</strong>
          {salesOrder.date ? (
            <span>{formatInvoiceDate(salesOrder.date)}</span>
          ) : null}
        </div>

      {/* Compact header: PDF (+ payment screenshot) + customer + shipping */}
      <header className="so-detail__header">
        <div className="invoice-detail-top so-detail__top-actions" data-capture-ignore="1">
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
              <button
                type="button"
                className="invoice-detail-top__card invoice-detail-top__card--purple"
                onClick={() => setShowPaymentProof(true)}
              >
                <span className="invoice-detail-top__card-icon">
                  <ImageIcon size={28} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="invoice-detail-top__card-label">Payment</span>
              </button>
            ) : null}
          </div>
        </div>

        <DocumentPartyBlock
          className="so-detail__party"
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
            showMissing
          />
        )}
      </header>

      {isOps && workflowActions?.needsSalesperson ? (
        <div
          className="products-inline-error panel glass so-detail__salesperson-banner"
          data-capture-ignore="1"
        >
          <UserRound size={18} aria-hidden />
          <div className="so-detail__salesperson-banner-copy">
            <span>
              Sales staff is required before Verify &amp; invoice.
              {workflowActions.dealerPath ? (
                <>
                  {' '}
                  <Link to={workflowActions.dealerPath}>Open dealer</Link>
                  {' '}
                  to assign a KAM with a linked Zoho salesperson, or pick staff below.
                </>
              ) : (
                <> Assign sales staff on the dealer, or pick staff below.</>
              )}
            </span>
            {workflowActions.canAssignSalespersonStaff ? (
              <div className="so-detail__salesperson-assign">
                <ThemeSelect
                  id="so-salesperson-staff"
                  value={salespersonStaffUid}
                  placeholder="Select staff…"
                  options={workflowActions.assignableStaff.map(staff => ({
                    value: staff.uid,
                    label: staff.displayName,
                  }))}
                  onChange={setSalespersonStaffUid}
                  aria-label="Sales staff"
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={
                    !salespersonStaffUid.trim()
                    || Boolean(workflowActions.actionBusy)
                  }
                  onClick={() => workflowActions.onApplySalespersonFromStaff(salespersonStaffUid)}
                >
                  {workflowActions.actionBusy === 'applySalespersonStaff'
                    ? 'Applying…'
                    : 'Set salesperson'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {portalRemarks ? (
        <section className="so-detail__remarks panel glass">
          <h3 className="so-detail__section-title">Remarks</h3>
          <p className="so-detail__remarks-body">{portalRemarks}</p>
        </section>
      ) : null}

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
              allowRateEdit
              allowFreight={
                salesOrder.salesOrderCategory === 'product'
                || salesOrder.salesOrderCategory === 'spare'
                || (
                  !salesOrder.salesOrderCategory
                  && !(salesOrder.categories ?? []).includes('software_key')
                )
              }
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
              <div className="so-detail__doc-toolbar" data-capture-ignore="1">
                <button type="button" className="so-detail__edit-btn" onClick={startEdit}>
                  <Pencil size={14} aria-hidden />
                  Edit items
                </button>
              </div>
            )}
            <InvoiceDocumentBody
              invoice={documentInvoice ?? salesOrder}
              itemClassName="admin-invoice-detail-item"
              totalsAfterItems
            />
          </>
        )}
      </section>

      {showPriceChanges ? (
        <section className="so-detail__price-changes panel glass">
          <h3 className="so-detail__section-title">Custom prices</h3>
          <ul className="so-detail__price-changes-list">
            {priceChanges.map(change => (
              <li key={`${change.productId}-${change.changedAt ?? change.rate}`}>
                <div>
                  <strong>{change.name}</strong>
                  {change.sku ? <span className="text-muted text-sm"> · {change.sku}</span> : null}
                </div>
                <p className="text-sm mb-0">
                  {formatCurrency(change.catalogRate, salesOrder.currencyCode)}
                  {' → '}
                  <strong>{formatCurrency(change.rate, salesOrder.currencyCode)}</strong>
                  {change.changedByName ? ` · ${change.changedByName}` : ''}
                  {change.changedAt
                    ? ` · ${new Date(change.changedAt).toLocaleString('en-IN')}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showPayment && (
        <section className="so-detail__payment panel glass" data-capture-ignore="1">
          <div className="so-detail__payment-head">
            <h3 className="so-detail__section-title">Payment</h3>
            {salesOrder.paymentAmount != null ? (
              <div className="so-detail__payment-due">
                <span className="so-detail__payment-due-label">Amount due</span>
                <strong className="so-detail__payment-due-value">
                  {formatCurrency(salesOrder.paymentAmount, salesOrder.currencyCode)}
                </strong>
              </div>
            ) : null}
          </div>

          {canUploadPayment && (
            <div className="so-detail__payment-form" data-capture-ignore="1">
              <div className="so-detail__payment-field">
                <span>Payment screenshot</span>
                <label className="so-detail__payment-file" htmlFor="so-payment-file">
                  <span className="so-detail__payment-file-icon" aria-hidden>
                    <ImageIcon size={18} />
                  </span>
                  <span className="so-detail__payment-file-copy">
                    <strong>{paymentFile ? paymentFile.name : 'Choose image'}</strong>
                    <span className="text-muted text-sm">
                      {paymentFile ? 'Tap to replace' : 'PNG, JPG — bank transfer screenshot'}
                    </span>
                  </span>
                  <input
                    id="so-payment-file"
                    type="file"
                    accept="image/*"
                    onChange={e => setPaymentFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <button
                type="button"
                className="btn btn-primary so-detail__payment-submit"
                disabled={submittingPayment}
                onClick={() => { void handleSubmitPayment(); }}
              >
                <IndianRupee size={16} aria-hidden />
                {submittingPayment ? 'Submitting…' : 'Submit payment proof'}
              </button>
            </div>
          )}

          {stage === 'payment_submitted' && !canUploadPayment && (
            <p className="so-detail__payment-waiting text-muted text-sm mb-0">
              Payment submitted. Waiting for verification.
            </p>
          )}
        </section>
      )}

      </div>

      <footer className="so-detail__actions" data-capture-ignore="1">
        <button
          type="button"
          className="btn btn-primary so-detail__share-btn so-detail__share-btn--whatsapp"
          disabled={sharing || Boolean(workflowActions?.actionBusy)}
          onClick={() => { void handleShareScreenshot(); }}
          aria-label="Share to spare incharge"
        >
          <WhatsAppIcon size={16} />
          {sharing ? 'Sharing…' : 'Share to spare incharge'}
        </button>
        {showWorkflowActions && workflowActions && (
          <>
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
          {workflowActions.canApplySalesperson && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(workflowActions.actionBusy)}
              onClick={workflowActions.onApplySalesperson}
            >
              <UserRound size={16} aria-hidden />
              {workflowActions.actionBusy === 'applySalesperson'
                ? 'Applying…'
                : 'Apply salesperson from dealer'}
            </button>
          )}
          {workflowActions.canAssignSalespersonStaff && !workflowActions.needsSalesperson ? (
            <div className="so-detail__actions-staff">
              <ThemeSelect
                id="so-salesperson-staff-footer"
                value={salespersonStaffUid}
                placeholder="Select staff…"
                options={workflowActions.assignableStaff.map(staff => ({
                  value: staff.uid,
                  label: staff.displayName,
                }))}
                onChange={setSalespersonStaffUid}
                aria-label="Sales staff"
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  !salespersonStaffUid.trim()
                  || Boolean(workflowActions.actionBusy)
                }
                onClick={() => workflowActions.onApplySalespersonFromStaff(salespersonStaffUid)}
              >
                <UserRound size={16} aria-hidden />
                {workflowActions.actionBusy === 'applySalespersonStaff'
                  ? 'Applying…'
                  : 'Set salesperson'}
              </button>
            </div>
          ) : null}
          {workflowActions.needsSalesperson && !workflowActions.canVerify && (
            <button
              type="button"
              className="btn btn-primary"
              disabled
              title="Assign sales staff on the dealer, then apply salesperson here"
            >
              <Check size={16} aria-hidden />
              Verify & invoice
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
          {workflowActions.canMarkInvoiced && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(workflowActions.actionBusy)}
              onClick={workflowActions.onMarkInvoiced}
              title="Use when this order was already invoiced in Zoho"
            >
              <BadgeCheck size={16} aria-hidden />
              {workflowActions.actionBusy === 'markInvoiced' ? 'Marking…' : 'Mark as invoiced'}
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
          </>
        )}
      </footer>

      {showPaymentProof && paymentScreenshotUrl ? (
        <ZoomableImageDialog
          src={paymentScreenshotUrl}
          title="Payment proof"
          alt="Payment screenshot"
          onClose={() => setShowPaymentProof(false)}
        />
      ) : null}
    </div>
  );
};
