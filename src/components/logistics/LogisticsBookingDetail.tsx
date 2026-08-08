import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  Check,
  ExternalLink,
  Eye,
  FileText,
  IndianRupee,
  MapPin,
  Package,
  SquareArrowOutUpRight,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { formatCurrency } from '../../lib/catalog';
import {
  LOGISTICS_BOOKING_STATUSES,
  LOGISTICS_PIPELINE_STATUSES,
  boxChargeableWeight,
  boxDimensionsLabel,
  bookingStatusIndex,
  bookingSummaryLines,
  chargeableWeight,
  courierSlipFileName,
  isIncompleteLogisticsBooking,
  missingFinalPackagePhoto,
  shipmentModeLabel,
  shippingLabelFileName,
} from '../../lib/logisticsBooking';
import {
  canDeleteLogisticsBooking,
  generateLogisticsDocument,
  hydrateLogisticsBookingPhotos,
  updateLogisticsBookingShipFrom,
  uploadLogisticsBookingFinalPackagePhoto,
} from '../../lib/logisticsBookings';
import {
  formatFreightDiffLabel,
  loadLogisticsFreightCompare,
  type LogisticsFreightCompare,
} from '../../lib/logisticsFreightCompare';
import {
  fetchInvoiceBranchShipFrom,
  shipFromSiteLabel,
  type InvoiceBranchShipFrom,
} from '../../lib/logisticsShipFrom';
import { isPlaceholderLogisticsAddress } from '../../lib/logisticsDealers';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import { logisticsTrackingUrl } from '../../lib/logisticsTracking';
import { shippingLabelAddressGate } from '../../lib/shippingLabel';
import { homePathForRole } from '../../types';
import type {
  LogisticsBooking,
  LogisticsBookingStatus,
  LogisticsDocumentType,
} from '../../types/logistics-dispatch';
import { STAFF_LOGISTICS_SITE_LABELS } from '../../types/staff-logistics';
import { CourierSlipViewDialog } from './CourierSlipViewDialog';
import { PhotoLightbox } from './PhotoLightbox';
import { ShippingLabelPrintDialog } from './ShippingLabelPrintDialog';
import { StCourierTrackPanel } from './StCourierTrackPanel';

interface LogisticsBookingDetailProps {
  booking: LogisticsBooking;
  isOps?: boolean;
  onUpdate: (booking: LogisticsBooking) => void;
  onAdvanceStatus?: (status: LogisticsBookingStatus) => void;
  onCancel?: () => void;
  onReturn?: () => void;
  onDelete?: () => void;
}

const PROGRESS_STATUSES = LOGISTICS_PIPELINE_STATUSES;

function bookingNeedsPhotoHydration(booking: LogisticsBooking): boolean {
  const missingBoxUrl = booking.boxes.some(box =>
    box.photos.some(photo => Boolean(photo.storagePath?.trim()) && !photo.url?.trim()),
  );
  const missingFinal = Boolean(
    booking.finalPackagePhotoStoragePath?.trim() && !booking.finalPackagePhoto?.trim(),
  );
  return missingBoxUrl || missingFinal;
}

function bookingHasPhotos(booking: LogisticsBooking): boolean {
  return booking.boxes.some(box => box.photos.some(photo =>
    Boolean(photo.url?.trim() || photo.storagePath?.trim()),
  )) || Boolean(booking.finalPackagePhoto?.trim() || booking.finalPackagePhotoStoragePath?.trim());
}

