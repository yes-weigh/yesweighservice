import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  FolderOpen,
  IndianRupee,
  LayoutGrid,
  List,
  Package,
  Search,
} from 'lucide-react';
import { isHiddenCatalogCategory } from '../../lib/catalog';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import { CategoryBrowseCard } from './CategoryBrowseCard';
import { CategoryBrowseSection } from './CategoryBrowseSection';
import { CategoryFolderGrid } from './CategoryFolderGrid';
import { ProductBrowseCard } from './ProductBrowseCard';
import { ProductDetailModal } from './ProductDetailModal';
import { ProductImageFrame } from './ProductImageFrame';
import { StockBadge } from './StockBadge';

export interface CatalogBrowseProps {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  isLoading?: boolean;
  title?: string;
  subtitle?: string;
  showCategoryGrid?: boolean;
  showToolbar?: boolean;
  headerExtra?: React.ReactNode;
  /** Extra controls shown at the end of the search/filter bar */
  filterExtra?: React.ReactNode;
  /** Public /oc layout — compact header, filters inline with title */
  variant?: 'dealer' | 'public';
  /** Dealer catalog — search only, grid view, no stock/admin filters */
  filterMode?: 'full' | 'minimal';
  onReset?: () => void;
  /** Staff/super_admin — drag reorder + category image upload */
  manageCategories?: boolean;
  onCategoriesReorder?: (categories: CatalogCategory[]) => void;
  onCategoryThumbnail?: (
    categoryId: string,
    categoryName: string,
    file: File,
  ) => Promise<string | null>;
}

function ProductListRow({ product, onSelect }: { product: CatalogProduct; onSelect: () => void }) {
  return (
    <button type="button" className="catalog-row panel glass" onClick={onSelect}>
      <div className="catalog-row__media">
        <StockBadge status={product.stockStatus} overlay />
        <ProductImageFrame src={product.imageUrl} alt={product.name} variant="row" />
      </div>
      <div className="catalog-row__main">
        {product.sku && <span className="catalog-card__sku">{product.sku}</span>}
        <h3>{product.name}</h3>
      </div>
      <div className="catalog-row__price">
        <IndianRupee size={16} strokeWidth={2.5} />
        {product.rate.toLocaleString('en-IN')}
      </div>
    </button>
  );
}

function CatalogFilters({
  search,
  setSearch,
  stockFilter,
  setStockFilter,
  viewMode,
  setViewMode,
  mode,
}: {
  search: string;
  setSearch: (v: string) => void;
  stockFilter: string;
  setStockFilter: (v: string) => void;
  viewMode: 'grid' | 'list';
  setViewMode: (v: 'grid' | 'list') => void;
  mode: 'full' | 'minimal';
}) {
  return (
    <>
      <div className="catalog-search">
        <Search size={16} />
        <input
          type="search"
          placeholder="Search weighing scales, indicators…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {mode === 'full' && (
        <>
          <select
            title="Filter stock status"
            aria-label="Filter stock status"
            value={stockFilter}
            onChange={e => setStockFilter(e.target.value)}
            className="catalog-select"
          >
            <option value="">All Stock Logs</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>

          <div className="catalog-view-toggle">
            <button
              type="button"
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              <List size={15} />
            </button>
          </div>
        </>
      )}
    </>
  );
}

