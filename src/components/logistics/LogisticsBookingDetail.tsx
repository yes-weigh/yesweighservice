import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Eye, MapPin, Package, Truck, X } from 'lucide-react';
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
  needsFinalPackagePhoto,
  shipmentModeLabel,
  shippingLabelFileName,
} from '../../lib/logisticsBooking';
import { canDeleteLogisticsBooking, generateLogisticsDocument } from '../../lib/logisticsBookings';
import { logisticsTrackingUrl } from '../../lib/logisticsTracking';
import type {
  LogisticsBooking,
  LogisticsBookingStatus,
  LogisticsDocumentType,
} from '../../types/logistics-dispatch';
import { CourierSlipViewDialog } from './CourierSlipViewDialog';
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

export const LogisticsBookingDetail: React.FC<LogisticsBookingDetailProps> = ({
  booking,
  isOps = false,
  onUpdate,
  onAdvanceStatus,
  onCancel,
  onDelete,
}) => {
  const { user } = useAuth();
  const [generating, setGenerating] = useState<LogisticsDocumentType | null>(null);
  const [shippingLabelOpen, setShippingLabelOpen] = useState(false);
  const [courierSlipOpen, setCourierSlipOpen] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
  const isEnvelope = booking.shipmentMode === 'envelope';
  const currentIndex = isIncompleteLogisticsBooking(booking)
    ? -1
    : bookingStatusIndex(booking.status);
  // Advance only along the public pipeline (Label → Shipped → Transit → Delivered).
  const nextStatus = (
    isIncompleteLogisticsBooking(booking)
    || needsFinalPackagePhoto(booking)
    || booking.status === 'cancelled'
    || booking.status === 'delivered'
    || (booking.status === 'label_generated' && !booking.shippingLabelGenerated)
  )
    ? null
    : PROGRESS_STATUSES[currentIndex + 1]?.id ?? null;
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const trackUrl = logisticsTrackingUrl(booking.partnerId, booking.trackingNo || booking.consignmentNo);

  const markDocumentGenerated = useCallback(async (document: LogisticsDocumentType) => {
    if (!user) return;
    setGenerating(document);
    try {
      const updated = await generateLogisticsDocument(booking, document, user);
      onUpdate(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update document status.');
    } finally {
      setGenerating(null);
    }
  }, [booking, onUpdate, user]);

  const handleCourierSlipViewed = useCallback(() => {
    if (booking.courierSlipGenerated) return;
    void markDocumentGenerated('courier_slip');
  }, [booking.courierSlipGenerated, markDocumentGenerated]);

  const handleShippingLabelPrinted = useCallback(() => {
    void markDocumentGenerated('shipping_label');
  }, [markDocumentGenerated]);

  useEffect(() => {
    if (!previewPhoto) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewPhoto(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [previewPhoto]);

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

      {(booking.boxes.some(box => box.photos.length) || booking.finalPackagePhoto) && (
        <section className="logistics-booking__photos">
          <h4>Package photos</h4>
          <div className="book-courier__gallery">
            {booking.boxes.flatMap((box, boxIndex) => box.photos.map((photo, photoIndex) => {
              const photoUrl = photo.url?.trim();
              if (!photoUrl) return null;
              return (
                <div key={photo.storagePath || `${box.id}-${photoIndex}`} className="book-courier__thumb">
                  <button
                    type="button"
                    onClick={() => setPreviewPhoto(photoUrl)}
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
                  onClick={() => setPreviewPhoto(booking.finalPackagePhoto)}
                  aria-label="Preview label pasted photo"
                >
                  <img src={booking.finalPackagePhoto} alt="Final package" />
                </button>
                <span>Label pasted</span>
              </div>
            )}
          </div>
        </section>
      )}

      {isOps && (
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
          {(booking.courierSlipGenerated || booking.shippingLabelGenerated) && (
            <p className="text-muted text-sm logistics-booking__slip-names">
              {booking.courierSlipGenerated && courierSlipFileName(booking)}
              {booking.courierSlipGenerated && booking.shippingLabelGenerated && ' · '}
              {booking.shippingLabelGenerated && shippingLabelFileName(booking)}
            </p>
          )}
          {!booking.shippingLabelGenerated && isIncompleteLogisticsBooking(booking) && (
            <p className="text-muted text-sm logistics-booking__slip-hint">
              Open and print the shipping label to confirm this shipment.
            </p>
          )}
        </section>
      )}

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

      {previewPhoto && createPortal(
        <div
          className="book-courier__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setPreviewPhoto(null)}
        >
          <button
            type="button"
            className="book-courier__lightbox-close"
            aria-label="Close preview"
            onClick={() => setPreviewPhoto(null)}
          >
            <X size={20} aria-hidden />
          </button>
          <img src={previewPhoto} alt="Preview" onClick={event => event.stopPropagation()} />
        </div>,
        document.body,
      )}
    </article>
  );
};
