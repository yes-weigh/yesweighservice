import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import { CategoryBrowseCard } from './CategoryBrowseCard';
import { CategoryBrowseSection } from './CategoryBrowseSection';
import { CategoryFolderGrid } from './CategoryFolderGrid';
import { ProductBrowseCard } from './ProductBrowseCard';
import { ProductImageFrame } from './ProductImageFrame';
import { StockBadge, StockQuantity } from './StockBadge';

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
  /** Navigate to product detail page instead of modal */
  productsBasePath?: string;
  /** Dealer — show add-to-cart on product tiles */
  enableCart?: boolean;
  /** Spares — skip category grid and list all products with search */
  flatBrowse?: boolean;
  searchPlaceholder?: string;
  /** Staff / super admin — show numeric stock on product tiles */
  showStockQuantity?: boolean;
  /** Title + image only on category tiles (no subtitle or item count) */
  simpleCategoryTiles?: boolean;
  /** When set, category selection is controlled by the parent (e.g. URL on spares page). */
  activeCategoryId?: string;
  onActiveCategoryChange?: (categoryId: string) => void;
  /** Controlled search — pair with onSearchChange when the parent renders its own search UI. */
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  /** Hide the built-in search/filter bar (e.g. spares page mode bar search). */
  hideFilterBar?: boolean;
  /** Passed through navigation state so detail pages can return to the correct spares tab. */
  returnView?: string;
  /** Staff — quick action on product tiles (e.g. link unlinked spare to products). */
  manageItemLabel?: string;
  onManageItem?: (product: CatalogProduct) => void;
  emptyTitle?: string;
  emptyHint?: string;
  /** Staff spares view — linked spare count per product id. */
  spareLinkCountByProductId?: Map<string, number>;
}

