import React, { useCallback, useEffect, useState } from 'react';
import { CatalogSparesMultiFilters } from './CatalogSparesMultiFilters';
import type { SpareCatalogFilter, SpareWarehouseLocationFilter } from '../../lib/catalog';

export interface CatalogSparesFilterSheetProps {
  open: boolean;
  onClose: () => void;
  spareCatalogFilters: ReadonlySet<SpareCatalogFilter>;
  spareLocationFilters: ReadonlySet<SpareWarehouseLocationFilter>;
  onApplyFilters: (
    catalogFilters: Set<SpareCatalogFilter>,
    locationFilters: Set<SpareWarehouseLocationFilter>,
  ) => void;
  spareCatalogFilterCounts: Record<SpareCatalogFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
}

export const CatalogSparesFilterSheet: React.FC<CatalogSparesFilterSheetProps> = ({
  open,
  onClose,
  spareCatalogFilters,
  spareLocationFilters,
  onApplyFilters,
  spareCatalogFilterCounts,
  spareLocationFilterCounts,
}) => {
  const [draftCatalogFilters, setDraftCatalogFilters] = useState<Set<SpareCatalogFilter>>(
    () => new Set(spareCatalogFilters),
  );
  const [draftLocationFilters, setDraftLocationFilters] = useState<Set<SpareWarehouseLocationFilter>>(
    () => new Set(spareLocationFilters),
  );

  useEffect(() => {
    if (!open) return;
    setDraftCatalogFilters(new Set(spareCatalogFilters));
    setDraftLocationFilters(new Set(spareLocationFilters));
  }, [open, spareCatalogFilters, spareLocationFilters]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const toggleDraftCatalogFilter = useCallback((key: SpareCatalogFilter) => {
    setDraftCatalogFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleDraftLocationFilter = useCallback((key: SpareWarehouseLocationFilter) => {
    setDraftLocationFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearDraftFilters = useCallback(() => {
    setDraftCatalogFilters(new Set());
    setDraftLocationFilters(new Set());
  }, []);

  const handleApply = useCallback(() => {
    onApplyFilters(draftCatalogFilters, draftLocationFilters);
    onClose();
  }, [draftCatalogFilters, draftLocationFilters, onApplyFilters, onClose]);

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
          spareCatalogFilters={draftCatalogFilters}
          onToggleCatalogFilter={toggleDraftCatalogFilter}
          spareLocationFilters={draftLocationFilters}
          onToggleLocationFilter={toggleDraftLocationFilter}
          spareCatalogFilterCounts={spareCatalogFilterCounts}
          spareLocationFilterCounts={spareLocationFilterCounts}
          onClearAll={clearDraftFilters}
          onClose={onClose}
          onApply={handleApply}
          footerMode="apply"
          className="catalog-spares-multi-filters--dropdown"
        />
      </div>
    </>
  );
};
