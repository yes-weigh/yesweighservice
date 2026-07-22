import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  CATEGORIZED_PRODUCT_FILTERS,
  NC_STATUS_FILTERS,
  SPARE_AUDIT_STATUS_FILTERS,
  SPARE_CATALOG_FILTERS,
  SPARE_STOCK_STATUS_FILTERS,
  SPARE_WAREHOUSE_LOCATION_FILTERS,
  type NcStatusFilter,
  type SpareAuditStatusFilter,
  type SpareStockStatusFilter,
  type SpareWarehouseLocationFilter,
} from '../../lib/catalog';

export type CatalogSparesFiltersFooterMode = 'none' | 'clear-only' | 'apply';
export type CatalogSparesFiltersLayout = 'stack' | 'compact';
export type CatalogSparesFiltersVariant = 'spares' | 'products';

export interface CatalogSparesMultiFiltersProps {
  variant?: CatalogSparesFiltersVariant;
  spareCatalogFilters: ReadonlySet<string>;
  onToggleCatalogFilter: (key: string) => void;
  spareStockStatusFilters: ReadonlySet<SpareStockStatusFilter>;
  onToggleStockStatusFilter: (key: SpareStockStatusFilter) => void;
  spareLocationFilters: ReadonlySet<SpareWarehouseLocationFilter>;
  onToggleLocationFilter: (key: SpareWarehouseLocationFilter) => void;
  spareAuditStatusFilters: ReadonlySet<SpareAuditStatusFilter>;
  onToggleAuditStatusFilter: (key: SpareAuditStatusFilter) => void;
  spareCatalogFilterCounts: Record<string, number>;
  spareStockStatusFilterCounts: Record<SpareStockStatusFilter, number>;
  spareLocationFilterCounts: Record<SpareWarehouseLocationFilter, number>;
  spareAuditStatusFilterCounts: Record<SpareAuditStatusFilter, number>;
  ncStatusFilters?: ReadonlySet<NcStatusFilter>;
  onToggleNcStatusFilter?: (key: NcStatusFilter) => void;
  ncStatusFilterCounts?: Record<NcStatusFilter, number>;
  /** Hide Cochin / Head Office when rack label-update filters are active. */
  hideLocationFilters?: boolean;
  onClearAll: () => void;
  onClose?: () => void;
  onApply?: () => void;
  footerMode?: CatalogSparesFiltersFooterMode;
  layout?: CatalogSparesFiltersLayout;
  collapsible?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
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

function FilterChip({
  label,
  count,
  active,
  onToggle,
}: {
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`catalog-inventory-audit__filter-chip${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onToggle}
    >
      {label}
      <span className="catalog-inventory-audit__filter-chip-count">{count}</span>
    </button>
  );
}

export const CatalogSparesMultiFilters: React.FC<CatalogSparesMultiFiltersProps> = ({
  variant = 'spares',
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
  ncStatusFilters,
  onToggleNcStatusFilter,
  ncStatusFilterCounts,
  hideLocationFilters = false,
  onClearAll,
  onClose,
  onApply,
  footerMode = 'clear-only',
  layout = 'stack',
  collapsible = false,
  expanded = true,
  onToggleExpanded,
  className = '',
}) => {
  const catalogFilterOptions = variant === 'products' ? CATEGORIZED_PRODUCT_FILTERS : SPARE_CATALOG_FILTERS;
  const catalogFilterGroupLabel = variant === 'products' ? 'Spare mapping' : 'Product status';
  const showLocationFilters = variant === 'spares' && !hideLocationFilters;
  const showNcFilters = variant === 'products'
    && ncStatusFilters != null
    && onToggleNcStatusFilter != null
    && ncStatusFilterCounts != null;
  const activeFilterCount =
    spareCatalogFilters.size
    + spareStockStatusFilters.size
    + (showLocationFilters ? spareLocationFilters.size : 0)
    + spareAuditStatusFilters.size
    + (showNcFilters ? ncStatusFilters.size : 0);
  const hasActiveFilters = activeFilterCount > 0;
  const isCompact = layout === 'compact';
  const isExpanded = !collapsible || expanded;
  const showFooter = footerMode !== 'none' && !isCompact;

  const renderOptions = (
    options: ReadonlyArray<{ key: string; label: string }>,
    counts: Record<string, number>,
    selected: ReadonlySet<string>,
    onToggle: (key: string) => void,
    idPrefix: string,
    ariaLabel: string,
  ) => (
    <div className="catalog-spares-multi-filters__options" role="group" aria-label={ariaLabel}>
      {options.map(option => {
        const checked = selected.has(option.key);
        if (isCompact) {
          return (
            <FilterChip
              key={option.key}
              label={option.label}
              count={counts[option.key]}
              active={checked}
              onToggle={() => onToggle(option.key)}
            />
          );
        }
        return (
          <FilterOptionRow
            key={option.key}
            id={`${idPrefix}-${option.key}`}
            label={option.label}
            count={counts[option.key]}
            checked={checked}
            onToggle={() => onToggle(option.key)}
          />
        );
      })}
    </div>
  );

  return (
    <div
      className={[
        'catalog-spares-multi-filters',
        isCompact ? 'catalog-spares-multi-filters--compact' : '',
        collapsible && !isExpanded ? 'catalog-spares-multi-filters--collapsed' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="catalog-spares-multi-filters__header">
        {collapsible ? (
          <button
            type="button"
            className="catalog-spares-multi-filters__toggle"
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
          >
            <ChevronDown
              size={16}
              strokeWidth={2.25}
              className={[
                'catalog-spares-multi-filters__toggle-chevron',
                isExpanded ? 'is-open' : '',
              ].filter(Boolean).join(' ')}
              aria-hidden
            />
            <span className="catalog-spares-multi-filters__title">Filters</span>
            {hasActiveFilters && (
              <span className="catalog-spares-multi-filters__active-badge">{activeFilterCount}</span>
            )}
          </button>
        ) : (
          <span className="catalog-spares-multi-filters__title">Filters</span>
        )}
        <div className="catalog-spares-multi-filters__header-actions">
          {isCompact && (isExpanded || hasActiveFilters) && (
            <button
              type="button"
              className="catalog-spares-multi-filters__clear-link"
              onClick={onClearAll}
              disabled={!hasActiveFilters}
            >
              Clear all
            </button>
          )}
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
      </div>

      {isExpanded && (
      <div className="catalog-spares-multi-filters__body">
        <div className="catalog-spares-multi-filters__group">
          <span className="catalog-spares-multi-filters__label">{catalogFilterGroupLabel}</span>
          {renderOptions(
            catalogFilterOptions,
            spareCatalogFilterCounts,
            spareCatalogFilters,
            onToggleCatalogFilter,
            variant === 'products' ? 'product-filter' : 'spare-filter',
            `${catalogFilterGroupLabel} filters`,
          )}
        </div>

        <div className="catalog-spares-multi-filters__group">
          <span className="catalog-spares-multi-filters__label">Stock status</span>
          {renderOptions(
            SPARE_STOCK_STATUS_FILTERS,
            spareStockStatusFilterCounts,
            spareStockStatusFilters,
            key => onToggleStockStatusFilter(key as SpareStockStatusFilter),
            'spare-stock',
            'Stock status filters',
          )}
        </div>

        {showLocationFilters && (
        <div className="catalog-spares-multi-filters__group">
          <span className="catalog-spares-multi-filters__label">Storage location</span>
          {renderOptions(
            SPARE_WAREHOUSE_LOCATION_FILTERS,
            spareLocationFilterCounts,
            spareLocationFilters,
            key => onToggleLocationFilter(key as SpareWarehouseLocationFilter),
            'spare-location',
            'Storage location filters',
          )}
        </div>
        )}

        <div className="catalog-spares-multi-filters__group">
          <span className="catalog-spares-multi-filters__label">Audit status</span>
          {renderOptions(
            SPARE_AUDIT_STATUS_FILTERS,
            spareAuditStatusFilterCounts,
            spareAuditStatusFilters,
            key => onToggleAuditStatusFilter(key as SpareAuditStatusFilter),
            'spare-audit',
            'Audit status filters',
          )}
        </div>

        {showNcFilters && (
          <div className="catalog-spares-multi-filters__group">
            <span className="catalog-spares-multi-filters__label">Non-Conformance</span>
            {renderOptions(
              NC_STATUS_FILTERS,
              ncStatusFilterCounts,
              ncStatusFilters,
              key => onToggleNcStatusFilter(key as NcStatusFilter),
              'product-nc',
              'Non-Conformance filters',
            )}
          </div>
        )}
      </div>
      )}

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
