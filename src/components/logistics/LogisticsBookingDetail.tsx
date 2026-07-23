import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, ExternalLink, Eye, MapPin, Package, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { homePathForRole } from '../../types';
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
  uploadLogisticsBookingFinalPackagePhoto,
} from '../../lib/logisticsBookings';
import { logisticsTrackingUrl } from '../../lib/logisticsTracking';
import type {
  LogisticsBooking,
  LogisticsBookingStatus,
  LogisticsDocumentType,
} from '../../types/logistics-dispatch';
import { CourierSlipViewDialog } from './CourierSlipViewDialog';
import { PhotoLightbox } from './PhotoLightbox';
import { ShippingLabelPrintDialog } from './ShippingLabelPrintDialog';

interface LogisticsBookingDetailProps {
  booking: LogisticsBooking;
  isOps?: boolean;
  onUpdate: (booking: LogisticsBooking) => void;
  onAdvanceStatus?: (status: LogisticsBookingStatus) => void;
  onCancel?: () => void;
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
  onDelete,
}) => {
  const { user } = useAuth();
  const finalPhotoInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState<LogisticsDocumentType | null>(null);
  const [shippingLabelOpen, setShippingLabelOpen] = useState(false);
  const [courierSlipOpen, setCourierSlipOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploadingFinalPhoto, setUploadingFinalPhoto] = useState(false);
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
  // Advance only along the public pipeline (Label → Shipped → Transit → Delivered).
  const nextStatus = (
    isIncompleteLogisticsBooking(booking)
    || booking.status === 'cancelled'
    || booking.status === 'delivered'
    || (booking.status === 'label_generated' && !booking.shippingLabelGenerated)
  )
    ? null
    : PROGRESS_STATUSES[currentIndex + 1]?.id ?? null;
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const trackUrl = logisticsTrackingUrl(booking.partnerId, booking.trackingNo || booking.consignmentNo);

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
            {trackUrl && (
              <>
                {' · '}
                <a href={trackUrl} target="_blank" rel="noreferrer" className="logistics-booking__track-link">
                  Track shipment
                </a>
              </>
            )}
          </p>
        </div>
        <span className={`logistics-booking__status logistics-booking__status--${
          isIncompleteLogisticsBooking(booking) ? 'incomplete' : booking.status
        }`}
        >
          {isIncompleteLogisticsBooking(booking)
            ? 'Incomplete'
            : LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label}
        </span>
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

      {!isIncompleteLogisticsBooking(booking) && booking.status !== 'cancelled' && (
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
            <div><dt>Ship from</dt><dd>{booking.shipFromAddress || '—'}</dd></div>
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

      {(bookingHasPhotos(booking) || (isOps && booking.status !== 'cancelled')) && (
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
          {isOps && needsOuterPhoto && booking.status !== 'cancelled' && (
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
          {isOps && (
            <button
              type="button"
              className={`btn btn-secondary btn-sm${booking.courierSlipGenerated ? ' is-done' : ''}`}
              onClick={() => setCourierSlipOpen(true)}
              disabled={generating !== null}
            >
              <Eye size={14} aria-hidden />
              View courier slip
            </button>
          )}
          <button
            type="button"
            className={`btn btn-secondary btn-sm${booking.shippingLabelGenerated ? ' is-done' : ''}`}
            onClick={() => setShippingLabelOpen(true)}
            disabled={generating !== null}
          >
            <Eye size={14} aria-hidden />
            View shipping label
          </button>
        </div>
        {isOps && (booking.courierSlipGenerated || booking.shippingLabelGenerated) && (
          <p className="text-muted text-sm logistics-booking__slip-names">
            {booking.courierSlipGenerated && courierSlipFileName(booking)}
            {booking.courierSlipGenerated && booking.shippingLabelGenerated && ' · '}
            {booking.shippingLabelGenerated && shippingLabelFileName(booking)}
          </p>
        )}
        {isOps && !booking.shippingLabelGenerated && isIncompleteLogisticsBooking(booking) && (
          <p className="text-muted text-sm logistics-booking__slip-hint">
            Open and print the shipping label to confirm this shipment.
          </p>
        )}
      </section>

      {isOps && booking.status !== 'cancelled' && booking.status !== 'delivered' && onCancel && (
        <div className="logistics-booking__ops-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Cancel shipment
          </button>
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

      {shippingLabelOpen && (
        <ShippingLabelPrintDialog
          booking={booking}
          alreadyPrinted={booking.shippingLabelGenerated}
          onClose={() => setShippingLabelOpen(false)}
          onPrinted={handleShippingLabelPrinted}
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
