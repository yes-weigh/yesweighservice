import React from 'react';
import { X } from 'lucide-react';
import {
  SPARE_AUDIT_STATUS_FILTERS,
  SPARE_CATALOG_FILTERS,
  SPARE_STOCK_STATUS_FILTERS,
  SPARE_WAREHOUSE_LOCATION_FILTERS,
  type SpareAuditStatusFilter,
  type SpareCatalogFilter,
  type SpareStockStatusFilter,
  type SpareWarehouseLocationFilter,
} from '../../lib/catalog';

export type CatalogSparesFiltersFooterMode = 'none' | 'clear-only' | 'apply';

export interface CatalogSparesMultiFiltersProps {
  spareCatalogFilters: ReadonlySet<SpareCatalogFilter>;
  onToggleCatalogFilter: (key: SpareCatalogFilter) => void;
  spareStockStatusFilters: ReadonlySet<SpareStockStatusFilter>;
  onToggleStockStatusFilter: (key: SpareStockStatusFilter) => void;
  spareLocationFilters: ReadonlySet<SpareWarehouseLocationFilter>;
  onToggleLocationFilter: (key: SpareWarehouseLocationFilter) => void;
  spareAuditStatusFilters: ReadonlySet<SpareAuditStatusFilter>;
  onToggleAuditStatusFilter: (key: SpareAuditStatusFilter) => void;
  spareCatalogFilterCounts: Record<SpareCatalogFilter, number>;
  spareStockStatusFilterCounts: Record<SpareStockStatusFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
  spareAuditStatusFilterCounts: Record<SpareAuditStatusFilter, number>;
  onClearAll: () => void;
  onClose?: () => void;
  onApply?: () => void;
  footerMode?: CatalogSparesFiltersFooterMode;
  className?: string;
}

function FilterOptionRow({
  id,
  label,
  count,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="catalog-spares-multi-filters__option" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="catalog-spares-multi-filters__checkbox"
        checked={checked}
        onChange={onToggle}
      />
      <span className="catalog-spares-multi-filters__option-label">{label}</span>
      <span
        className={`catalog-spares-multi-filters__option-count${checked ? ' is-active' : ''}`}
      >
        {count}
      </span>
    </label>
  );
}

export const CatalogSparesMultiFilters: React.FC<CatalogSparesMultiFiltersProps> = ({
  spareCatalogFilters,
  onToggleCatalogFilter,
  spareStockStatusFilters,
  onToggleStockStatusFilter,
  spareLocationFilters,
  onToggleLocationFilter,
  spareAuditStatusFilters,
  onToggleAuditStatusFilter,
  spareCatalogFilterCounts,
  spareStockStatusFilterCounts,
  spareLocationFilterCounts,
  spareAuditStatusFilterCounts,
  onClearAll,
  onClose,
  onApply,
  footerMode = 'clear-only',
  className = '',
}) => {
  const activeFilterCount =
    spareCatalogFilters.size
    + spareStockStatusFilters.size
    + spareLocationFilters.size
    + spareAuditStatusFilters.size;
  const hasActiveFilters = activeFilterCount > 0;
  const showFooter = footerMode !== 'none';

  return (
    <div className={`catalog-spares-multi-filters ${className}`.trim()}>
      <div className="catalog-spares-multi-filters__header">
        <span className="catalog-spares-multi-filters__title">Filters</span>
        {onClose ? (
          <button
            type="button"
            className="catalog-spares-multi-filters__close"
            onClick={onClose}
            aria-label="Close filters"
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="catalog-spares-multi-filters__group">
        <span className="catalog-spares-multi-filters__label">Product status</span>
        <div className="catalog-spares-multi-filters__options" role="group" aria-label="Product status filters">
          {SPARE_CATALOG_FILTERS.map(option => (
            <FilterOptionRow
              key={option.key}
              id={`spare-filter-${option.key}`}
              label={option.label}
              count={spareCatalogFilterCounts[option.key]}
              checked={spareCatalogFilters.has(option.key)}
              onToggle={() => onToggleCatalogFilter(option.key)}
            />
          ))}
        </div>
      </div>

      <div className="catalog-spares-multi-filters__group">
        <span className="catalog-spares-multi-filters__label">Stock status</span>
        <div className="catalog-spares-multi-filters__options" role="group" aria-label="Stock status filters">
          {SPARE_STOCK_STATUS_FILTERS.map(option => (
            <FilterOptionRow
              key={option.key}
              id={`spare-stock-${option.key}`}
              label={option.label}
              count={spareStockStatusFilterCounts[option.key]}
              checked={spareStockStatusFilters.has(option.key)}
              onToggle={() => onToggleStockStatusFilter(option.key)}
            />
          ))}
        </div>
      </div>

      <div className="catalog-spares-multi-filters__group">
        <span className="catalog-spares-multi-filters__label">Storage location</span>
        <div className="catalog-spares-multi-filters__options" role="group" aria-label="Storage location filters">
          {SPARE_WAREHOUSE_LOCATION_FILTERS.map(option => (
            <FilterOptionRow
              key={option.key}
              id={`spare-location-${option.key}`}
              label={option.label}
              count={spareLocationFilterCounts[option.key]}
              checked={spareLocationFilters.has(option.key)}
              onToggle={() => onToggleLocationFilter(option.key)}
            />
          ))}
        </div>
      </div>

      <div className="catalog-spares-multi-filters__group">
        <span className="catalog-spares-multi-filters__label">Audit status</span>
        <div className="catalog-spares-multi-filters__options" role="group" aria-label="Audit status filters">
          {SPARE_AUDIT_STATUS_FILTERS.map(option => (
            <FilterOptionRow
              key={option.key}
              id={`spare-audit-${option.key}`}
              label={option.label}
              count={spareAuditStatusFilterCounts[option.key]}
              checked={spareAuditStatusFilters.has(option.key)}
              onToggle={() => onToggleAuditStatusFilter(option.key)}
            />
          ))}
        </div>
      </div>

      {showFooter && (
        <div className="catalog-spares-multi-filters__footer">
          {footerMode === 'apply' && onApply && (
            <button
              type="button"
              className="catalog-spares-multi-filters__apply"
              onClick={onApply}
            >
              Apply Filters ({activeFilterCount})
            </button>
          )}
          <button
            type="button"
            className="catalog-spares-multi-filters__clear-btn"
            onClick={onClearAll}
            disabled={!hasActiveFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};
