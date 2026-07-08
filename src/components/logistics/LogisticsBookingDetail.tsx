import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, FileText, MapPin, Package, Printer, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { homePathForRole } from '../../types';
import {
  LOGISTICS_BOOKING_STATUSES,
  bookingStatusIndex,
  bookingSummaryLines,
  courierSlipFileName,
  packageTypeLabel,
  packingSlipFileName,
} from '../../lib/logisticsBooking';
import { canDeleteLogisticsBooking } from '../../lib/logisticsBookings';
import type { LogisticsBooking, LogisticsBookingStatus } from '../../types/logistics-dispatch';

interface LogisticsBookingDetailProps {
  booking: LogisticsBooking;
  isOps?: boolean;
  onUpdate: (booking: LogisticsBooking) => void;
  onAdvanceStatus?: (status: LogisticsBookingStatus) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}

const PROGRESS_STATUSES = LOGISTICS_BOOKING_STATUSES.filter(item => item.id !== 'cancelled');

export const LogisticsBookingDetail: React.FC<LogisticsBookingDetailProps> = ({
  booking,
  isOps = false,
  onUpdate,
  onAdvanceStatus,
  onCancel,
  onDelete,
}) => {
  const { user } = useAuth();
  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
  const currentIndex = booking.status === 'cancelled' ? -1 : bookingStatusIndex(booking.status);
  const nextStatus = booking.status === 'cancelled'
    ? null
    : PROGRESS_STATUSES[currentIndex + 1]?.id;
  const basePath = user ? homePathForRole(user.role) : '/dealer';

  const handleGenerateCourierSlip = () => {
    onUpdate({ ...booking, courierSlipGenerated: true, labelGenerated: true });
  };

  const handleGeneratePackingSlip = () => {
    onUpdate({ ...booking, packingSlipGenerated: true });
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
            <div><dt>Boxes</dt><dd>{booking.numberOfBoxes}</dd></div>
            <div><dt>Actual wt.</dt><dd>{booking.actualWeightKg.toFixed(2)} kg</dd></div>
            <div><dt>Volumetric wt.</dt><dd>{booking.volumetricWeightKg.toFixed(2)} kg</dd></div>
            {booking.lengthCm && booking.widthCm && booking.heightCm && (
              <div>
                <dt>Dimensions</dt>
                <dd>{booking.lengthCm} × {booking.widthCm} × {booking.heightCm} cm</dd>
              </div>
            )}
            <div><dt>Type</dt><dd>{packageTypeLabel(booking.packageType)}</dd></div>
            {booking.notes && (
              <div><dt>Notes</dt><dd>{booking.notes}</dd></div>
            )}
          </dl>
        </div>
      </section>

      {(booking.shipmentItems.some(item => item.photoUrl) || booking.finalPackagePhoto) && (
        <section className="logistics-booking__photos">
          <h4>Package photos</h4>
          <div className="book-courier__gallery">
            {booking.shipmentItems.map(item => item.photoUrl && (
              <div key={item.id} className="book-courier__thumb">
                <img src={item.photoUrl} alt={item.name} />
                <span>{item.name}</span>
              </div>
            ))}
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
              onClick={handleGenerateCourierSlip}
            >
              <Printer size={14} aria-hidden />
              {booking.courierSlipGenerated ? 'Courier slip ready' : 'Generate courier slip'}
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm${booking.packingSlipGenerated ? ' is-done' : ''}`}
              onClick={handleGeneratePackingSlip}
            >
              <FileText size={14} aria-hidden />
              {booking.packingSlipGenerated ? 'Packing slip ready' : 'Generate packing slip'}
            </button>
          </div>
          {(booking.courierSlipGenerated || booking.packingSlipGenerated) && (
            <p className="text-muted text-sm logistics-booking__slip-names">
              {booking.courierSlipGenerated && courierSlipFileName(booking)}
              {booking.courierSlipGenerated && booking.packingSlipGenerated && ' · '}
              {booking.packingSlipGenerated && packingSlipFileName(booking)}
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
