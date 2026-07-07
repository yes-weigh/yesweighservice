import React from 'react';
import { Check, FileText, MapPin, Package, Printer, Truck } from 'lucide-react';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import {
  LOGISTICS_BOOKING_STATUSES,
  bookingStatusIndex,
  bookingSummaryLines,
  courierSlipFileName,
  formatDealerAddress,
  packingSlipFileName,
} from '../../lib/logisticsBooking';
import type { LogisticsBooking, LogisticsBookingStatus } from '../../types/logistics-dispatch';

interface LogisticsBookingDetailProps {
  booking: LogisticsBooking;
  onUpdate: (booking: LogisticsBooking) => void;
  onAdvanceStatus?: (status: LogisticsBookingStatus) => void;
}

export const LogisticsBookingDetail: React.FC<LogisticsBookingDetailProps> = ({
  booking,
  onUpdate,
  onAdvanceStatus,
}) => {
  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
  const currentIndex = bookingStatusIndex(booking.status);
  const nextStatus = LOGISTICS_BOOKING_STATUSES[currentIndex + 1]?.id;

  const handleGenerateCourierSlip = () => {
    onUpdate({ ...booking, courierSlipGenerated: true });
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
            {booking.orderRef} · {booking.consignmentNo}
          </p>
        </div>
        <span className={`logistics-booking__status logistics-booking__status--${booking.status}`}>
          {LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label}
        </span>
      </header>

      <section className="logistics-booking__timeline" aria-label="Shipment status">
        <ol className="logistics-booking__timeline-list">
          {LOGISTICS_BOOKING_STATUSES.map((item, index) => {
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
        {nextStatus && onAdvanceStatus && (
          <button
            type="button"
            className="btn btn-secondary btn-sm logistics-booking__advance"
            onClick={() => onAdvanceStatus(nextStatus)}
          >
            Mark as {LOGISTICS_BOOKING_STATUSES.find(item => item.id === nextStatus)?.label}
          </button>
        )}
      </section>

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
          </dl>
        </div>
        <div className="logistics-booking__card">
          <h4>
            <MapPin size={16} aria-hidden />
            Delivery address
          </h4>
          <p className="logistics-booking__address">
            <strong>{booking.deliveryAddress.label}</strong>
            <span>{formatDealerAddress(booking.deliveryAddress)}</span>
          </p>
        </div>
        <div className="logistics-booking__card">
          <h4>
            <Package size={16} aria-hidden />
            Package
          </h4>
          <dl className="logistics-booking__meta">
            <div><dt>Boxes</dt><dd>{booking.numberOfBoxes}</dd></div>
            <div><dt>Weight</dt><dd>{booking.totalWeightKg} kg</dd></div>
            {booking.lengthCm && booking.widthCm && booking.heightCm && (
              <div>
                <dt>Dimensions</dt>
                <dd>{booking.lengthCm} × {booking.widthCm} × {booking.heightCm} cm</dd>
              </div>
            )}
            {booking.notes && (
              <div><dt>Notes</dt><dd>{booking.notes}</dd></div>
            )}
          </dl>
        </div>
      </section>

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
