import React from 'react';
import { MapPin } from 'lucide-react';

export interface AuditTileStockLocationProps {
  rackId: string;
  rowNumber: number;
  binNumber: number;
  index?: number;
  total?: number;
  className?: string;
  /** `card` = full block with header; `cells` = rack/row/bin grid only (for tables) */
  variant?: 'card' | 'cells';
}

export const AuditTileStockLocation: React.FC<AuditTileStockLocationProps> = ({
  rackId,
  rowNumber,
  binNumber,
  index,
  total,
  className,
  variant = 'card',
}) => {
  const cells = [
    { label: 'Rack', value: rackId.toUpperCase() },
    { label: 'Row', value: String(rowNumber) },
    { label: 'Bin', value: String(binNumber) },
  ];
  const showIndex = total != null && total > 1 && index != null;

  const cellsGrid = (
    <div
      className={`wh-audit-tile__stock-location-cells${
        variant === 'cells' ? ' wh-audit-tile__stock-location-cells--inline' : ''
      }`}
    >
      {cells.map(cell => (
        <div
          key={cell.label}
          className={`wh-audit-tile__stock-location-cell${
            variant === 'cells' ? ' wh-audit-tile__stock-location-cell--inline' : ''
          }`}
        >
          <span className="wh-audit-tile__stock-location-label">{cell.label}</span>
          <span className="wh-audit-tile__stock-location-value">{cell.value}</span>
        </div>
      ))}
    </div>
  );

  if (variant === 'cells') {
    return (
      <div className={className}>
        {showIndex ? (
          <span className="wh-audit-tile__stock-location-index text-muted">
            {index + 1} of {total}
          </span>
        ) : null}
        {cellsGrid}
      </div>
    );
  }

  return (
    <div className={`wh-audit-tile__stock-location${className ? ` ${className}` : ''}`}>
      <div className="wh-audit-tile__stock-location-head">
        <span className="audit-icon-row__icon audit-icon-row__icon--indigo" aria-hidden>
          <MapPin size={15} strokeWidth={2.1} />
        </span>
        <span>
          Stock Location
          {showIndex ? ` ${index + 1} of ${total}` : ''}
        </span>
      </div>
      {cellsGrid}
    </div>
  );
};