export const LogisticsBookingDetail: React.FC<LogisticsBookingDetailProps> = ({
  booking,
  isOps = false,
  onUpdate,
  onAdvanceStatus,
  onCancel,
  onReturn,
  onDelete,
}) => {
  const { user } = useAuth();
  const finalPhotoInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState<LogisticsDocumentType | null>(null);
  const [shippingLabelOpen, setShippingLabelOpen] = useState(false);
  /** Prefer corrected booking immediately after ship-from fix (before parent re-render). */
  const [shippingLabelBooking, setShippingLabelBooking] = useState<LogisticsBooking | null>(null);
  const [courierSlipOpen, setCourierSlipOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploadingFinalPhoto, setUploadingFinalPhoto] = useState(false);
  const [freightCompare, setFreightCompare] = useState<LogisticsFreightCompare | null>(null);
  const [freightLoading, setFreightLoading] = useState(false);
  const [invoiceBranch, setInvoiceBranch] = useState<InvoiceBranchShipFrom | null>(null);
  const [updatingShipFrom, setUpdatingShipFrom] = useState(false);
  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
  const isEnvelope = booking.shipmentMode === 'envelope';
  const needsOuterPhoto = missingFinalPackagePhoto(booking);
  const galleryUrls = useMemo(() => {
    const urls = booking.boxes.flatMap(box =>
      box.photos
        .map(photo => photo.url?.trim())
        .filter((url): url is string => Boolean(url)),
    );
    const finalUrl = booking.finalPackagePhoto?.trim();
    if (finalUrl) urls.push(finalUrl);
    return urls;
  }, [booking.boxes, booking.finalPackagePhoto]);
  const currentIndex = isIncompleteLogisticsBooking(booking)
    ? -1
    : bookingStatusIndex(booking.status);
  // Advance only along the public pipeline (Booked → Transit → Delivered).
  const nextStatus = (
    isIncompleteLogisticsBooking(booking)
    || booking.status === 'returned'
    || booking.status === 'cancelled'
    || booking.status === 'delivered'
    || (booking.status === 'label_generated' && !booking.shippingLabelGenerated)
  )
    ? null
    : PROGRESS_STATUSES[currentIndex + 1]?.id ?? null;
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const trackAwb = (booking.trackingNo || booking.consignmentNo || '').trim();
  const trackUrl = logisticsTrackingUrl(booking.partnerId, trackAwb);
  const isStCourier = booking.partnerId === 'st_courier';

  const markDocumentGenerated = useCallback(async (document: LogisticsDocumentType) => {
    if (!user || !isOps) return;
    setGenerating(document);
    try {
      const updated = await generateLogisticsDocument(booking, document, user);
      onUpdate(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update document status.');
    } finally {
      setGenerating(null);
    }
  }, [booking, isOps, onUpdate, user]);

  const handleCourierSlipViewed = useCallback(() => {
    if (!isOps || booking.courierSlipGenerated) return;
    void markDocumentGenerated('courier_slip');
  }, [booking.courierSlipGenerated, isOps, markDocumentGenerated]);

  const handleShippingLabelPrinted = useCallback(() => {
    if (!isOps) return;
    void markDocumentGenerated('shipping_label');
  }, [isOps, markDocumentGenerated]);

  const needsPhotoHydration = bookingNeedsPhotoHydration(booking);

  useEffect(() => {
    if (!needsPhotoHydration) return;
    let cancelled = false;
    setPhotosLoading(true);
    void hydrateLogisticsBookingPhotos(booking)
      .then(hydrated => {
        if (cancelled) return;
        // Avoid update loops when resolution fails (URLs still missing).
        if (bookingNeedsPhotoHydration(hydrated)) return;
        onUpdate(hydrated);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPhotosLoading(false);
      });
    return () => { cancelled = true; };
    // Re-run when list refresh wipes URLs (needsPhotoHydration flips back to true).
  }, [booking, needsPhotoHydration, onUpdate]);

  const openPreview = useCallback((url: string) => {
    const index = galleryUrls.indexOf(url);
    if (index >= 0) setPreviewIndex(index);
  }, [galleryUrls]);

  const handleFinalPhotoSelected = useCallback(async (file: File | undefined) => {
    if (!file || !user || !isOps) return;
    setUploadingFinalPhoto(true);
    try {
      const updated = await uploadLogisticsBookingFinalPackagePhoto(booking, file, user);
      onUpdate(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not upload outer package photo.');
    } finally {
      setUploadingFinalPhoto(false);
    }
  }, [booking, isOps, onUpdate, user]);

  useEffect(() => {
    if (!booking.invoiceId?.trim()) {
      setFreightCompare(null);
      setFreightLoading(false);
      return;
    }
    let cancelled = false;
    setFreightLoading(true);
    void loadLogisticsFreightCompare(booking, { isOps })
      .then(result => {
        if (!cancelled) setFreightCompare(result);
      })
      .catch(() => {
        if (!cancelled) setFreightCompare(null);
      })
      .finally(() => {
        if (!cancelled) setFreightLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    booking.id,
    booking.invoiceId,
    booking.partnerId,
    booking.shipmentMode,
    booking.shipFromSite,
    booking.actualWeightKg,
    booking.volumetricWeightKg,
    booking.numberOfBoxes,
    booking.boxes,
    booking.deliveryAddress,
    booking.dealer.zohoCustomerId,
    isOps,
  ]);

  useEffect(() => {
    const invoiceId = booking.invoiceId?.trim() || '';
    const customerId = booking.dealer.zohoCustomerId?.trim() || '';
    if (!invoiceId || !customerId) {
      setInvoiceBranch(null);
      return;
    }
    let cancelled = false;
    void fetchInvoiceBranchShipFrom({ invoiceId, customerId, isOps })
      .then(branch => {
        if (!cancelled) setInvoiceBranch(branch);
      })
      .catch(() => {
        if (!cancelled) setInvoiceBranch(null);
      });
    return () => { cancelled = true; };
  }, [booking.invoiceId, booking.dealer.zohoCustomerId, isOps]);

  const shipFromMismatch = Boolean(
    isOps
    && invoiceBranch
    && booking.shipFromSite !== invoiceBranch.site
    && booking.status !== 'returned'
    && booking.status !== 'cancelled',
  );

  const handleFixShipFrom = useCallback(async () => {
    if (!user || !isOps || !invoiceBranch) return;
    setUpdatingShipFrom(true);
    try {
      const updated = await updateLogisticsBookingShipFrom(booking, invoiceBranch.site, user);
      onUpdate(updated);
      setShippingLabelBooking(updated);
      setShippingLabelOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update ship-from.');
    } finally {
      setUpdatingShipFrom(false);
    }
  }, [booking, invoiceBranch, isOps, onUpdate, user]);

  /** Pull Sites address onto this booking (settings save does not update existing shipments). */
  const handleApplyShipFromFromSites = useCallback(async (opts?: { openLabel?: boolean }) => {
    if (!user || !isOps) return false;
    setUpdatingShipFrom(true);
    try {
      const settings = await loadLogisticsSettings();
      const site = booking.shipFromSite;
      const address = settings.fromAddresses[site]?.trim() || '';
      if (isPlaceholderLogisticsAddress(address)) {
        window.alert(
          `No ship-from address saved for ${STAFF_LOGISTICS_SITE_LABELS[site] || site}. `
          + 'Set it under Admin → Logistics → Sites, save, then try again.',
        );
        return false;
      }
      const updated = await updateLogisticsBookingShipFrom(booking, site, user);
      onUpdate(updated);
      setShippingLabelBooking(updated);
      if (opts?.openLabel) {
        const gate = shippingLabelAddressGate(updated);
        if (!gate.message) setShippingLabelOpen(true);
      }
      return true;
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update ship-from.');
      return false;
    } finally {
      setUpdatingShipFrom(false);
    }
  }, [booking, isOps, onUpdate, user]);

  const shipFromAutoAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOps || !user) return;
    if (!isPlaceholderLogisticsAddress(booking.shipFromAddress)) return;
    if (shipFromAutoAppliedRef.current === booking.id) return;
    shipFromAutoAppliedRef.current = booking.id;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await loadLogisticsSettings();
        const address = settings.fromAddresses[booking.shipFromSite]?.trim() || '';
        if (cancelled || isPlaceholderLogisticsAddress(address)) return;
        const updated = await updateLogisticsBookingShipFrom(booking, booking.shipFromSite, user);
        if (!cancelled) {
          onUpdate(updated);
          setShippingLabelBooking(updated);
        }
      } catch {
        /* leave blocked UI; user can Apply manually */
      }
    })();
    return () => { cancelled = true; };
  }, [
    booking,
    booking.id,
    booking.shipFromAddress,
    booking.shipFromSite,
    isOps,
    onUpdate,
    user,
  ]);

  const shippingLabelGate = useMemo(() => shippingLabelAddressGate(booking), [booking]);
  const shippingLabelBlocked = Boolean(shippingLabelGate.message);

  const openShippingLabel = useCallback(() => {
    if (shippingLabelGate.message) {
      window.alert(shippingLabelGate.message);
      return;
    }
    setShippingLabelBooking(booking);
    setShippingLabelOpen(true);
  }, [booking, shippingLabelGate.message]);

  const productItems = freightCompare?.items.filter(
    item => !item.isFreight && !item.isStampingFee,
  ) ?? [];
  const freightItems = freightCompare?.items.filter(
    item => item.isFreight || item.isStampingFee,
  ) ?? [];

  return (
    <article className="logistics-booking panel glass">
      <header className="logistics-booking__header">
        <span className="logistics-booking__partner-logo-wrap" aria-hidden>
          {partner && (
            <img src={partner.image} alt="" className="logistics-booking__partner-logo" />
          )}
        </span>
        <div className="logistics-booking__header-copy">
          <h3>{logisticsPartnerLabel(booking.partnerId)}</h3>
          <p className="text-muted text-sm">
            {booking.orderRef} · {booking.trackingNo}
            {isStCourier && booking.courierTrack?.ok && booking.courierTrack.status
              ? ` · ${booking.courierTrack.status}`
              : ''}
          </p>
        </div>
        <div className="logistics-booking__header-actions">
          {!isStCourier && trackUrl && (
            <a
              href={trackUrl}
              target="_blank"
              rel="noreferrer"
              className="logistics-booking__track-btn"
              aria-label="Track shipment"
              title="Track shipment"
            >
              <SquareArrowOutUpRight size={16} aria-hidden />
            </a>
          )}
          <span className={`logistics-booking__status logistics-booking__status--${
            isIncompleteLogisticsBooking(booking) ? 'incomplete' : booking.status
          }`}
          >
            {isIncompleteLogisticsBooking(booking)
              ? 'Incomplete'
              : LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label}
          </span>
        </div>
      </header>

      {(booking.invoiceId || booking.supportRequestId) && (
        <section className="logistics-booking__links">
          {booking.invoiceId && booking.invoiceNumber && (
            <Link
              to={user?.role === 'super_admin'
                ? `/super-admin/invoices/${booking.dealer.zohoCustomerId}/${booking.invoiceId}/invoice`
                : `${basePath}/invoices/${booking.invoiceId}/invoice`}
              className="logistics-booking__source-link"
            >
              <ExternalLink size={14} aria-hidden />
              Invoice {booking.invoiceNumber}
            </Link>
          )}
          {booking.supportRequestId && booking.supportRequestNumber && (
            <Link
              to={`${basePath}/warranty-support/${booking.supportRequestId}`}
              className="logistics-booking__source-link"
            >
              <ExternalLink size={14} aria-hidden />
              Support {booking.supportRequestNumber}
            </Link>
          )}
        </section>
      )}

      {shipFromMismatch && invoiceBranch && (
        <div className="logistics-booking__ship-from-mismatch" role="alert">
          <AlertTriangle size={18} strokeWidth={2.25} aria-hidden />
          <div className="logistics-booking__ship-from-mismatch-copy">
            <strong>Ship-from differs from invoice branch</strong>
            <p>
              Current: {shipFromSiteLabel(booking.shipFromSite)}
              {booking.shipFromAddress?.trim()
                ? ` — ${booking.shipFromAddress.trim()}`
                : ''}
              . Invoice branch: {invoiceBranch.branchLabel}
              {invoiceBranch.salesOrderNumber
                ? ` (SO ${invoiceBranch.salesOrderNumber})`
                : ''}
              .
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={updatingShipFrom}
            onClick={() => void handleFixShipFrom()}
          >
            {updatingShipFrom
              ? 'Updating…'
              : `Update to ${STAFF_LOGISTICS_SITE_LABELS[invoiceBranch.site]}`}
          </button>
        </div>
      )}

      {isStCourier && trackAwb && (
        <StCourierTrackPanel
          awb={trackAwb}
          bookingId={booking.id}
          shipFromSite={booking.shipFromSite}
          courierDeliveryOffice={booking.courierDeliveryOffice}
          cachedTrack={booking.courierTrack}
          onTrackUpdated={(track) => {
            let nextStatus = booking.status;
            if (booking.status !== 'returned' && booking.status !== 'cancelled') {
              if (!track.ok) {
                nextStatus = 'label_generated';
              } else if (
                booking.status === 'label_generated'
                || Boolean(String(track.deliveredAt || '').trim())
                || /\bdelivered\b/i.test(track.status || '')
              ) {
                const delivered = Boolean(String(track.deliveredAt || '').trim())
                  || /\bdelivered\b/i.test(track.status || '');
                nextStatus = delivered ? 'delivered' : 'in_transit';
              }
            }
            onUpdate({
              ...booking,
              status: nextStatus,
              courierTrack: {
                awb: track.awb,
                ok: track.ok,
                error: track.error,
                status: track.status,
                origin: track.origin,
                destination: track.destination,
                consignmentType: track.consignmentType,
                bookedAt: track.bookedAt,
                deliveredAt: track.deliveredAt,
                history: track.history,
                sourceUrl: track.sourceUrl,
                fetchedAt: track.fetchedAt,
              },
              trackFetchedAt: track.fetchedAt,
            });
          }}
        />
      )}

      {booking.invoiceId && (
        <section className="logistics-booking__invoice-freight" aria-label="Invoice and freight">
          <div className="logistics-booking__card logistics-booking__card--wide">
            <h4>
              <FileText size={16} aria-hidden />
              Invoice &amp; items
              {freightCompare?.invoiceNumber
                ? ` · ${freightCompare.invoiceNumber}`
                : booking.invoiceNumber
                  ? ` · ${booking.invoiceNumber}`
                  : ''}
            </h4>
            {freightLoading && !freightCompare && (
              <p className="text-muted text-sm">Loading invoice details…</p>
            )}
            {!freightLoading && !freightCompare?.items.length && (
              <p className="text-muted text-sm">Invoice line items unavailable.</p>
            )}
            {productItems.length > 0 && (
              <ul className="logistics-booking__invoice-items">
                {productItems.map(item => (
                  <li key={item.id}>
                    <span className="logistics-booking__invoice-item-thumb" aria-hidden>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" />
                      ) : (
                        <Package size={18} strokeWidth={1.5} />
                      )}
                    </span>
                    <div className="logistics-booking__invoice-item-main">
                      <strong>{item.name}</strong>
                      {item.sku && <span className="text-muted">{item.sku}</span>}
                      {item.stampingLabel && (
                        <span
                          className={[
                            'logistics-booking__invoice-item-stamp',
                            item.hasStamping === true
                              ? 'is-stamped'
                              : item.hasStamping === false
                                ? 'is-plain'
                                : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {item.stampingLabel}
                        </span>
                      )}
                      {item.serialNumbers.length > 0 && (
                        <span className="logistics-booking__invoice-item-serials">
                          S/N {item.serialNumbers.join(', ')}
                        </span>
                      )}
                      {item.description && (
                        <span className="logistics-booking__invoice-item-desc">
                          {item.description}
                        </span>
                      )}
                    </div>
                    <div className="logistics-booking__invoice-item-meta">
                      <span>Qty {item.quantity}</span>
                      <span>{formatCurrency(item.total)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {freightItems.length > 0 && (
              <ul className="logistics-booking__invoice-items logistics-booking__invoice-items--freight">
                {freightItems.map(item => (
                  <li key={item.id}>
                    <span className="logistics-booking__invoice-item-thumb" aria-hidden>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" />
                      ) : (
                        <Truck size={18} strokeWidth={1.5} />
                      )}
                    </span>
                    <div className="logistics-booking__invoice-item-main">
                      <strong>{item.name}</strong>
                      {item.sku && <span className="text-muted">{item.sku}</span>}
                    </div>
                    <div className="logistics-booking__invoice-item-meta">
                      <span>{item.isStampingFee ? 'Stamping' : 'Freight line'}</span>
                      <span>{formatCurrency(item.total)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="logistics-booking__card logistics-booking__card--wide">
            <h4>
              <IndianRupee size={16} aria-hidden />
              Freight compare
            </h4>
            <dl className="logistics-booking__freight-compare">
              <div>
                <dt>Paid freight</dt>
                <dd>
                  {freightCompare?.paidFreightInr != null
                    ? formatCurrency(freightCompare.paidFreightInr)
                    : (freightLoading ? '…' : '—')}
                </dd>
              </div>
              <div>
                <dt>Actual freight</dt>
                <dd>
                  {freightCompare?.actualFreightInr != null
                    ? formatCurrency(freightCompare.actualFreightInr)
                    : (freightLoading ? '…' : '—')}
                </dd>
              </div>
              <div className={[
                'logistics-booking__freight-diff',
                freightCompare?.differenceInr == null
                  ? ''
                  : freightCompare.differenceInr > 0
                    ? 'is-under'
                    : freightCompare.differenceInr < 0
                      ? 'is-over'
                      : 'is-matched',
              ].filter(Boolean).join(' ')}
              >
                <dt>Difference</dt>
                <dd>
                  {freightCompare?.differenceInr != null
                    ? (
                      <>
                        {formatCurrency(freightCompare.differenceInr)}
                        <em>{formatFreightDiffLabel(freightCompare.differenceInr)}</em>
                      </>
                    )
                    : (freightLoading ? '…' : '—')}
                </dd>
              </div>
            </dl>

            {freightCompare?.calc && (
              <div className="logistics-booking__freight-calc">
                <h5>Actual freight calculation</h5>
                <dl className="logistics-booking__freight-calc-meta">
                  <div>
                    <dt>Courier</dt>
                    <dd>{freightCompare.calc.partnerLabel}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>
                      {freightCompare.calc.shipmentMode === 'envelope'
                        ? 'Envelope'
                        : `${freightCompare.calc.boxCount} box${freightCompare.calc.boxCount === 1 ? '' : 'es'}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Ship from</dt>
                    <dd>{freightCompare.calc.shipFromLabel}</dd>
                  </div>
                  {freightCompare.calc.destinationLabel && (
                    <div>
                      <dt>Destination</dt>
                      <dd>{freightCompare.calc.destinationLabel}</dd>
                    </div>
                  )}
                  {freightCompare.calc.zoneLabel && (
                    <div>
                      <dt>Zone</dt>
                      <dd>{freightCompare.calc.zoneLabel}</dd>
                    </div>
                  )}
                  {freightCompare.calc.volumetricDivisor != null && (
                    <div>
                      <dt>Vol. divisor</dt>
                      <dd>{freightCompare.calc.volumetricDivisor}</dd>
                    </div>
                  )}
                </dl>

                {freightCompare.calc.boxes.length > 0 && (
                  <div className="logistics-booking__freight-boxes">
                    <h6>
                      Packages · {freightCompare.calc.boxes.length}
                    </h6>
                    <ul>
                      {freightCompare.calc.boxes.map(box => (
                        <li key={`${box.label}-${box.index}`}>
                          <strong>{box.label}</strong>
                          <span>{box.dimensionsLabel}</span>
                          <span>
                            Actual {box.actualKg.toFixed(2)} kg
                            {' · '}
                            Vol {box.volumetricKg.toFixed(2)} kg
                            {' · '}
                            Chg {box.chargeableKg.toFixed(0)} kg
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <dl className="logistics-booking__freight-calc-totals">
                  <div>
                    <dt>Total actual wt.</dt>
                    <dd>{freightCompare.calc.totalActualKg.toFixed(2)} kg</dd>
                  </div>
                  <div>
                    <dt>Total volumetric wt.</dt>
                    <dd>{freightCompare.calc.totalVolumetricKg.toFixed(2)} kg</dd>
                  </div>
                  <div>
                    <dt>Total chargeable wt.</dt>
                    <dd>
                      {(freightCompare.chargeableKg
                        ?? freightCompare.calc.totalChargeableKg).toFixed(2)}
                      {' '}
                      kg
                    </dd>
                  </div>
                  {freightCompare.calc.boxPerKgInr != null && freightCompare.calc.boxPerKgInr > 0 && (
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {formatCurrency(freightCompare.calc.boxPerKgInr)}
                        /kg
                      </dd>
                    </div>
                  )}
                  {freightCompare.calc.envelopeFixedInr != null
                    && freightCompare.calc.envelopeFixedInr > 0 && (
                    <div>
                      <dt>Envelope fixed</dt>
                      <dd>{formatCurrency(freightCompare.calc.envelopeFixedInr)}</dd>
                    </div>
                  )}
                  {freightCompare.calc.freightInr != null && (
                    <div>
                      <dt>Base freight</dt>
                      <dd>{formatCurrency(freightCompare.calc.freightInr)}</dd>
                    </div>
                  )}
                  {freightCompare.calc.fuelSurchargePercent != null
                    && freightCompare.calc.fuelSurchargePercent > 0 && (
                    <div>
                      <dt>
                        Fuel (
                        {freightCompare.calc.fuelSurchargePercent}
                        %)
                      </dt>
                      <dd>
                        {freightCompare.calc.fuelSurchargeInr != null
                          ? formatCurrency(freightCompare.calc.fuelSurchargeInr)
                          : '—'}
                      </dd>
                    </div>
                  )}
                  {freightCompare.calc.totalInr != null && (
                    <div className="logistics-booking__freight-calc-total">
                      <dt>Quoted total</dt>
                      <dd>{formatCurrency(freightCompare.calc.totalInr)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <p className="text-muted text-sm logistics-booking__freight-hint">
              Paid = freight on invoice.
              Actual = rate-card estimate from booked packages.
              Difference = Actual − Paid.
            </p>
            {freightCompare?.actualNote && (
              <p className="text-muted text-sm logistics-booking__freight-note">
                {freightCompare.actualNote}
              </p>
            )}
          </div>
        </section>
      )}

      {!isIncompleteLogisticsBooking(booking) && booking.status !== 'returned' && booking.status !== 'cancelled' && (
        <section className="logistics-booking__timeline" aria-label="Shipment status">
          <ol className="logistics-booking__timeline-list">
            {PROGRESS_STATUSES.map((item, index) => {
              const done = index <= currentIndex;
              const current = item.id === booking.status;
              return (
                <li
                  key={item.id}
                  className={[
                    'logistics-booking__timeline-item',
                    done ? 'is-done' : '',
                    current ? 'is-current' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="logistics-booking__timeline-dot" aria-hidden>
                    {done ? <Check size={12} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="logistics-booking__timeline-label">{item.label}</span>
                </li>
              );
            })}
          </ol>
          {isOps && nextStatus && onAdvanceStatus && (
            <button
              type="button"
              className="btn btn-secondary btn-sm logistics-booking__advance"
              onClick={() => onAdvanceStatus(nextStatus)}
            >
              Mark as {LOGISTICS_BOOKING_STATUSES.find(item => item.id === nextStatus)?.label}
            </button>
          )}
        </section>
      )}

      <section className="logistics-booking__cards">
        <div className="logistics-booking__card">
          <h4>
            <Truck size={16} aria-hidden />
            Courier details
          </h4>
          <dl className="logistics-booking__meta">
            <div><dt>Branch</dt><dd>{booking.branch}</dd></div>
            <div><dt>Service</dt><dd>{booking.serviceType}</dd></div>
            <div><dt>Booked on</dt><dd>{booking.bookingDate}</dd></div>
            <div>
              <dt>Ship from</dt>
              <dd>
                {shipFromSiteLabel(booking.shipFromSite)}
                {booking.shipFromAddress?.trim()
                  ? ` — ${booking.shipFromAddress.trim()}`
                  : ''}
              </dd>
            </div>
          </dl>
        </div>
        <div className="logistics-booking__card">
          <h4>
            <MapPin size={16} aria-hidden />
            Delivery address
          </h4>
          <p className="logistics-booking__address">
            <strong>{booking.dealer.name}</strong>
            <span className="book-courier__dealer-code">{booking.dealer.code}</span>
            <span>{booking.dealer.contactPerson} · {booking.dealer.mobile}</span>
            <span className="book-courier__address-block">{booking.deliveryAddress}</span>
          </p>
        </div>
        <div className="logistics-booking__card">
          <h4>
            <Package size={16} aria-hidden />
            Package
          </h4>
          <dl className="logistics-booking__meta">
            <div><dt>Shipment</dt><dd>{shipmentModeLabel(booking.shipmentMode)}</dd></div>
            {!isEnvelope && (
              <>
                <div><dt>Boxes</dt><dd>{booking.numberOfBoxes}</dd></div>
                <div><dt>Actual wt.</dt><dd>{booking.actualWeightKg.toFixed(2)} kg</dd></div>
                <div><dt>Volumetric wt.</dt><dd>{booking.volumetricWeightKg.toFixed(2)} kg</dd></div>
                <div><dt>Chargeable wt.</dt><dd>{chargeableWeight(booking).toFixed(2)} kg</dd></div>
                {booking.boxes.map((box, index) => (
                  <div key={box.id}>
                    <dt>Box {index + 1}</dt>
                    <dd>
                      {boxDimensionsLabel(box)} · {boxChargeableWeight(box).toFixed(2)} kg
                    </dd>
                  </div>
                ))}
              </>
            )}
          </dl>
        </div>
      </section>

      {(bookingHasPhotos(booking) || (isOps && booking.status !== 'returned' && booking.status !== 'cancelled')) && (
        <section className="logistics-booking__photos">
          <h4>Package photos</h4>
          {photosLoading
            && !booking.boxes.some(box => box.photos.some(p => p.url?.trim()))
            && !booking.finalPackagePhoto && (
            <p className="text-muted text-sm">Loading photos…</p>
          )}
          <div className="book-courier__gallery">
            {booking.boxes.flatMap((box, boxIndex) => box.photos.map((photo, photoIndex) => {
              const photoUrl = photo.url?.trim();
              if (!photoUrl) return null;
              return (
                <div key={photo.storagePath || `${box.id}-${photoIndex}`} className="book-courier__thumb">
                  <button
                    type="button"
                    onClick={() => openPreview(photoUrl)}
                    aria-label={`Preview ${isEnvelope ? 'envelope' : `box ${boxIndex + 1}`}${photoIndex === 0 ? ' inside' : ''} photo`}
                  >
                    <img src={photoUrl} alt={`Box ${boxIndex + 1}`} />
                  </button>
                  <span>{isEnvelope ? 'Envelope' : `Box ${boxIndex + 1}`}{photoIndex === 0 ? ' · inside' : ''}</span>
                </div>
              );
            }))}
            {booking.finalPackagePhoto && (
              <div className="book-courier__thumb">
                <button
                  type="button"
                  onClick={() => openPreview(booking.finalPackagePhoto!)}
                  aria-label="Preview label pasted photo"
                >
                  <img src={booking.finalPackagePhoto} alt="Final package" />
                </button>
                <span>Label pasted</span>
                {isOps && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={uploadingFinalPhoto}
                    onClick={() => finalPhotoInputRef.current?.click()}
                  >
                    <Camera size={14} aria-hidden />
                    {uploadingFinalPhoto ? 'Uploading…' : 'Retake'}
                  </button>
                )}
              </div>
            )}
          </div>
          {isOps && needsOuterPhoto && booking.status !== 'returned' && booking.status !== 'cancelled' && (
            <div className="logistics-booking__final-photo-add">
              <p className="text-muted text-sm">
                Outer package photo not added yet. You can capture it now at any stage.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={uploadingFinalPhoto}
                onClick={() => finalPhotoInputRef.current?.click()}
              >
                <Camera size={14} aria-hidden />
                {uploadingFinalPhoto ? 'Uploading…' : 'Add outer package photo'}
              </button>
            </div>
          )}
          <input
            ref={finalPhotoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={event => {
              void handleFinalPhotoSelected(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </section>
      )}

      <section className="logistics-booking__slips">
        <h4>Documents</h4>
        <div className="logistics-booking__slip-actions">
          <button
            type="button"
            className={`btn btn-secondary btn-sm${booking.courierSlipGenerated ? ' is-done' : ''}`}
            onClick={() => setCourierSlipOpen(true)}
            disabled={generating !== null}
          >
            <Eye size={14} aria-hidden />
            View courier slip
          </button>
          {isOps && (
            <button
              type="button"
              className={[
                'btn btn-secondary btn-sm',
                booking.shippingLabelGenerated && !shippingLabelBlocked ? 'is-done' : '',
                shippingLabelBlocked ? 'is-blocked' : '',
              ].filter(Boolean).join(' ')}
              onClick={openShippingLabel}
              disabled={generating !== null || shippingLabelBlocked}
              title={shippingLabelBlocked ? 'Fix missing addresses before opening the label' : undefined}
              aria-disabled={shippingLabelBlocked || undefined}
            >
              {shippingLabelBlocked ? <AlertTriangle size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              {shippingLabelBlocked ? 'Shipping label blocked' : 'View shipping label'}
            </button>
          )}
        </div>
        {isOps && shippingLabelBlocked && (
          <div className="logistics-booking__slip-blocked" role="status">
            <AlertTriangle size={14} aria-hidden />
            <div>
              <strong>Shipping label unavailable</strong>
              <p>
                {shippingLabelGate.fromMissing && shippingLabelGate.toMissing
                  ? 'FROM and TO addresses are missing. Apply ship-from from Sites (or save it there first), and refresh the dealer address from Zoho.'
                  : shippingLabelGate.fromMissing
                    ? `This booking still has no ship-from address. Sites settings do not update existing shipments automatically — apply the ${STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || 'site'} address here.`
                    : 'TO (dealer delivery) address is missing. Refresh the dealer from Zoho, then try again.'}
              </p>
              {shippingLabelGate.fromMissing && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm logistics-booking__slip-blocked-action"
                  disabled={updatingShipFrom}
                  onClick={() => void handleApplyShipFromFromSites({ openLabel: true })}
                >
                  {updatingShipFrom
                    ? 'Applying…'
                    : `Apply ${STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || 'site'} address from Sites`}
                </button>
              )}
            </div>
          </div>
        )}
        {isOps && (booking.courierSlipGenerated || booking.shippingLabelGenerated) && (
          <p className="text-muted text-sm logistics-booking__slip-names">
            {booking.courierSlipGenerated && courierSlipFileName(booking)}
            {booking.courierSlipGenerated && booking.shippingLabelGenerated && ' · '}
            {booking.shippingLabelGenerated && shippingLabelFileName(booking)}
          </p>
        )}
        {isOps && !shippingLabelBlocked && !booking.shippingLabelGenerated && isIncompleteLogisticsBooking(booking) && (
          <p className="text-muted text-sm logistics-booking__slip-hint">
            Open and print the shipping label to confirm this shipment.
          </p>
        )}
      </section>

      {isOps
        && booking.status !== 'delivered'
        && booking.status !== 'cancelled'
        && booking.status !== 'returned'
        && (onCancel || onReturn) && (
        <div className="logistics-booking__ops-actions">
          {onCancel && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel shipment
            </button>
          )}
          {onReturn && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReturn}>
              Mark returned
            </button>
          )}
        </div>
      )}

      {user && canDeleteLogisticsBooking(user) && onDelete && (
        <div className="logistics-booking__ops-actions logistics-booking__ops-actions--danger">
          <button
            type="button"
            className="btn btn-secondary btn-sm logistics-booking__delete-btn"
            onClick={onDelete}
          >
            Delete permanently
          </button>
        </div>
      )}

      <details className="logistics-booking__summary">
        <summary>Full booking summary</summary>
        <dl className="book-courier__review">
          {bookingSummaryLines(booking).map(row => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </details>

      {courierSlipOpen && (
        <CourierSlipViewDialog
          booking={booking}
          onClose={() => setCourierSlipOpen(false)}
          onViewed={handleCourierSlipViewed}
        />
      )}

      {shippingLabelOpen && (shippingLabelBooking || booking) && (
        <ShippingLabelPrintDialog
          booking={shippingLabelBooking ?? booking}
          alreadyPrinted={(shippingLabelBooking ?? booking).shippingLabelGenerated}
          onClose={() => {
            setShippingLabelOpen(false);
            setShippingLabelBooking(null);
          }}
          onPrinted={handleShippingLabelPrinted}
          onBookingRepair={onUpdate}
        />
      )}

      {previewIndex != null && galleryUrls[previewIndex] && (
        <PhotoLightbox
          urls={galleryUrls}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onIndexChange={setPreviewIndex}
        />
      )}
    </article>
  );
};
