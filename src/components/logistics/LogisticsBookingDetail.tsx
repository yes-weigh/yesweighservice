import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, MapPin, Package, Printer, Share2, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { homePathForRole } from '../../types';
import {
  LOGISTICS_BOOKING_STATUSES,
  boxChargeableWeight,
  boxDimensionsLabel,
  bookingStatusIndex,
  bookingSummaryLines,
  chargeableWeight,
  courierSlipFileName,
  shipmentModeLabel,
  shippingLabelFileName,
} from '../../lib/logisticsBooking';
import { canDeleteLogisticsBooking, generateLogisticsDocument } from '../../lib/logisticsBookings';
import {
  buildCourierSlipFromBooking,
  shareCourierSlipImage,
} from '../../lib/courierSlipImage';
import { openShippingLabelWindow } from '../../lib/logisticsDocuments';
import { logisticsTrackingUrl } from '../../lib/logisticsTracking';
import type {
  LogisticsBooking,
  LogisticsBookingStatus,
  LogisticsDocumentType,
} from '../../types/logistics-dispatch';

interface LogisticsBookingDetailProps {
  booking: LogisticsBooking;
  isOps?: boolean;
  onUpdate: (booking: LogisticsBooking) => void;
  onAdvanceStatus?: (status: LogisticsBookingStatus) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}

const PROGRESS_STATUSES = LOGISTICS_BOOKING_STATUSES.filter(
  item => item.id !== 'cancelled' && item.id !== 'draft',
);

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
  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
  const isEnvelope = booking.shipmentMode === 'envelope';
  const currentIndex = booking.status === 'cancelled' ? -1 : bookingStatusIndex(booking.status);
  // Booked → Label Generated is document-driven unless labels were already printed in the wizard.
  const nextStatus = booking.status === 'cancelled'
    ? null
    : booking.status === 'booked' && !booking.shippingLabelGenerated
      ? null
      : PROGRESS_STATUSES[currentIndex + 1]?.id;
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const trackUrl = logisticsTrackingUrl(booking.partnerId, booking.trackingNo || booking.consignmentNo);

  const handleGenerateDocument = async (document: LogisticsDocumentType) => {
    if (document === 'courier_slip') {
      try {
        await shareCourierSlipImage(buildCourierSlipFromBooking(booking));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        window.alert(err instanceof Error ? err.message : 'Could not share courier slip.');
        return;
      }
    } else {
      openShippingLabelWindow(booking, false);
    }
    if (!user) return;
    setGenerating(document);
    try {
      const updated = await generateLogisticsDocument(booking, document, user);
      onUpdate(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not generate document.');
    } finally {
      setGenerating(null);
    }
  };

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
        <span className={`logistics-booking__status logistics-booking__status--${booking.status}`}>
          {LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label}
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

      {booking.status !== 'cancelled' && (
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
            {booking.boxes.flatMap((box, boxIndex) => box.photos.map((photo, photoIndex) => (
              photo.url && (
                <div key={photo.storagePath || `${box.id}-${photoIndex}`} className="book-courier__thumb">
                  <img src={photo.url} alt={`Box ${boxIndex + 1}`} />
                  <span>{isEnvelope ? 'Envelope' : `Box ${boxIndex + 1}`}{photoIndex === 0 ? ' · inside' : ''}</span>
                </div>
              )
            )))}
            {booking.finalPackagePhoto && (
              <div className="book-courier__thumb">
                <img src={booking.finalPackagePhoto} alt="Final package" />
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
              onClick={() => void handleGenerateDocument('courier_slip')}
              disabled={generating !== null}
            >
              <Share2 size={14} aria-hidden />
              {booking.courierSlipGenerated
                ? 'Share courier slip again'
                : generating === 'courier_slip' ? 'Sharing…' : 'Share courier slip'}
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm${booking.shippingLabelGenerated ? ' is-done' : ''}`}
              onClick={() => void handleGenerateDocument('shipping_label')}
              disabled={generating !== null}
            >
              <Printer size={14} aria-hidden />
              {booking.shippingLabelGenerated
                ? 'Reprint shipping label'
                : generating === 'shipping_label' ? 'Generating…' : 'Generate shipping label'}
            </button>
          </div>
          {(booking.courierSlipGenerated || booking.shippingLabelGenerated) && (
            <p className="text-muted text-sm logistics-booking__slip-names">
              {booking.courierSlipGenerated && courierSlipFileName(booking)}
              {booking.courierSlipGenerated && booking.shippingLabelGenerated && ' · '}
              {booking.shippingLabelGenerated && shippingLabelFileName(booking)}
            </p>
          )}
          {!booking.shippingLabelGenerated && booking.status === 'booked' && (
            <p className="text-muted text-sm logistics-booking__slip-hint">
              Generate the shipping label to move this shipment to “Label Generated”.
            </p>
          )}
        </section>
      )}

      {isOps && booking.status !== 'cancelled' && booking.status !== 'delivered' && (
        <div className="logistics-booking__ops-actions">
          {onCancel && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel shipment
            </button>
          )}
          {user && canDeleteLogisticsBooking(user) && onDelete && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onDelete}>
              Delete permanently
            </button>
          )}
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
    </article>
  );
};
