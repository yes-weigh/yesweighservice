import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Package, Plus, Trash2 } from 'lucide-react';
import { DecimalAmountInput } from '../../components/DecimalAmountInput';
import { QuantityStepper } from '../../components/QuantityStepper';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { InvoiceCategoryBadge } from '../../components/invoices/InvoiceCategoryVisual';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { SoDetailCatalogAddSheet } from '../../components/salesOrders/SoDetailCatalogAddSheet';
import type { DraftEditLine } from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { useAuth } from '../../context/AuthContext';
import {
  updateAdminPurchaseOrder,
  type AdminPurchaseOrderDetail,
} from '../../lib/admin-purchase-orders';
import { formatCurrency } from '../../lib/catalog';
import { newCartLineId } from '../../lib/gatcCart';
import { formatInvoiceDate, invoiceCategoryLabel, invoiceErrorMessage, invoiceStatusLabel } from '../../lib/invoices';
import { canUpdatePurchaseOrders } from '../../lib/staffAccess';
import type { DealerInvoiceLineItem } from '../../types/invoices';
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

function linesFingerprint(lines: EditLine[]): string {
  return JSON.stringify(lines.map(line => ({
    productId: line.productId,
    quantity: line.quantity,
    rate: line.rate,
  })));
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

  useEffect(() => {
    if (!purchaseOrder) return;
    const nextLines = linesFromPurchaseOrder(purchaseOrder);
    setLines(nextLines);
    setBaseline(linesFingerprint(nextLines));
    setSaveError('');
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

  const categoryLabel = invoiceCategoryLabel(purchaseOrder.purchaseOrderCategory);
  const currency = purchaseOrder.currencyCode || 'INR';

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
          <div>
            <div className="text-muted text-sm">Delivery</div>
            {purchaseOrder.deliveryDate ? (
              <strong>{formatInvoiceDate(purchaseOrder.deliveryDate)}</strong>
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
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
            <ul className="staff-create-so-page__cart-list">
              {lines.map(line => (
                <li key={line.lineId} className="staff-create-so-page__cart-item">
                  <div className="staff-create-so-page__cart-media">
                    {line.imageUrl ? (
                      <CategoryThumbnail src={line.imageUrl} knockout={false} />
                    ) : (
                      <Package size={24} aria-hidden />
                    )}
                  </div>
                  <DocumentLineItemSpec
                    className="staff-create-so-page__cart-info"
                    name={line.name}
                    sku={line.sku}
                  >
                    <label className="staff-create-so-page__rate">
                      <span className="text-muted text-sm">Rate</span>
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
                        aria-label={`Rate for ${line.name}`}
                      />
                    </label>
                    <strong>{formatCurrency(line.rate * line.quantity, currency)}</strong>
                  </DocumentLineItemSpec>
                  <div className="staff-create-so-page__cart-actions">
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
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={saving || lines.length <= 1}
                      onClick={() => setLines(prev => prev.filter(row => row.lineId !== line.lineId))}
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
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
