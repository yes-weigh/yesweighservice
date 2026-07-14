import React from 'react';
import {
  shippingLabelBarcodeBars,
  type ShippingLabelViewModel,
} from '../../lib/shippingLabel';

type Props = {
  label: ShippingLabelViewModel;
  className?: string;
};

export const ShippingLabelSheet = React.forwardRef<HTMLDivElement, Props>(
  function ShippingLabelSheet({ label, className }, ref) {
    const bars = shippingLabelBarcodeBars(label.consignmentNo);
    const boxLabel = label.shipmentMode === 'envelope'
      ? '1/1'
      : `${label.boxIndex}/${label.boxTotal}`;

    return (
      <div
        ref={ref}
        className={['sheet', 'sheet--shipping', className].filter(Boolean).join(' ')}
      >
        <header className="sheet__header">
          <img
            className="sheet__logo"
            src="/logo.png"
            alt="YESWEIGH"
          />
          <strong className="sheet__product-line">GENUINE SPARE PART</strong>
        </header>

        <div className="sheet__parties">
          <div className="sheet__party">
            <span className="sheet__party-label">From (shipper)</span>
            <strong className="sheet__party-name">{label.fromName}</strong>
            <p className="sheet__party-address">{label.fromAddress}</p>
          </div>
          <div className="sheet__party">
            <span className="sheet__party-label">To (consignee)</span>
            <strong className="sheet__party-name">{label.toName}</strong>
            <p className="sheet__party-address">{label.toAddress}</p>
          </div>
        </div>

        <div className="sheet__box-meta">
          <div>
            <span>Number of boxes</span>
            <strong>
              {label.shipmentMode === 'envelope' ? 'Envelope' : label.numberOfBoxes}
            </strong>
          </div>
          <div>
            <span>Box number</span>
            <strong>{boxLabel}</strong>
          </div>
        </div>

        <div className="sheet__weights">
          <div>
            <span>Gross weight</span>
            <strong>{label.grossWeightKg.toFixed(2)} kg</strong>
          </div>
          <div>
            <span>Chargeable weight</span>
            <strong>{label.chargeableWeightKg.toFixed(2)} kg</strong>
          </div>
        </div>

        <div className="sheet__carrier">
          <div className="sheet__carrier-logo">
            {label.partnerImage ? (
              <img src={label.partnerImage} alt={label.partnerLabel} />
            ) : (
              <strong>{label.partnerLabel}</strong>
            )}
          </div>
          <div className="sheet__barcode-block">
            <code>{label.consignmentNo}</code>
            <div className="sheet__barcode" aria-hidden>
              {bars.map((w, i) => (
                <i key={i} style={{ width: `${w}px` }} />
              ))}
            </div>
          </div>
        </div>

        <footer className="sheet__footer">
          <div className="sheet__dest">
            <span>Destination city</span>
            <strong>{label.destinationCity}</strong>
          </div>
          <div className="sheet__booking">
            <div>
              <span>Booking branch</span>
              <strong>{label.bookingBranch}</strong>
            </div>
            <div>
              <span>Booking date</span>
              <strong>{label.bookingDate}</strong>
            </div>
            <div>
              <span>Booking time</span>
              <strong>{label.bookingTime}</strong>
            </div>
            <div>
              <span>Booked by</span>
              <strong>{label.bookedBy}</strong>
            </div>
          </div>
        </footer>
      </div>
    );
  },
);
