import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Package, Plus, Trash2 } from 'lucide-react';
import { DecimalAmountInput } from '../../components/DecimalAmountInput';
import { QuantityStepper } from '../../components/QuantityStepper';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { SoDetailCatalogAddSheet } from '../../components/salesOrders/SoDetailCatalogAddSheet';
import type { DraftEditLine } from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { useAuth } from '../../context/AuthContext';
import {
  purchaseOrderHasBl,
  purchaseOrderHasVendorPi,
  updateAdminPurchaseOrder,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderTracking,
} from '../../lib/admin-purchase-orders';
import { formatCurrency } from '../../lib/catalog';
import { newCartLineId } from '../../lib/gatcCart';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import { formatLogisticsDateTime } from '../../lib/logisticsDateTime';
import { canUpdatePurchaseOrders } from '../../lib/staffAccess';
import type { DealerInvoiceLineItem } from '../../types/invoices';
import { loadZohoVendorById, type ZohoVendorOption } from '../../lib/zoho-vendors';
import type { AdminPurchaseOrderDetailOutletContext } from './adminPurchaseOrderDetailContext';

type EditLine = {
  lineId: string;
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  rate: number;
  imageUrl: string | null;
};

function vendorPlaceParts(
  purchaseOrder: Pick<AdminPurchaseOrderDetail, 'vendorCity' | 'vendorState' | 'vendorCountry'>,
  vendor?: Pick<ZohoVendorOption, 'city' | 'state' | 'country'> | null,
): string {
  return [
    purchaseOrder.vendorCity || vendor?.city,
    purchaseOrder.vendorState || vendor?.state,
    purchaseOrder.vendorCountry || vendor?.country,
  ].filter(Boolean).join(', ');
}

function purchaseOrderPaidDate(purchaseOrder: AdminPurchaseOrderDetail): string | null {
  return purchaseOrder.kotakPayout?.date
    || purchaseOrder.tracking.paymentDate
    || purchaseOrder.kotakPayout?.associatedAt
    || null;
}

const LOCKED_STATUSES = new Set(['cancelled', 'canceled', 'billed', 'closed', 'void']);

function linesFromPurchaseOrder(po: AdminPurchaseOrderDetail): EditLine[] {
  return po.lineItems.map(item => ({
    lineId: item.id || newCartLineId(),
    productId: String(item.itemId ?? '').trim(),
    name: item.name,
    sku: item.sku,
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    rate: Math.round(Number(item.rate ?? 0) * 100) / 100,
    imageUrl: item.imageUrl,
  }));
}

function toDraftLines(lines: EditLine[]): DraftEditLine[] {
  return lines.map(line => ({
    lineId: line.lineId,
    productId: line.productId,
    name: line.name,
    sku: line.sku,
    description: null,
    imageUrl: line.imageUrl,
    catalogRate: line.rate,
    gatcFeePerUnit: 0,
    gatcStampingPriceId: null,
    gatcStampingRange: null,
    rate: line.rate,
    unit: 'pcs',
    quantity: line.quantity,
    stockStatus: null,
    categoryName: null,
    categoryId: null,
  }));
}

function fromDraftLines(lines: DraftEditLine[]): EditLine[] {
  return lines
    .filter(line => line.productId && line.quantity > 0)
    .map(line => ({
      lineId: line.lineId || newCartLineId(),
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      quantity: Math.max(1, Math.floor(line.quantity || 1)),
      rate: Math.round(Number(line.rate ?? line.catalogRate ?? 0) * 100) / 100,
      imageUrl: line.imageUrl,
    }));
}

