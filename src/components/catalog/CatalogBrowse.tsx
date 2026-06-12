import React, { useMemo, useState } from 'react';
import {
  FolderOpen,
  IndianRupee,
  LayoutGrid,
  List,
  Package,
  Search,
} from 'lucide-react';
import { isHiddenCatalogCategory } from '../../lib/catalog';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import { CategoryFolderGrid } from './CategoryFolderGrid';
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

function ProductCard({ product, onSelect }: { product: CatalogProduct; onSelect: () => void }) {
  return (
    <button type="button" className="catalog-card panel glass" onClick={onSelect}>
      <div className="catalog-card__media">
        <StockBadge status={product.stockStatus} overlay />
        <ProductImageFrame src={product.imageUrl} alt={product.name} variant="card" />
      </div>
      <div className="catalog-card__body">
        {product.sku && <span className="catalog-card__sku">{product.sku}</span>}
        <h3>{product.name}</h3>
        <div className="catalog-card__price">
          <span>Price</span>
          <strong>
            <IndianRupee size={16} strokeWidth={2.5} />
            {product.rate.toLocaleString('en-IN')}
          </strong>
        </div>
      </div>
    </button>
  );
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
}: {
  search: string;
  setSearch: (v: string) => void;
  stockFilter: string;
  setStockFilter: (v: string) => void;
  viewMode: 'grid' | 'list';
  setViewMode: (v: 'grid' | 'list') => void;
}) {
  return (
    <>
      <div className="catalog-search">
        <Search size={16} />
        <input
          type="search"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

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
  };

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

          <div className="catalog-filters panel glass">
            <CatalogFilters {...filterProps} />
            {filterExtra}
          </div>
        </>
      ) : (
        <div className="catalog-filters panel glass">
          <CatalogFilters {...filterProps} />
          {filterExtra}
        </div>
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
        <section className="catalog-categories">
          <h3>
            <FolderOpen size={14} />
            Browse categories
          </h3>
          <div className="catalog-categories__grid">
            {filteredCategories.map(category => (
              <button
                key={category.id}
                type="button"
                className="catalog-category panel glass"
                onClick={() => setActiveCategory(category.id)}
              >
                <div className="catalog-category__thumb">
                  {category.thumbnailUrl ? (
                    <img src={category.thumbnailUrl} alt={category.name} loading="lazy" />
                  ) : (
                    <FolderOpen size={42} className="catalog-category__icon" />
                  )}
                </div>
                <div className="catalog-category__copy">
                  <p>{category.name}</p>
                  <span>{category.productCount}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
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
          ) : viewMode === 'grid' ? (
            <div className="catalog-grid">
              {filteredProducts.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
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
