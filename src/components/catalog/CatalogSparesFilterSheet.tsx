import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CatalogSparesMultiFilters } from './CatalogSparesMultiFilters';
import type {
  CategorizedProductFilter,
  SpareAuditStatusFilter,
  SpareCatalogFilter,
  SpareStockStatusFilter,
  SpareWarehouseLocationFilter,
} from '../../lib/catalog';

const EMPTY_SPARE_LOCATION_FILTERS: ReadonlySet<SpareWarehouseLocationFilter> = new Set();

export interface CatalogSparesFilterSheetProps {
  open: boolean;
  onClose: () => void;
  variant?: 'spares' | 'products';
  spareCatalogFilters: ReadonlySet<SpareCatalogFilter | CategorizedProductFilter>;
  spareStockStatusFilters: ReadonlySet<SpareStockStatusFilter>;
  spareLocationFilters?: ReadonlySet<SpareWarehouseLocationFilter>;
  spareAuditStatusFilters: ReadonlySet<SpareAuditStatusFilter>;
  onApplyFilters: (
    catalogFilters: Set<SpareCatalogFilter | CategorizedProductFilter>,
    stockStatusFilters: Set<SpareStockStatusFilter>,
    locationFilters: Set<SpareWarehouseLocationFilter>,
    auditStatusFilters: Set<SpareAuditStatusFilter>,
  ) => void;
  spareCatalogFilterCounts: Record<string, number>;
  spareStockStatusFilterCounts: Record<SpareStockStatusFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
  spareAuditStatusFilterCounts: Record<SpareAuditStatusFilter, number>;
}

export const CatalogSparesFilterSheet: React.FC<CatalogSparesFilterSheetProps> = ({
  open,
  onClose,
  variant = 'spares',
  spareCatalogFilters,
  spareStockStatusFilters,
  spareLocationFilters = EMPTY_SPARE_LOCATION_FILTERS,
  spareAuditStatusFilters,
  onApplyFilters,
  spareCatalogFilterCounts,
  spareStockStatusFilterCounts,
  spareLocationFilterCounts,
  spareAuditStatusFilterCounts,
}) => {
  const [draftCatalogFilters, setDraftCatalogFilters] = useState<Set<SpareCatalogFilter | CategorizedProductFilter>>(
    () => new Set(spareCatalogFilters),
  );
  const [draftStockStatusFilters, setDraftStockStatusFilters] = useState<Set<SpareStockStatusFilter>>(
    () => new Set(spareStockStatusFilters),
  );
  const [draftLocationFilters, setDraftLocationFilters] = useState<Set<SpareWarehouseLocationFilter>>(
    () => new Set(spareLocationFilters),
  );
  const [draftAuditStatusFilters, setDraftAuditStatusFilters] = useState<Set<SpareAuditStatusFilter>>(
    () => new Set(spareAuditStatusFilters),
  );

  useEffect(() => {
    if (!open) return;
    setDraftCatalogFilters(new Set(spareCatalogFilters));
    setDraftStockStatusFilters(new Set(spareStockStatusFilters));
    setDraftLocationFilters(new Set(spareLocationFilters));
    setDraftAuditStatusFilters(new Set(spareAuditStatusFilters));
  }, [open, spareCatalogFilters, spareStockStatusFilters, spareLocationFilters, spareAuditStatusFilters]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const toggleDraftCatalogFilter = useCallback((key: string) => {
    setDraftCatalogFilters(prev => {
      const next = new Set(prev);
      if (next.has(key as SpareCatalogFilter | CategorizedProductFilter)) {
        next.delete(key as SpareCatalogFilter | CategorizedProductFilter);
      } else {
        next.add(key as SpareCatalogFilter | CategorizedProductFilter);
      }
      return next;
    });
  }, []);

  const toggleDraftStockStatusFilter = useCallback((key: SpareStockStatusFilter) => {
    setDraftStockStatusFilters(prev => {
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

  const toggleDraftAuditStatusFilter = useCallback((key: SpareAuditStatusFilter) => {
    setDraftAuditStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearDraftFilters = useCallback(() => {
    setDraftCatalogFilters(new Set());
    setDraftStockStatusFilters(new Set());
    setDraftLocationFilters(new Set());
    setDraftAuditStatusFilters(new Set());
  }, []);

  const handleApply = useCallback(() => {
    onApplyFilters(
      draftCatalogFilters,
      draftStockStatusFilters,
      draftLocationFilters,
      draftAuditStatusFilters,
    );
    onClose();
  }, [
    draftCatalogFilters,
    draftStockStatusFilters,
    draftLocationFilters,
    draftAuditStatusFilters,
    onApplyFilters,
    onClose,
  ]);

  if (!open) return null;

  return createPortal(
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
        aria-label={variant === 'products' ? 'Filter categorized products' : 'Filter spare parts'}
      >
        <CatalogSparesMultiFilters
          variant={variant}
          spareCatalogFilters={draftCatalogFilters}
          onToggleCatalogFilter={toggleDraftCatalogFilter}
          spareStockStatusFilters={draftStockStatusFilters}
          onToggleStockStatusFilter={toggleDraftStockStatusFilter}
          spareLocationFilters={draftLocationFilters}
          onToggleLocationFilter={toggleDraftLocationFilter}
          spareAuditStatusFilters={draftAuditStatusFilters}
          onToggleAuditStatusFilter={toggleDraftAuditStatusFilter}
          spareCatalogFilterCounts={spareCatalogFilterCounts}
          spareStockStatusFilterCounts={spareStockStatusFilterCounts}
          spareLocationFilterCounts={spareLocationFilterCounts}
          spareAuditStatusFilterCounts={spareAuditStatusFilterCounts}
          onClearAll={clearDraftFilters}
          onClose={onClose}
          onApply={handleApply}
          footerMode="apply"
          className="catalog-spares-multi-filters--dropdown"
        />
      </div>
    </>,
    document.body,
  );
};
