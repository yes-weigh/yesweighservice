import React from 'react';
import {
  formatShippingAddressLines,
  shippingLabelBarcodeBars,
  type ShippingLabelViewModel,
} from '../../lib/shippingLabel';
import {
  ShippingInfoGlyph,
  ShippingMetricGlyph,
  type ShippingInfoIcon,
  type ShippingMetricIcon,
} from './ShippingLabelIcons';

type Props = {
  label: ShippingLabelViewModel;
  className?: string;
};

function MetricCell({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ShippingMetricIcon;
}) {
  return (
    <div className="sheet__metric">
      <div className="sheet__metric-head">
        <ShippingMetricGlyph name={icon} />
        <span className="sheet__metric-title">{title}</span>
      </div>
      <strong className="sheet__metric-value">{value}</strong>
    </div>
  );
}

function InfoCell({
  title,
  value,
  icon,
  large,
}: {
  title: string;
  value: string;
  icon: ShippingInfoIcon;
  large?: boolean;
}) {
  return (
    <div className={['sheet__info-cell', large ? 'sheet__info-cell--large' : ''].filter(Boolean).join(' ')}>
      <div className="sheet__info-head">
        <ShippingInfoGlyph name={icon} />
        <span className="sheet__pill">{title}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

export const ShippingLabelSheet = React.forwardRef<HTMLDivElement, Props>(
  function ShippingLabelSheet({ label, className }, ref) {
    const bars = shippingLabelBarcodeBars(label.consignmentNo);
    const boxLabel = label.shipmentMode === 'envelope'
      ? '1/1'
      : `${label.boxIndex}/${label.boxTotal}`;
    const boxCount = label.shipmentMode === 'envelope'
      ? 'Envelope'
      : String(label.numberOfBoxes);

    return (
      <div
        ref={ref}
        className={['sheet', 'sheet--shipping', className].filter(Boolean).join(' ')}
      >
        <header className="sheet__header">
          <div className="sheet__y1" aria-label="YES ONE">
            <span className="sheet__y1-mark">Y1</span>
            <span className="sheet__y1-sub">YES ONE</span>
          </div>
          <div className="sheet__brand">
            <strong>YESWEIGH</strong>
            <span className="sheet__firm">
              <em>—</em> {label.firmName} <em>—</em>
            </span>
          </div>
          <div className="sheet__badge">
            <svg className="sheet__badge-icon" viewBox="0 0 24 28" aria-hidden>
              <path
                fill="none"
                stroke="#111"
                strokeWidth="1.7"
                strokeLinejoin="round"
                d="M12 1.6 21.2 5.2v8.2c0 5.6-3.7 10.4-9.2 12.2C6.5 23.8 2.8 19 2.8 13.4V5.2L12 1.6z"
              />
              <path
                fill="none"
                stroke="#111"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.4 14.2 10.6 17.3 16.8 10.4"
              />
            </svg>
            <span className="sheet__badge-text">
              <b>GENUINE</b>
              <b>SPARE PART</b>
            </span>
          </div>
        </header>

        <div className="sheet__parties">
          <div className="sheet__party">
            <span className="sheet__pill">FROM (SHIPPER)</span>
            <strong className="sheet__party-name">{label.fromName}</strong>
            <p className="sheet__party-address">
              {formatShippingAddressLines(label.fromAddress)}
            </p>
          </div>
          <div className="sheet__party">
            <span className="sheet__pill">TO (CONSIGNEE)</span>
            <strong className="sheet__party-name">{label.toName}</strong>
            <p className="sheet__party-address">
              {formatShippingAddressLines(label.toAddress)}
            </p>
          </div>
        </div>

        <div className="sheet__panel sheet__metrics">
          <MetricCell icon="boxes" title="NO. OF BOXES" value={boxCount} />
          <MetricCell icon="boxNumber" title="BOX NUMBER" value={boxLabel} />
          <MetricCell icon="dimensions" title="BOX DIMENSIONS (L × B × H)" value={label.boxDimensions} />
          <MetricCell icon="contents" title="CONTENTS" value={label.contents} />
          <MetricCell icon="weight" title="GROSS WEIGHT" value={`${label.grossWeightKg.toFixed(2)} kg`} />
          <MetricCell icon="weight" title="CHARGEABLE WEIGHT" value={`${label.chargeableWeightKg.toFixed(2)} kg`} />
          <MetricCell icon="transport" title="MODE OF TRANSPORT" value={label.transportMode} />
          <MetricCell icon="payment" title="PAYMENT MODE" value={label.paymentMode} />
        </div>

        <div className="sheet__panel sheet__courier">
          <div className="sheet__courier-side">
            <span className="sheet__pill">COURIER</span>
            <div className="sheet__carrier-logo">
              {label.partnerImage ? (
                <img src={label.partnerImage} alt={label.partnerLabel} />
              ) : null}
              <strong className="sheet__carrier-name">{label.partnerLabel}</strong>
            </div>
          </div>
          <div className="sheet__courier-side sheet__courier-side--track">
            <span className="sheet__pill">AWB / TRACKING NUMBER</span>
            <code className="sheet__awb">{label.consignmentNo}</code>
            <div className="sheet__barcode" aria-hidden>
              {bars.map((w, i) => (
                <i key={i} style={{ width: `${Math.max(1, w)}px` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="sheet__panel sheet__info">
          <InfoCell
            icon="branch"
            title="BOOKING BRANCH"
            value={label.bookingBranch}
            large
          />
          <InfoCell
            icon="destination"
            title="DESTINATION"
            value={label.destinationCity}
            large
          />
          <InfoCell icon="time" title="BOOKING TIME" value={label.bookingTime} />
          <InfoCell icon="bookedBy" title="BOOKED BY" value={label.bookedBy} />
        </div>
      </div>
    );
  },
);
