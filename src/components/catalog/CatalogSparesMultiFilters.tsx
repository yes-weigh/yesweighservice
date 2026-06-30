import React from 'react';
import { X } from 'lucide-react';
import {
  SPARE_CATALOG_FILTERS,
  SPARE_WAREHOUSE_LOCATION_FILTERS,
  type SpareCatalogFilter,
  type SpareWarehouseLocationFilter,
} from '../../lib/catalog';

export type CatalogSparesFiltersFooterMode = 'none' | 'clear-only' | 'apply';

export interface CatalogSparesMultiFiltersProps {
  spareCatalogFilters: ReadonlySet<SpareCatalogFilter>;
  onToggleCatalogFilter: (key: SpareCatalogFilter) => void;
  spareLocationFilters: ReadonlySet<SpareWarehouseLocationFilter>;
  onToggleLocationFilter: (key: SpareWarehouseLocationFilter) => void;
  spareCatalogFilterCounts: Record<SpareCatalogFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
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
  spareLocationFilters,
  onToggleLocationFilter,
  spareCatalogFilterCounts,
  spareLocationFilterCounts,
  onClearAll,
  onClose,
  onApply,
  footerMode = 'clear-only',
  className = '',
}) => {
  const activeFilterCount = spareCatalogFilters.size + spareLocationFilters.size;
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
        <span className="catalog-spares-multi-filters__label">Spare parts</span>
        <div className="catalog-spares-multi-filters__options" role="group" aria-label="Spare parts filters">
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
        <span className="catalog-spares-multi-filters__label">Location</span>
        <div className="catalog-spares-multi-filters__options" role="group" aria-label="Location filters">
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
