import React, { useEffect } from 'react';
import { CatalogSparesMultiFilters } from './CatalogSparesMultiFilters';
import type { SpareCatalogFilter, SpareWarehouseLocationFilter } from '../../lib/catalog';

export interface CatalogSparesFilterSheetProps {
  open: boolean;
  onClose: () => void;
  spareCatalogFilters: ReadonlySet<SpareCatalogFilter>;
  onToggleCatalogFilter: (key: SpareCatalogFilter) => void;
  spareLocationFilters: ReadonlySet<SpareWarehouseLocationFilter>;
  onToggleLocationFilter: (key: SpareWarehouseLocationFilter) => void;
  onClearAll: () => void;
  spareCatalogFilterCounts: Record<SpareCatalogFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
}

export const CatalogSparesFilterSheet: React.FC<CatalogSparesFilterSheetProps> = ({
  open,
  onClose,
  spareCatalogFilters,
  onToggleCatalogFilter,
  spareLocationFilters,
  onToggleLocationFilter,
  onClearAll,
  spareCatalogFilterCounts,
  spareLocationFilterCounts,
}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="catalog-filter-dropdown__backdrop"
        aria-label="Close filters"
        onClick={onClose}
      />
      <div
        className="catalog-filter-dropdown panel glass"
        role="dialog"
        aria-modal="true"
        aria-label="Filter spare parts"
        onClick={event => event.stopPropagation()}
      >
        <CatalogSparesMultiFilters
          spareCatalogFilters={spareCatalogFilters}
          onToggleCatalogFilter={onToggleCatalogFilter}
          spareLocationFilters={spareLocationFilters}
          onToggleLocationFilter={onToggleLocationFilter}
          spareCatalogFilterCounts={spareCatalogFilterCounts}
          spareLocationFilterCounts={spareLocationFilterCounts}
          onClearAll={onClearAll}
          className="catalog-spares-multi-filters--dropdown"
        />
      </div>
    </>
  );
};