export const CatalogBrowse: React.FC<CatalogBrowseProps> = ({
  products,
  categories,
  isLoading = false,
  title = 'Product catalog',
  subtitle,
  showCategoryGrid = true,
  showToolbar = true,
  headerExtra,
  filterExtra,
  variant = 'dealer',
  filterMode = 'full',
  onReset,
  manageCategories = false,
  onCategoriesReorder,
  onCategoryThumbnail,
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);

  const filteredCategories = useMemo(
    () => categories
      .filter(c => c.id && c.productCount > 0 && !isHiddenCatalogCategory(c))
      .sort((a, b) => {
        const orderDiff = a.displayOrder - b.displayOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      }),
    [categories],
  );

  const filteredProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q)
        || (p.sku ?? '').toLowerCase().includes(q)
        || (p.categoryName ?? '').toLowerCase().includes(q),
      );
    }
    if (activeCategory) {
      list = list.filter(p => p.categoryId === activeCategory);
    }
    if (stockFilter) {
      list = list.filter(p => p.stockStatus === stockFilter);
    }
    return list;
  }, [products, search, activeCategory, stockFilter]);

  const showProducts = Boolean(activeCategory || search.trim() || stockFilter);
  const activeCategoryName = filteredCategories.find(c => c.id === activeCategory)?.name;

  const clearFilters = () => {
    setActiveCategory('');
    setSearch('');
    setStockFilter('');
    onReset?.();
  };

  const resetToCategories = () => clearFilters();

  const filterProps = {
    search,
    setSearch,
    stockFilter,
    setStockFilter,
    viewMode,
    setViewMode,
    mode: filterMode,
  };

  const showFilterBar = filterMode === 'full' || filterMode === 'minimal';
  const showMinimalBack = filterMode === 'minimal' && showProducts;

  const filterBarClass = [
    'catalog-filters',
    filterMode === 'minimal' ? 'catalog-filters--minimal catalog-filters--sticky' : 'panel glass',
    showMinimalBack ? 'catalog-filters--with-back' : '',
  ].filter(Boolean).join(' ');

  const filterBar = showFilterBar ? (
    <div className={filterBarClass}>
      {showMinimalBack && (
        <button
          type="button"
          className="catalog-filters__back-btn"
          onClick={clearFilters}
          aria-label="All categories"
        >
          <ArrowLeft size={18} aria-hidden />
          <span>All categories</span>
        </button>
      )}
      <CatalogFilters {...filterProps} />
      {filterExtra}
    </div>
  ) : null;

  return (
    <div className={`catalog-browse catalog-browse--${variant}`}>
      {variant === 'public' ? (
        <header className="catalog-public-header panel glass">
          <button
            type="button"
            className="catalog-public-header__title"
            onClick={resetToCategories}
            title="Return to categories"
          >
            <h1>{title}</h1>
          </button>
          <div className="catalog-public-header__filters">
            <CatalogFilters {...filterProps} />
            {filterExtra}
          </div>
        </header>
      ) : showToolbar ? (
        <>
          <div className="catalog-toolbar panel glass">
            <div className="catalog-toolbar__copy">
              <p className="products-eyebrow">Zoho Inventory</p>
              <h2>{title}</h2>
              {subtitle && <p className="text-muted text-sm">{subtitle}</p>}
            </div>
            {headerExtra}
          </div>

          {filterBar}
        </>
      ) : (
        filterBar
      )}

      {showCategoryGrid && !showProducts && filteredCategories.length > 0 && manageCategories && onCategoriesReorder && onCategoryThumbnail && (
        <CategoryFolderGrid
          categories={filteredCategories}
          onCategoryClick={setActiveCategory}
          onReorder={onCategoriesReorder}
          onUploadThumbnail={onCategoryThumbnail}
        />
      )}

      {showCategoryGrid && !showProducts && filteredCategories.length > 0 && !manageCategories && (
        <CategoryBrowseSection showHeading={filterMode !== 'minimal'}>
          {filteredCategories.map((category, idx) => (
            <CategoryBrowseCard
              key={category.id}
              category={category}
              index={idx}
              onClick={() => setActiveCategory(category.id)}
            />
          ))}
        </CategoryBrowseSection>
      )}

      {showCategoryGrid && !showProducts && filteredCategories.length === 0 && products.length > 0 && (
        <div className="catalog-empty panel glass">
          <FolderOpen size={40} />
          <p>No categories yet</p>
          <span className="text-muted text-sm">Use search or stock filters to browse products.</span>
        </div>
      )}

      {showProducts && (
        <div className="catalog-results">
          {filterMode === 'full' && (
            <div className="catalog-results__bar panel glass">
              <span>
                {activeCategory
                  ? `Category: ${activeCategoryName ?? 'Selected'}`
                  : stockFilter
                    ? `Stock: ${stockFilter.replace(/_/g, ' ')}`
                    : search.trim()
                      ? `Search: "${search.trim()}"`
                      : 'Filtered products'}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="catalog-loading panel glass">
              <div className="loader-ring" />
              <p className="text-muted">Loading catalog…</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="catalog-empty panel glass">
              <Package size={40} />
              <p>No products found</p>
              <span className="text-muted text-sm">Try adjusting your filters or search term.</span>
            </div>
          ) : filterMode === 'minimal' || viewMode === 'grid' ? (
            <div className="catalog-grid catalog-grid--tiles">
              {filteredProducts.map((product, idx) => (
                <ProductBrowseCard
                  key={product.id}
                  product={product}
                  index={idx}
                  onSelect={() => setSelectedProduct(product)}
                />
              ))}
            </div>
          ) : (
            <div className="catalog-list">
              {filteredProducts.map(product => (
                <ProductListRow
                  key={product.id}
                  product={product}
                  onSelect={() => setSelectedProduct(product)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
};
