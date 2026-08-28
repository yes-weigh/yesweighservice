import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Package, Plus, Radio, Ship, Upload } from 'lucide-react';
import { DecimalAmountInput } from '../../components/DecimalAmountInput';
import { QuantityStepper } from '../../components/QuantityStepper';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { SoDetailCatalogAddSheet } from '../../components/salesOrders/SoDetailCatalogAddSheet';
import { PoLineSerialFields } from '../../components/admin/PoLineSerialFields';
import { PurchaseOrderVesselMapDialog } from '../../components/admin/PurchaseOrderVesselMapDialog';
import { PurchaseOrderTrackingUploadDialog } from '../../components/admin/PurchaseOrderTrackingUploadDialog';
import type { DraftEditLine } from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { useAuth } from '../../context/AuthContext';
import {
  fetchAdminPurchaseOrderDetail,
  openPurchaseOrderBlLiveTracking,
  purchaseOrderBlLiveTrackingUrl,
  purchaseOrderShipFinderUrl,
  purchaseOrderBlTrackingSummary,
  purchaseOrderHasBl,
  purchaseOrderHasVendorPi,
  saveWanHaiLiveTrack,
  saveAdminPurchaseOrderSerialRanges,
  updateAdminPurchaseOrder,
  type AdminPurchaseOrderDetail,
  type WanHaiLiveTrackSnapshot,
} from '../../lib/admin-purchase-orders';
import {
  poLineShowsSerialRange,
  serialRangeInputsFromLines,
  serialRangesFingerprint,
} from '../../lib/purchaseOrderSerials';
import { previewSerialRange } from '../../lib/serialNumberAllotment';
import { formatCurrency } from '../../lib/catalog';
import { newCartLineId } from '../../lib/gatcCart';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import { unlockVoyageAisAudio } from '../../lib/voyageAisSuccessSound';
import { formatLogisticsDateTime } from '../../lib/logisticsDateTime';
import { canUpdatePurchaseOrders, isPlatformAdmin } from '../../lib/staffAccess';
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
  hsn: string | null;
  startNumber: string;
  endNumber: string;
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
  return po.lineItems.map(item => {
    const lineId = item.id || newCartLineId();
    const serial = po.serialRangesByLineId[lineId]
      || (item.itemId
        ? Object.values(po.serialRangesByLineId).find(row => row.itemId === item.itemId)
        : undefined);
    return {
      lineId,
      productId: String(item.itemId ?? '').trim(),
      name: item.name,
      sku: item.sku,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      rate: Math.round(Number(item.rate ?? 0) * 100) / 100,
      imageUrl: item.imageUrl,
      hsn: item.hsn ?? null,
      startNumber: serial?.startNumber ?? '',
      endNumber: serial?.endNumber ?? '',
    };
  });
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

