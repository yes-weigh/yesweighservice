import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BinNumber, RowNumber } from '../../types/yes-store';
import { formatLocationLabel } from '../../types/yes-store';

type Crumb = {
  label: string;
  to?: string;
};

type LocationBreadcrumbProps = {
  basePath: string;
  rackId: string;
  rowNumber?: RowNumber;
  binNumber?: BinNumber;
  itemName?: string;
};

export const LocationBreadcrumb: React.FC<LocationBreadcrumbProps> = ({
  basePath,
  rackId,
  rowNumber,
  binNumber,
  itemName,
}) => {
  const crumbs: Crumb[] = [{ label: 'Racks', to: basePath }];
  crumbs.push({
    label: `Rack ${rackId.toUpperCase()}`,
    to: rowNumber == null ? undefined : `${basePath}/rack/${rackId}`,
  });
  if (rowNumber != null) {
    crumbs.push({
      label: `Row ${rowNumber}`,
      to: binNumber == null ? undefined : `${basePath}/rack/${rackId}/row/${rowNumber}`,
    });
  }
  if (rowNumber != null && binNumber != null) {
    crumbs.push({
      label: `Bin ${binNumber}`,
      to: itemName ? `${basePath}/rack/${rackId}/row/${rowNumber}/bin/${binNumber}` : undefined,
    });
  }
  if (itemName) crumbs.push({ label: itemName });

  return (
    <nav className="yes-store-breadcrumb" aria-label="Location">
      {crumbs.map((crumb, index) => (
        <React.Fragment key={`${crumb.label}-${index}`}>
          {index > 0 && <ChevronRight size={14} aria-hidden className="yes-store-breadcrumb__sep" />}
          {crumb.to ? (
            <Link to={crumb.to} className="yes-store-breadcrumb__link">
              {crumb.label}
            </Link>
          ) : (
            <span className="yes-store-breadcrumb__current">{crumb.label}</span>
          )}
        </React.Fragment>
      ))}
      {rowNumber != null && binNumber != null && !itemName && (
        <span className="yes-store-breadcrumb__hint text-muted">
          {formatLocationLabel(rackId, rowNumber, binNumber)}
        </span>
      )}
    </nav>
  );
};