function ProductListRow({
  product,
  onSelect,
  showStockQuantity = false,
}: {
  product: CatalogProduct;
  onSelect: () => void;
  showStockQuantity?: boolean;
}) {
  return (
    <button type="button" className="catalog-row panel glass" onClick={onSelect}>
      <div className="catalog-row__media">
        <StockBadge status={product.stockStatus} overlay />
        <ProductImageFrame src={product.imageUrl} alt={product.name} variant="row" />
      </div>
      <div className="catalog-row__main">
        {product.sku && <span className="catalog-card__sku">{product.sku}</span>}
        <h3>{product.name}</h3>
        {showStockQuantity && (
          <StockQuantity
            stock={product.stock}
            unit={product.unit}
            status={product.stockStatus}
            compact
          />
        )}
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
  searchPlaceholder = 'Search weighing scales, indicators…',
}: {
  search: string;
  setSearch: (v: string) => void;
  stockFilter: string;
  setStockFilter: (v: string) => void;
  viewMode: 'grid' | 'list';
  setViewMode: (v: 'grid' | 'list') => void;
  mode: 'full' | 'minimal';
  searchPlaceholder?: string;
}) {
  return (
    <>
      <div className="catalog-search">
        <Search size={16} />
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {mode === 'full' && (
        <div className="catalog-filters__desktop-only">
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
        </div>
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
  productsBasePath,
  enableCart = false,
  flatBrowse = false,
  searchPlaceholder,
  showStockQuantity = false,
  simpleCategoryTiles = false,
  activeCategoryId: controlledCategoryId,
  onActiveCategoryChange,
  searchQuery: controlledSearch,
  onSearchChange,
  hideFilterBar = false,
  returnView,
  manageItemLabel,
  onManageItem,
  emptyTitle,
  emptyHint,
  spareLinkCountByProductId,
}) => {
  const navigate = useNavigate();
  const [internalSearch, setInternalSearch] = useState('');
  const search = controlledSearch ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const [internalCategory, setInternalCategory] = useState('');
  const activeCategory = controlledCategoryId !== undefined ? controlledCategoryId : internalCategory;
  const setActiveCategory = useCallback((categoryId: string) => {
    if (onActiveCategoryChange) onActiveCategoryChange(categoryId);
    else setInternalCategory(categoryId);
  }, [onActiveCategoryChange]);
  const [stockFilter, setStockFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const openProduct = (product: CatalogProduct) => {
    if (productsBasePath) {
      const returnCategoryId = activeCategory || product.categoryId || '';
      navigate(`${productsBasePath}/${product.id}`, {
        state: { preview: product, returnCategoryId, returnView },
      });
      return;
    }
  };

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

  const showProducts = flatBrowse || Boolean(activeCategory || search.trim() || stockFilter);
  const activeCategoryName = filteredCategories.find(c => c.id === activeCategory)?.name;

  const clearFilters = useCallback(() => {
    setActiveCategory('');
    setSearch('');
    setStockFilter('');
    onReset?.();
  }, [onReset, setActiveCategory]);

  const resetToCategories = useCallback(() => clearFilters(), [clearFilters]);

  const browseHeaderTitle = useMemo(() => {
    if (!showProducts) return null;
    if (activeCategory) return activeCategoryName ?? 'Category';
    if (search.trim()) return search.trim();
    if (stockFilter) return stockFilter.replace(/_/g, ' ');
    return null;
  }, [showProducts, activeCategory, activeCategoryName, search, stockFilter]);

  useCatalogPageHeader({
    title: browseHeaderTitle,
    showBack: Boolean(browseHeaderTitle),
    onBack: clearFilters,
  });

  const filterProps = {
    search,
    setSearch,
    stockFilter,
    setStockFilter,
    viewMode,
    setViewMode,
    mode: filterMode,
    searchPlaceholder,
  };

  const showFilterBar = !hideFilterBar && (filterMode === 'full' || filterMode === 'minimal');

  const filterBarClass = [
    'catalog-filters',
    filterMode === 'minimal' ? 'catalog-filters--minimal catalog-filters--sticky' : 'panel glass',
  ].filter(Boolean).join(' ');

  const filterBar = showFilterBar ? (
    <div className={filterBarClass}>
      <CatalogFilters {...filterProps} />
      {filterExtra ? (
        <div className="catalog-filters__desktop-only catalog-filters__extras">
          {filterExtra}
        </div>
      ) : null}
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
            {filterExtra ? (
              <div className="catalog-filters__desktop-only catalog-filters__extras">
                {filterExtra}
              </div>
            ) : null}
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

      {showCategoryGrid && !flatBrowse && !showProducts && filteredCategories.length > 0 && manageCategories && onCategoriesReorder && onCategoryThumbnail && (
        <CategoryFolderGrid
          categories={filteredCategories}
          onCategoryClick={setActiveCategory}
          onReorder={onCategoriesReorder}
          onUploadThumbnail={onCategoryThumbnail}
          simpleCategoryTiles={simpleCategoryTiles}
        />
      )}

      {showCategoryGrid && !flatBrowse && !showProducts && filteredCategories.length > 0 && !manageCategories && (
        <CategoryBrowseSection showHeading={filterMode !== 'minimal'}>
          {filteredCategories.map((category, idx) => (
            <CategoryBrowseCard
              key={category.id}
              category={category}
              index={idx}
              onClick={() => setActiveCategory(category.id)}
              simple={simpleCategoryTiles}
            />
          ))}
        </CategoryBrowseSection>
      )}

      {showCategoryGrid && !flatBrowse && !showProducts && filteredCategories.length === 0 && products.length > 0 && (
        <div className="catalog-empty panel glass">
          <FolderOpen size={40} />
          <p>No categories yet</p>
          <span className="text-muted text-sm">Use search or stock filters to browse products.</span>
        </div>
      )}

      {showProducts && (
        <div className="catalog-results">
          {variant === 'public' && browseHeaderTitle && (
            <div className="catalog-results__bar panel glass">
              <button
                type="button"
                className="catalog-filters__back-btn"
                onClick={clearFilters}
                aria-label="All categories"
              >
                <ArrowLeft size={18} aria-hidden />
                <span>All categories</span>
              </button>
              <span className="catalog-results__context">{browseHeaderTitle}</span>
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
              <p>{emptyTitle ?? (flatBrowse && !search.trim() ? 'No spares in catalog' : 'No products found')}</p>
              <span className="text-muted text-sm">
                {emptyHint ?? (flatBrowse && !search.trim()
                  ? 'Ungrouped Zoho items appear here after catalog sync.'
                  : 'Try adjusting your filters or search term.')}
              </span>
            </div>
          ) : filterMode === 'minimal' || viewMode === 'grid' ? (
            <div className="catalog-grid catalog-grid--tiles">
              {filteredProducts.map((product, idx) => (
                <ProductBrowseCard
                  key={product.id}
                  product={product}
                  index={idx}
                  onSelect={() => openProduct(product)}
                  enableCart={enableCart}
                  showStockQuantity={showStockQuantity}
                  manageLabel={onManageItem ? manageItemLabel : undefined}
                  onManage={
                    onManageItem
                      ? event => {
                          event.stopPropagation();
                          onManageItem(product);
                        }
                      : undefined
                  }
                  linkedSpareCount={
                    spareLinkCountByProductId !== undefined
                      ? spareLinkCountByProductId.get(product.id) ?? 0
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="catalog-list">
              {filteredProducts.map(product => (
                <ProductListRow
                  key={product.id}
                  product={product}
                  onSelect={() => openProduct(product)}
                  showStockQuantity={showStockQuantity}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