function fromDraftLines(lines: DraftEditLine[], previous: EditLine[]): EditLine[] {
  const prevById = new Map(previous.map(line => [line.lineId, line]));
  const prevByProduct = new Map(previous.map(line => [line.productId, line]));
  return lines
    .filter(line => line.productId && line.quantity > 0)
    .map(line => {
      const prev = prevById.get(line.lineId) || prevByProduct.get(line.productId);
      return {
        lineId: line.lineId || newCartLineId(),
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        quantity: Math.max(1, Math.floor(line.quantity || 1)),
        rate: Math.round(Number(line.rate ?? line.catalogRate ?? 0) * 100) / 100,
        imageUrl: line.imageUrl,
        hsn: prev?.hsn ?? null,
        startNumber: prev?.startNumber ?? '',
        endNumber: prev?.endNumber ?? '',
      };
    });
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

function serialsFingerprint(lines: EditLine[]): string {
  return serialRangesFingerprint(
    Object.fromEntries(
      lines
        .filter(line => line.startNumber.trim() || line.endNumber.trim())
        .map(line => [line.lineId, {
          startNumber: line.startNumber.trim(),
          endNumber: line.endNumber.trim(),
          qty: 0,
          itemId: line.productId || null,
          sku: line.sku,
          productName: line.name,
          imageUrl: line.imageUrl,
        }]),
    ),
  );
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

const TRACKING_MILESTONES: Array<{
  key: 'loadingDate' | 'sailingDate' | 'arrivalDate' | 'receivedDate';
  title: string;
}> = [
  { key: 'loadingDate', title: 'Loading' },
  { key: 'sailingDate', title: 'ETD' },
  { key: 'arrivalDate', title: 'ETA' },
  { key: 'receivedDate', title: 'Received at warehouse' },
];

const SKIPPED_LOG_ACTIONS = new Set(['kotak_payout_associated', 'kotak_payout_paid', 'tracking_updated']);

function buildPoTrackingEvents(purchaseOrder: AdminPurchaseOrderDetail): PoTrackEvent[] {
  const events: PoTrackEvent[] = [];

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
      at: purchaseOrder.vendorPi?.piDate || purchaseOrder.vendorPi?.uploadedAt || null,
    });
  }

  if (purchaseOrderHasBl(purchaseOrder.bl)) {
    events.push({
      key: 'bl',
      title: 'Bill of lading',
      location: purchaseOrderBlTrackingSummary(purchaseOrder.bl),
      at: purchaseOrder.bl?.uploadedAt || null,
    });
  }

  const wh = purchaseOrder.wanHaiTrack;
  const etaPort = purchaseOrder.tracking.etaPort?.trim() || 'Cochin';
  const etdPort = purchaseOrder.tracking.etdPort?.trim() || null;
  if (wh) {
    events.push({
      key: 'wanhai-live',
      title: 'Wan Hai live track',
      location: [
        purchaseOrder.tracking.arrivalDate
          ? `ETA ${etaPort} ${formatInvoiceDate(purchaseOrder.tracking.arrivalDate)}`
          : null,
        purchaseOrder.tracking.sailingDate
          ? ['ETD', etdPort, formatInvoiceDate(purchaseOrder.tracking.sailingDate)].filter(Boolean).join(' ')
          : null,
        wh.statusName,
        wh.vesselName,
        wh.voyage ? `Voy ${wh.voyage}` : null,
        wh.depotName,
        wh.containerNumber,
      ].filter(Boolean).join(' · ') || wh.containerNumber,
      at: wh.fetchedAt || wh.eventAt || null,
    });
  }

  for (const row of TRACKING_MILESTONES) {
    const at = purchaseOrder.tracking[row.key];
    if (!at) continue;
    const location = row.key === 'arrivalDate'
      ? etaPort
      : row.key === 'sailingDate'
        ? etdPort
        : null;
    events.push({
      key: row.key,
      title: row.title,
      location,
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

function PoLiveTrackActions({
  purchaseOrder,
  showLiveTrack,
  showUploadTracking,
  onLiveMap,
  onLiveTrack,
  onUploadTracking,
}: {
  purchaseOrder: AdminPurchaseOrderDetail;
  showLiveTrack: boolean;
  showUploadTracking: boolean;
  onLiveMap: () => void;
  onLiveTrack: () => void;
  onUploadTracking: () => void;
}) {
  const mapUrl = purchaseOrderShipFinderUrl(purchaseOrder.bl);
  const liveTrackUrl = showLiveTrack ? purchaseOrderBlLiveTrackingUrl(purchaseOrder.bl) : null;
  if (!mapUrl && !liveTrackUrl && !showUploadTracking) return null;
  const iconSize = 14;

  return (
    <div className="po-tracking__live-actions">
      {mapUrl ? (
        <button
          type="button"
          className="po-tracking__live-btn"
          title="Live GPS position of this ship"
          onClick={onLiveMap}
        >
          <Ship size={iconSize} strokeWidth={2.4} aria-hidden />
          Live Ship
        </button>
      ) : null}
      {liveTrackUrl ? (
        <button
          type="button"
          className="po-tracking__live-btn"
          title={
            purchaseOrder.bl?.shippingLine === 'Wan Hai'
              ? 'Opens Wan Hai — pass CAPTCHA; extension pastes container and imports status'
              : 'Open live container tracking'
          }
          onClick={onLiveTrack}
        >
          <Radio size={iconSize} strokeWidth={2.4} aria-hidden />
          Live track
        </button>
      ) : null}
      {showUploadTracking ? (
        <button
          type="button"
          className="po-tracking__live-btn"
          title="Upload tracking screenshot and set ETD / ETA"
          onClick={onUploadTracking}
        >
          <Upload size={iconSize} strokeWidth={2.4} aria-hidden />
          Upload tracking
        </button>
      ) : null}
    </div>
  );
}

function PurchaseOrderTrackingCard({
  purchaseOrder,
  showLiveTrack,
  showUploadTracking,
  onLiveMap,
  onLiveTrack,
  onUploadTracking,
}: {
  purchaseOrder: AdminPurchaseOrderDetail;
  showLiveTrack: boolean;
  showUploadTracking: boolean;
  onLiveMap: () => void;
  onLiveTrack: () => void;
  onUploadTracking: () => void;
}) {
  const events = buildPoTrackingEvents(purchaseOrder);
  if (!events.length && !showUploadTracking && !purchaseOrderShipFinderUrl(purchaseOrder.bl)) {
    return null;
  }

  return (
    <section className="panel glass mb-4 po-tracking" aria-label="Tracking history">
      <div className="po-tracking__head">
        <h2>Tracking history</h2>
        <PoLiveTrackActions
          purchaseOrder={purchaseOrder}
          showLiveTrack={showLiveTrack}
          showUploadTracking={showUploadTracking}
          onLiveMap={onLiveMap}
          onLiveTrack={onLiveTrack}
          onUploadTracking={onUploadTracking}
        />
      </div>
      {events.length ? (
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
      ) : null}
    </section>
  );
}

export const AdminPurchaseOrderDocumentPage: React.FC = () => {
  const { purchaseOrder, setPurchaseOrder, purchaseOrderId } = useOutletContext<AdminPurchaseOrderDetailOutletContext>();
  const { user } = useAuth();
  const canEdit = canUpdatePurchaseOrders(user)
    && Boolean(purchaseOrder)
    && !LOCKED_STATUSES.has(String(purchaseOrder?.status ?? '').toLowerCase());
  const canLiveTrack = isPlatformAdmin(user);
  const canUploadTracking = canUpdatePurchaseOrders(user);

  const [lines, setLines] = useState<EditLine[]>([]);
  const [baseline, setBaseline] = useState('');
  const [serialBaseline, setSerialBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [liveTrackNote, setLiveTrackNote] = useState('');
  const [liveMapOpen, setLiveMapOpen] = useState(false);
  const [trackingUploadOpen, setTrackingUploadOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSession, setCatalogSession] = useState(0);
  const [vendorDirectory, setVendorDirectory] = useState<ZohoVendorOption | null>(null);

  useEffect(() => {
    if (!purchaseOrder) return;
    const nextLines = linesFromPurchaseOrder(purchaseOrder);
    setLines(nextLines);
    setBaseline(linesFingerprint(nextLines));
    setSerialBaseline(serialsFingerprint(nextLines));
    setSaveError('');
  }, [purchaseOrder]);

  useEffect(() => {
    const onExtension = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        type?: string;
        extensionInstalled?: boolean;
        payload?: WanHaiLiveTrackSnapshot & { purchaseOrderId?: string };
      } | null;
      if (!detail) return;
      if (detail.type === 'ready' || detail.type === 'queued') {
        if (detail.type === 'queued' && detail.extensionInstalled) {
          setLiveTrackNote('Pass Wan Hai CAPTCHA — extension will paste the container and import status.');
        }
        return;
      }
      if (detail.type !== 'result' || !detail.payload) return;
      const payload = detail.payload;
      const targetPoId = String(payload.purchaseOrderId || '').trim();
      if (targetPoId && targetPoId !== purchaseOrderId) return;
      void (async () => {
        try {
          setLiveTrackNote('Saving Wan Hai status…');
          const saved = await saveWanHaiLiveTrack({
            purchaseOrderId,
            snapshot: {
              containerNumber: payload.containerNumber,
              blNumber: payload.blNumber ?? null,
              statusName: payload.statusName ?? null,
              depotName: payload.depotName ?? null,
              voyage: payload.voyage ?? null,
              vesselName: payload.vesselName ?? null,
              eventAt: payload.eventAt ?? null,
              bookingRef: payload.bookingRef ?? null,
              rows: Array.isArray(payload.rows) ? payload.rows : [],
              fetchedAt: payload.fetchedAt || new Date().toISOString(),
              sourceUrl: payload.sourceUrl ?? null,
            },
          });
          setPurchaseOrder(purchaseOrder ? {
            ...purchaseOrder,
            wanHaiTrack: saved.wanHaiTrack,
            tracking: saved.tracking,
            bl: saved.bl ?? purchaseOrder.bl,
          } : null);
          setLiveTrackNote('Wan Hai status saved.');
        } catch (err) {
          setLiveTrackNote(invoiceErrorMessage(err));
        }
      })();
    };
    window.addEventListener('YesWeighWanHaiExtension', onExtension);
    return () => window.removeEventListener('YesWeighWanHaiExtension', onExtension);
  }, [purchaseOrderId, setPurchaseOrder, purchaseOrder]);

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

  const linesDirty = useMemo(
    () => linesFingerprint(lines) !== baseline,
    [lines, baseline],
  );
  const serialsDirty = useMemo(
    () => serialsFingerprint(lines) !== serialBaseline,
    [lines, serialBaseline],
  );
  const dirty = linesDirty || serialsDirty;

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
  const startLiveMap = () => {
    unlockVoyageAisAudio();
    setLiveTrackNote('');
    setLiveMapOpen(true);
  };

  const startLiveTrack = () => {
    if (!canLiveTrack) return;
    setLiveTrackNote(
      purchaseOrder.bl?.shippingLine === 'Wan Hai'
        ? 'On phone: use YesOne app → pass CAPTCHA → tap Track now. Browser-only opens Wan Hai for manual paste.'
        : '',
    );
    void (async () => {
      try {
        const result = await openPurchaseOrderBlLiveTracking(purchaseOrder.bl, { purchaseOrderId });
        if (result === 'saved') {
          const next = await fetchAdminPurchaseOrderDetail(purchaseOrderId);
          setPurchaseOrder(next);
          setLiveTrackNote('Wan Hai status saved.');
        } else if (result === 'opened') {
          setLiveTrackNote(
            purchaseOrder.bl?.shippingLine === 'Wan Hai'
              ? 'Wan Hai opened. Pass CAPTCHA, then use YesOne Android app for auto Track — or paste manually.'
              : '',
          );
        }
      } catch (err) {
        setLiveTrackNote(invoiceErrorMessage(err));
      }
    })();
  };

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
    const serialError = payloadLines
      .filter(line => poLineShowsSerialRange(line) && (line.startNumber.trim() || line.endNumber.trim()))
      .map(line => previewSerialRange({
        from: line.startNumber,
        to: line.endNumber,
        missingText: '',
      }).error)
      .find(Boolean);
    if (serialError) {
      setSaveError(serialError);
      return;
    }
    const serialRanges = serialRangeInputsFromLines(payloadLines);
    setSaving(true);
    setSaveError('');
    try {
      const next = linesDirty
        ? await updateAdminPurchaseOrder({
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
          serialRanges,
        })
        : await saveAdminPurchaseOrderSerialRanges({
          purchaseOrderId,
          serialRanges,
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

      <PurchaseOrderTrackingCard
        purchaseOrder={purchaseOrder}
        showLiveTrack={canLiveTrack}
        showUploadTracking={canUploadTracking}
        onLiveMap={startLiveMap}
        onLiveTrack={startLiveTrack}
        onUploadTracking={() => setTrackingUploadOpen(true)}
      />
      {liveTrackNote ? (
        <p className="text-muted text-sm mb-3" role="status">{liveTrackNote}</p>
      ) : null}

      {canEdit || lines.length > 0 ? (
        <section className="panel glass staff-create-so-page__section">
          <div className="staff-create-so-page__section-head">
            <h2>Items</h2>
            {canEdit ? (
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
            ) : null}
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
                          disabled={saving || !canEdit}
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
                        min={0}
                        disabled={saving || !canEdit}
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
                  {poLineShowsSerialRange(line) ? (
                    <PoLineSerialFields
                      startNumber={line.startNumber}
                      endNumber={line.endNumber}
                      lineQty={line.quantity}
                      disabled={saving || !canEdit}
                      name={line.name}
                      onChange={({ startNumber, endNumber }) => {
                        setLines(prev => prev.map(row => (
                          row.lineId === line.lineId
                            ? { ...row, startNumber, endNumber }
                            : row
                        )));
                      }}
                    />
                  ) : null}
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
            {saving ? 'Saving…' : linesDirty ? 'Save to Zoho' : 'Save serial numbers'}
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
          setLines(fromDraftLines(next, lines));
          setCatalogOpen(false);
        }}
      />

      <PurchaseOrderVesselMapDialog
        open={liveMapOpen}
        purchaseOrder={purchaseOrder}
        onClose={() => setLiveMapOpen(false)}
      />
      {canUploadTracking ? (
        <PurchaseOrderTrackingUploadDialog
          open={trackingUploadOpen}
          purchaseOrder={purchaseOrder}
          onClose={() => setTrackingUploadOpen(false)}
          onSaved={saved => {
            setPurchaseOrder({
              ...purchaseOrder,
              trackingScreenshots: saved.trackingScreenshots,
              tracking: saved.tracking,
              activityLogs: saved.activityLogs,
            });
          }}
        />
      ) : null}
    </>
  );
};