function currencySymbol(code: string): string {
  const currency = String(code || 'INR').trim().toUpperCase() || 'INR';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

function linesFingerprint(lines: EditLine[]): string {
  return JSON.stringify(lines.map(line => ({
    productId: line.productId,
    quantity: line.quantity,
    rate: line.rate,
  })));
}

type PoTrackEvent = {
  key: string;
  title: string;
  location: string | null;
  at: string | null;
};

function trackingSortMs(value: string | null | undefined): number {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 0;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? 0 : ms;
}

const TRACKING_MILESTONES: Array<{ key: keyof PurchaseOrderTracking; title: string }> = [
  { key: 'loadingDate', title: 'Loading' },
  { key: 'sailingDate', title: 'Sailing' },
  { key: 'arrivalDate', title: 'Arrival at port' },
  { key: 'receivedDate', title: 'Received at warehouse' },
];

const SKIPPED_LOG_ACTIONS = new Set(['kotak_payout_associated', 'kotak_payout_paid', 'tracking_updated']);

function buildPoTrackingEvents(purchaseOrder: AdminPurchaseOrderDetail): PoTrackEvent[] {
  const events: PoTrackEvent[] = [];
  const poDate = purchaseOrder.tracking.poDate || purchaseOrder.date;
  if (poDate) {
    events.push({
      key: 'po',
      title: 'Purchase order',
      location: purchaseOrder.vendorName?.trim() || null,
      at: poDate,
    });
  }

  const payout = purchaseOrder.kotakPayout;
  const paymentAt = payout?.associatedAt || payout?.date || purchaseOrder.tracking.paymentDate;
  if (payout || paymentAt) {
    const location = [
      payout?.payee?.trim() || null,
      payout
        ? `${formatCurrency(payout.amountInr, 'INR')} → $${payout.amountUsd.toFixed(2)}`
        : null,
      payout?.bankCharges
        ? `Bank charges ${formatCurrency(payout.bankCharges, 'INR')}`
        : null,
      payout?.referenceNumber?.trim() || null,
    ].filter(Boolean).join(' · ') || null;
    events.push({
      key: 'payment',
      title: 'Payment',
      location,
      at: paymentAt,
    });
  }

  if (purchaseOrderHasVendorPi(purchaseOrder.vendorPi)) {
    events.push({
      key: 'pi',
      title: 'Vendor PI',
      location: purchaseOrder.vendorPi?.fileName || null,
      at: purchaseOrder.vendorPi?.uploadedAt || null,
    });
  }

  if (purchaseOrderHasBl(purchaseOrder.bl)) {
    events.push({
      key: 'bl',
      title: 'Bill of lading',
      location: purchaseOrder.bl?.containerNumber?.trim() || purchaseOrder.bl?.fileName || null,
      at: purchaseOrder.bl?.uploadedAt || null,
    });
  }

  for (const row of TRACKING_MILESTONES) {
    const at = purchaseOrder.tracking[row.key];
    if (!at) continue;
    events.push({
      key: row.key,
      title: row.title,
      location: null,
      at,
    });
  }

  for (const log of purchaseOrder.activityLogs) {
    if (SKIPPED_LOG_ACTIONS.has(log.action)) continue;
    const title = log.detail.trim() || log.action.trim();
    if (!title) continue;
    events.push({
      key: `log-${log.at}-${log.action}`,
      title,
      location: log.byName,
      at: log.at,
    });
  }

  return events.sort((a, b) => trackingSortMs(b.at) - trackingSortMs(a.at));
}

function PurchaseOrderTrackingCard({
  purchaseOrder,
}: {
  purchaseOrder: AdminPurchaseOrderDetail;
}) {
  const events = buildPoTrackingEvents(purchaseOrder);
  if (!events.length) return null;

  return (
    <section className="panel glass mb-4 po-tracking" aria-label="Tracking history">
      <div className="po-tracking__head">
        <h2>Tracking history</h2>
      </div>
      <ol className="logistics-booking__track-timeline">
        {events.map((event, index) => {
          const atLabel = formatLogisticsDateTime(event.at);
          return (
            <li
              key={event.key}
              className={index === 0 ? 'is-latest' : undefined}
            >
              <span className="logistics-booking__track-timeline-dot" aria-hidden />
              <div className="logistics-booking__track-timeline-copy">
                <strong>{event.title}</strong>
                {event.location ? (
                  <span className="logistics-booking__track-timeline-location">
                    {event.location}
                  </span>
                ) : null}
                {atLabel ? (
                  <time className="logistics-booking__track-timeline-at" dateTime={event.at ?? undefined}>
                    {atLabel}
                  </time>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export const AdminPurchaseOrderDocumentPage: React.FC = () => {
  const { purchaseOrder, setPurchaseOrder, purchaseOrderId } = useOutletContext<AdminPurchaseOrderDetailOutletContext>();
  const { user } = useAuth();
  const canEdit = canUpdatePurchaseOrders(user)
    && Boolean(purchaseOrder)
    && !LOCKED_STATUSES.has(String(purchaseOrder?.status ?? '').toLowerCase());

  const [lines, setLines] = useState<EditLine[]>([]);
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSession, setCatalogSession] = useState(0);
  const [vendorDirectory, setVendorDirectory] = useState<ZohoVendorOption | null>(null);

  useEffect(() => {
    if (!purchaseOrder) return;
    const nextLines = linesFromPurchaseOrder(purchaseOrder);
    setLines(nextLines);
    setBaseline(linesFingerprint(nextLines));
    setSaveError('');
  }, [purchaseOrder]);

  useEffect(() => {
    const vendorId = purchaseOrder?.vendorId?.trim();
    if (!purchaseOrder || !vendorId) {
      setVendorDirectory(null);
      return;
    }
    if (purchaseOrder.vendorCity && purchaseOrder.vendorState && purchaseOrder.vendorCountry) {
      setVendorDirectory(null);
      return;
    }
    let active = true;
    void loadZohoVendorById(vendorId)
      .then(vendor => {
        if (active) setVendorDirectory(vendor);
      })
      .catch(() => {
        if (active) setVendorDirectory(null);
      });
    return () => {
      active = false;
    };
  }, [purchaseOrder]);

  const dirty = useMemo(
    () => linesFingerprint(lines) !== baseline,
    [lines, baseline],
  );

  const previewItems: DealerInvoiceLineItem[] = useMemo(
    () => lines.map(line => ({
      id: line.lineId,
      itemId: line.productId,
      name: line.name,
      description: null,
      sku: line.sku,
      quantity: line.quantity,
      rate: line.rate,
      total: Math.round(line.rate * line.quantity * 100) / 100,
      imageUrl: line.imageUrl,
    })),
    [lines],
  );

  const previewSubtotal = useMemo(
    () => previewItems.reduce((sum, item) => sum + item.total, 0),
    [previewItems],
  );

  if (!purchaseOrder) return null;

  const currency = purchaseOrder.currencyCode || 'INR';
  const vendorPlace = vendorPlaceParts(purchaseOrder, vendorDirectory);
  const poDate = purchaseOrder.tracking.poDate || purchaseOrder.date;

  const resetFromPo = () => {
    setLines(linesFromPurchaseOrder(purchaseOrder));
    setSaveError('');
  };

  const save = async () => {
    if (!canEdit) return;
    const payloadLines = lines.filter(line => line.productId && line.quantity > 0);
    if (!payloadLines.length) {
      setSaveError('Add at least one item.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const next = await updateAdminPurchaseOrder({
        purchaseOrderId,
        vendorId: purchaseOrder.vendorId,
        date: purchaseOrder.date,
        deliveryDate: purchaseOrder.deliveryDate,
        referenceNumber: purchaseOrder.referenceNumber,
        notes: purchaseOrder.notes,
        lines: payloadLines.map(line => ({
          productId: line.productId,
          quantity: line.quantity,
          rate: line.rate,
          name: line.name,
        })),
      });
      setPurchaseOrder(next);
    } catch (err) {
      setSaveError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="goods-receipt-detail__meta mb-4">
        <div>
          <div className="text-muted text-sm">Vendor</div>
          <strong>{purchaseOrder.vendorName ?? '—'}</strong>
          {vendorPlace ? (
            <p className="text-muted text-sm mt-1 mb-0">{vendorPlace}</p>
          ) : null}
        </div>
        <div className="goods-receipt-detail__dates goods-receipt-detail__dates--four">
          <div className="goods-receipt-detail__date goods-receipt-detail__date--po">
            <div className="text-muted text-sm">PO date</div>
            <strong>{formatInvoiceDate(poDate)}</strong>
          </div>
          <div className="goods-receipt-detail__date goods-receipt-detail__date--paid">
            <div className="text-muted text-sm">Paid</div>
            <strong>{formatInvoiceDate(purchaseOrderPaidDate(purchaseOrder))}</strong>
          </div>
          <div className="goods-receipt-detail__date goods-receipt-detail__date--sailed">
            <div className="text-muted text-sm">Sailed</div>
            <strong>{formatInvoiceDate(purchaseOrder.tracking.sailingDate)}</strong>
          </div>
          <div className="goods-receipt-detail__date goods-receipt-detail__date--received">
            <div className="text-muted text-sm">Received</div>
            <strong>{formatInvoiceDate(purchaseOrder.tracking.receivedDate)}</strong>
          </div>
        </div>
        {purchaseOrder.referenceNumber && (
          <p className="text-muted text-sm mb-0">Ref {purchaseOrder.referenceNumber}</p>
        )}
        {purchaseOrder.notes && (
          <p className="text-muted text-sm mb-0">{purchaseOrder.notes}</p>
        )}
      </section>

      <PurchaseOrderTrackingCard purchaseOrder={purchaseOrder} />

      {canEdit ? (
        <section className="panel glass staff-create-so-page__section">
          <div className="staff-create-so-page__section-head">
            <h2>Items</h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={saving}
              onClick={() => {
                setCatalogSession(n => n + 1);
                setCatalogOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              Add item
            </button>
          </div>
          {lines.length === 0 ? (
            <div className="staff-create-so-page__cart-empty">
              <Package size={36} aria-hidden />
              <p>No items. Add from catalog.</p>
            </div>
          ) : (
            <ul className="po-edit-lines">
              {lines.map(line => (
                <li key={line.lineId} className="po-edit-line">
                  <div className="po-edit-line__head">
                    <div className="po-edit-line__media">
                      {line.imageUrl ? (
                        <CategoryThumbnail src={line.imageUrl} knockout={false} />
                      ) : (
                        <Package size={24} aria-hidden />
                      )}
                    </div>
                    <DocumentLineItemSpec
                      className="po-edit-line__spec"
                      name={line.name}
                      sku={line.sku}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm po-edit-line__remove"
                      disabled={saving || lines.length <= 1}
                      onClick={() => setLines(prev => prev.filter(row => row.lineId !== line.lineId))}
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                  <div className="po-edit-line__fields">
                    <label className="po-edit-line__field">
                      <span className="text-muted text-sm">Rate</span>
                      <span className="po-edit-line__rate">
                        <span className="po-edit-line__currency" aria-hidden="true">
                          {currencySymbol(currency)}
                        </span>
                        <DecimalAmountInput
                          className="input-field"
                          value={line.rate}
                          min={0}
                          decimals={2}
                          disabled={saving}
                          onChange={next => {
                            if (next == null) return;
                            setLines(prev => prev.map(row => (
                              row.lineId === line.lineId
                                ? { ...row, rate: Math.round(next * 100) / 100 }
                                : row
                            )));
                          }}
                          aria-label={`Rate for ${line.name} in ${currency}`}
                        />
                      </span>
                    </label>
                    <div className="po-edit-line__field">
                      <span className="text-muted text-sm">Qty</span>
                      <QuantityStepper
                        value={line.quantity}
                        disabled={saving}
                        onChange={qty => {
                          setLines(prev => prev.map(row => (
                            row.lineId === line.lineId ? { ...row, quantity: qty } : row
                          )));
                        }}
                        aria-label={`Quantity for ${line.name}`}
                      />
                    </div>
                    <div className="po-edit-line__field po-edit-line__total">
                      <span className="text-muted text-sm">Total</span>
                      <strong>{formatCurrency(line.rate * line.quantity, currency)}</strong>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="create-po-page__totals">
            <p>
              <span className="text-muted">Estimated subtotal</span>
              <strong>{formatCurrency(previewSubtotal, currency)}</strong>
            </p>
          </div>
        </section>
      ) : (
        <InvoiceDocumentBody
          invoice={purchaseOrder}
          currencyCode={currency}
          itemClassName="admin-invoice-detail-item"
        />
      )}

      {saveError ? (
        <div className="products-inline-error panel glass" role="alert">
          <span>{saveError}</span>
        </div>
      ) : null}

      {canEdit && dirty ? (
        <footer className="so-detail__actions so-detail__actions--edit-dock" data-capture-ignore="1">
          <div className="so-detail__edit-dock-meta">
            <strong>Unsaved purchase order changes</strong>
            <span className="text-muted text-sm">
              Est. {formatCurrency(previewSubtotal, currency)} before tax
            </span>
          </div>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={resetFromPo}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || lines.length === 0}
            onClick={() => { void save(); }}
          >
            {saving ? 'Saving…' : 'Save to Zoho'}
          </button>
        </footer>
      ) : null}

      <SoDetailCatalogAddSheet
        open={catalogOpen}
        sessionKey={catalogSession}
        seedLines={toDraftLines(lines)}
        orderCategory={null}
        allowAllProducts
        onClose={() => setCatalogOpen(false)}
        onApply={next => {
          setLines(fromDraftLines(next));
          setCatalogOpen(false);
        }}
      />
    </>
  );
};
