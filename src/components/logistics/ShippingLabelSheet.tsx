import React from 'react';
import {
  formatShippingAddressLines,
  shippingLabelBarcodeBars,
  shippingLabelMetricCells,
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
}: {
  title: string;
  value: string;
  icon: ShippingInfoIcon;
}) {
  return (
    <div className="sheet__info-cell">
      <div className="sheet__info-head">
        <ShippingInfoGlyph name={icon} />
        <span className="sheet__label">{title}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

export const ShippingLabelSheet = React.forwardRef<HTMLDivElement, Props>(
  function ShippingLabelSheet({ label, className }, ref) {
    const bars = shippingLabelBarcodeBars(label.consignmentNo);
    const metrics = shippingLabelMetricCells(label);

    return (
      <div
        ref={ref}
        className={['sheet', 'sheet--shipping', className].filter(Boolean).join(' ')}
      >
        <div className="sheet__frame">
          <header className="sheet__header">
            <div className="sheet__brand-lockup">
              <img className="sheet__mark" src="/yesweigh-mark.png" alt="" />
              <strong className="sheet__firm">{label.firmName}</strong>
            </div>
          </header>

          <div className="sheet__parties">
            <div className="sheet__party">
              <span className="sheet__label">FROM (SHIPPER)</span>
              <strong className="sheet__party-name">{label.fromName}</strong>
              <p className="sheet__party-address">
                {formatShippingAddressLines(label.fromAddress, 4)}
              </p>
            </div>
            <div className="sheet__party">
              <span className="sheet__label">TO (CONSIGNEE)</span>
              <strong className="sheet__party-name">{label.toName}</strong>
              <p className="sheet__party-address">
                {formatShippingAddressLines(label.toAddress, 4)}
              </p>
            </div>
          </div>

          <div className="sheet__panel sheet__metrics">
            {metrics.map(cell => (
              <MetricCell
                key={`${cell.title}-${cell.value}`}
                icon={cell.icon}
                title={cell.title}
                value={cell.value}
              />
            ))}
          </div>

          <div className="sheet__panel sheet__courier">
            <div className="sheet__courier-side">
              <span className="sheet__label">COURIER</span>
              <div className="sheet__carrier-logo">
                {label.partnerImage ? (
                  <img src={label.partnerImage} alt={label.partnerLabel} />
                ) : null}
                <strong className="sheet__carrier-name">{label.partnerLabel}</strong>
              </div>
            </div>
            <div className="sheet__courier-side sheet__courier-side--track">
              <span className="sheet__label">AWB / TRACKING</span>
              <code className="sheet__awb">{label.consignmentNo}</code>
              <div className="sheet__barcode" role="img" aria-label={`Code 128 barcode ${label.consignmentNo}`}>
                {bars.map((w, i) => (
                  <i
                    key={i}
                    style={{
                      flex: `${w} ${w} 0`,
                      background: i % 2 === 0 ? '#111' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="sheet__panel sheet__info">
            <InfoCell icon="time" title="BOOKING TIME" value={label.bookingTime} />
            <InfoCell icon="bookedBy" title="BOOKED BY" value={label.bookedBy} />
          </div>
        </div>
      </div>
    );
  },
);
