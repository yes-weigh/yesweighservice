import React from 'react';
import {
  SPARE_CATALOG_FILTERS,
  SPARE_WAREHOUSE_LOCATION_FILTERS,
  type SpareCatalogFilter,
  type SpareWarehouseLocationFilter,
} from '../../lib/catalog';

export interface CatalogSparesMultiFiltersProps {
  spareCatalogFilters: ReadonlySet<SpareCatalogFilter>;
  onToggleCatalogFilter: (key: SpareCatalogFilter) => void;
  spareLocationFilters: ReadonlySet<SpareWarehouseLocationFilter>;
  onToggleLocationFilter: (key: SpareWarehouseLocationFilter) => void;
  spareCatalogFilterCounts: Record<SpareCatalogFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
  onClearAll: () => void;
  className?: string;
}

export const CatalogSparesMultiFilters: React.FC<CatalogSparesMultiFiltersProps> = ({
  spareCatalogFilters,
  onToggleCatalogFilter,
  spareLocationFilters,
  onToggleLocationFilter,
  spareCatalogFilterCounts,
  spareLocationFilterCounts,
  onClearAll,
  className = '',
}) => {
  const hasActiveFilters = spareCatalogFilters.size > 0 || spareLocationFilters.size > 0;

  return (
    <div className={`catalog-spares-multi-filters ${className}`.trim()}>
      <div className="catalog-spares-multi-filters__header">
        <span className="catalog-spares-multi-filters__title">Filters</span>
        <button
          type="button"
          className="catalog-spares-multi-filters__clear"
          onClick={onClearAll}
          disabled={!hasActiveFilters}
        >
          Clear all
        </button>
      </div>

      <div className="catalog-spares-multi-filters__group">
        <span className="catalog-spares-multi-filters__label">Spare parts</span>
        <div className="catalog-spares-multi-filters__chips" role="group" aria-label="Spare parts filters">
          {SPARE_CATALOG_FILTERS.map(option => {
            const active = spareCatalogFilters.has(option.key);
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                className={`catalog-spares-multi-filters__chip${active ? ' is-active' : ''}`}
                onClick={() => onToggleCatalogFilter(option.key)}
              >
                <span className="catalog-spares-multi-filters__chip-label">{option.label}</span>
                <span className="catalog-spares-multi-filters__chip-count">
                  {spareCatalogFilterCounts[option.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="catalog-spares-multi-filters__group">
        <span className="catalog-spares-multi-filters__label">Location</span>
        <div className="catalog-spares-multi-filters__chips" role="group" aria-label="Location filters">
          {SPARE_WAREHOUSE_LOCATION_FILTERS.map(option => {
            const active = spareLocationFilters.has(option.key);
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                className={`catalog-spares-multi-filters__chip${active ? ' is-active' : ''}`}
                onClick={() => onToggleLocationFilter(option.key)}
              >
                <span className="catalog-spares-multi-filters__chip-label">{option.label}</span>
                <span className="catalog-spares-multi-filters__chip-count">
                  {spareLocationFilterCounts[option.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
