import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  compareCatalogProductsInCategory,
  formatStockQuantity,
  isCatalogSparePartProduct,
  isGenericSparePartsCategory,
  isHiddenCatalogCategory,
} from '../../lib/catalog';
import { catalogGridStockQty } from '../../lib/catalogProductAudit/display';
import { buildProductNavState, buildSpareNavState, catalogOriginFromReturnView } from '../../lib/catalogNav';
import type { CatalogNavState } from '../../lib/catalogNav';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useDealerOrderStockGate, useDealerListedCatalogProducts } from '../../hooks/useDealerOrderStockGate';
import { DEALER_ORDER_SCHEDULED_TITLE } from '../../lib/dealerOrderStock';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import { CategoryBrowseCard } from './CategoryBrowseCard';
import { CategoryBrowseSection } from './CategoryBrowseSection';
import { CategoryFolderGrid } from './CategoryFolderGrid';
import { ProductBrowseCard } from './ProductBrowseCard';
import { CatalogMerchBadges } from './CatalogMerchBadges';
import { CatalogOnOrderShipChip } from './CatalogOnOrderShipChip';
import { ProductFolderGrid } from './ProductFolderGrid';
import { ProductImageFrame } from './ProductImageFrame';
import { fillSearchFromScan, SkuScanButton } from './SkuScanButton';
import { StockBadge, StockQuantity } from './StockBadge';
import { useAuth } from '../../context/AuthContext';
import {
  canSeeDealerUnitPrice,
  dealerStaffTeam,
} from '../../lib/dealerAccess';
import { CatalogMrpLabel, DealerPriceDisplay } from './DealerPriceDisplay';
import { useDealerUnitPrice } from '../../hooks/useDealerUnitPrice';

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
  onCategoryProductsReorder?: (categoryId: string, products: CatalogProduct[]) => void;
  onCategoryThumbnail?: (
    categoryId: string,
    categoryName: string,
    file: File,
  ) => Promise<string | null>;
  /** Navigate to product detail page instead of modal */
  productsBasePath?: string;
  /** Dealer — show add-to-cart on product tiles */
  enableCart?: boolean;
  /** When enableCart is true, only show cart on products that pass this check. */
  isCartable?: (product: CatalogProduct) => boolean;
  /** Spares — skip category grid and list all products with search */
  flatBrowse?: boolean;
  searchPlaceholder?: string;
  /** Staff / super admin — show numeric stock on product tiles */
  showStockQuantity?: boolean;
  /** Dealer portal — hide missing-package icon; show stamping ranges on tiles */
  dealerView?: boolean;
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
  /** Passed through navigation state so detail pages can return to the correct list. */
  returnView?: string;
  /** Staff — quick action on product tiles (e.g. link unlinked spare to products). */
  manageItemLabel?: string;
  onManageItem?: (product: CatalogProduct) => void;
  /** Rendered inside the browse scroll area (below fixed bars). */
  listHeaderExtra?: React.ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
  /** Staff spares view — linked spare count per product id. */
  spareLinkCountByProductId?: Map<string, number>;
  /** Super admin — Zoho products with warehouse audit bins linked. */
  warehouseLinkedProductIds?: Set<string>;
  /** Staff/super_admin — open NC qty per product id. */
  openNcQtyByProductId?: Map<string, number>;
  /** Staff/super_admin — audited location label per product id. */
  auditedLocationByProductId?: Map<string, string>;
  /** Staff/super_admin — open / raised PO qty per product id. */
  raisedPoQtyByProductId?: Map<string, number>;
  /** Staff/super_admin — long-press product tile (e.g. Zoho warehouse move). */
  onLongPressProduct?: (product: CatalogProduct) => void;
  /** Emphasize this product after returning from detail. */
  highlightedProductId?: string | null;
  /** Override default navigation when a product tile is opened. */
  onProductSelect?: (product: CatalogProduct) => void;
  /** When false, do not touch the app page header (embed in another wizard). */
  managePageHeader?: boolean;
}

function ProductListRow({
  product,
  onSelect,
  showStockQuantity = false,
  dealerView = false,
  raisedPoQty = null,
}: {
  product: CatalogProduct;
  onSelect: () => void;
  showStockQuantity?: boolean;
  dealerView?: boolean;
  raisedPoQty?: number | null;
}) {
  const { user } = useAuth();
  const dealerStock = useDealerOrderStockGate();
  const dealerPricing = useDealerUnitPrice(dealerView ? product : null);
  const inboundQty = dealerStock.scheduledQty(product.id);
  const isSpareItem = isCatalogSparePartProduct(product);
  const hideDealerSpareQty = dealerStock.gate && isSpareItem;
  const hideTeamQty = dealerStaffTeam(user) != null;
  const showQty = showStockQuantity && !hideDealerSpareQty && !hideTeamQty;
  const showInboundQty = showQty && inboundQty > 0;
  const catalogMrp = product.mrpOverride != null && Number(product.mrpOverride) > 0
    ? Math.round(Number(product.mrpOverride) * 100) / 100
    : null;
  const showDealerCharge = dealerView && canSeeDealerUnitPrice(user, isSpareItem);
  const showMrpOnly = dealerView && !showDealerCharge;
  const showSpareMrpBeside = dealerView
    && dealerStaffTeam(user) === 'service'
    && isSpareItem
    && catalogMrp != null;
  const gridStockQty = catalogGridStockQty(product);
  const gridStockStatus = gridStockQty <= 0
    ? 'out_of_stock' as const
    : product.stockStatus === 'low_stock'
      ? 'low_stock' as const
      : 'in_stock' as const;

  return (
    <button type="button" className="catalog-row panel glass" onClick={onSelect}>
      <div className="catalog-row__media">
        <StockBadge status={product.stockStatus} overlay />
        <ProductImageFrame src={product.imageUrl} alt={product.name} variant="row" />
      </div>
      <div className="catalog-row__main">
        {product.sku && <span className="catalog-card__sku">{product.sku}</span>}
        <h3>{product.name}</h3>
        <CatalogMerchBadges product={product} className="catalog-merch-badges--under-photo" />
        {showQty && (
          <StockQuantity
            stock={gridStockQty}
            unit={product.unit}
            status={gridStockStatus}
            compact
          />
        )}
        {!hideDealerSpareQty && !hideTeamQty && raisedPoQty != null && raisedPoQty > 0 && (
          <CatalogOnOrderShipChip
            productId={product.id}
            quantity={raisedPoQty}
            unit={product.unit}
          />
        )}
        {showInboundQty && (
          <span
            className="catalog-product-card__inbound-chip catalog-product-card__inbound-chip--qty"
            title={DEALER_ORDER_SCHEDULED_TITLE}
          >
            {formatStockQuantity(inboundQty, product.unit)}
          </span>
        )}
      </div>
      <div className="catalog-row__price">
        {showDealerCharge ? (
          <>
            <DealerPriceDisplay listRate={product.rate} pricing={dealerPricing} />
            {showSpareMrpBeside ? <CatalogMrpLabel mrp={catalogMrp} iconSize={12} /> : null}
          </>
        ) : showMrpOnly ? (
          <CatalogMrpLabel mrp={catalogMrp} iconSize={14} />
        ) : (
          <>
            <IndianRupee size={16} strokeWidth={2.5} />
            {product.rate.toLocaleString('en-IN')}
          </>
        )}
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
        <SkuScanButton
          onScan={raw => fillSearchFromScan(raw, setSearch)}
          hint="Point at the product or spare label QR code."
          missMessage="Could not read a SKU"
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
  title = 'Products',
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
  onCategoryProductsReorder,
  onCategoryThumbnail,
  productsBasePath,
  enableCart = false,
  isCartable,
  flatBrowse = false,
  searchPlaceholder,
  showStockQuantity = false,
  dealerView = false,
  simpleCategoryTiles = false,
  activeCategoryId: controlledCategoryId,
  onActiveCategoryChange,
  searchQuery: catalogSearchQuery,
  onSearchChange,
  hideFilterBar = false,
  returnView,
  manageItemLabel,
  onManageItem,
  listHeaderExtra,
  emptyTitle,
  emptyHint,
  spareLinkCountByProductId,
  warehouseLinkedProductIds,
  openNcQtyByProductId,
  auditedLocationByProductId,
  raisedPoQtyByProductId,
  onLongPressProduct,
  highlightedProductId = null,
  onProductSelect,
  managePageHeader = true,
}) => {
  const navigate = useNavigate();
  const [internalSearch, setInternalSearch] = useState('');
  const search = catalogSearchQuery ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const [internalCategory, setInternalCategory] = useState('');
  const activeCategory = controlledCategoryId !== undefined ? controlledCategoryId : internalCategory;
  const setActiveCategory = useCallback((categoryId: string) => {
    if (onActiveCategoryChange) onActiveCategoryChange(categoryId);
    else setInternalCategory(categoryId);
  }, [onActiveCategoryChange]);
  const [stockFilter, setStockFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const listedProducts = useDealerListedCatalogProducts(products);

  useEffect(() => {
    if (!highlightedProductId) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `.catalog-product-card[data-product-id="${CSS.escape(highlightedProductId)}"]`,
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [highlightedProductId, listedProducts]);
  const openProduct = (product: CatalogProduct) => {
    if (onProductSelect) {
      onProductSelect(product);
      return;
    }
    if (productsBasePath) {
      const returnCategoryId = activeCategory || product.categoryId || '';
      const isSparePath = productsBasePath.endsWith('/spare');
      const isMapPath = productsBasePath.endsWith('/map');

      let state: CatalogNavState;
      if (isSparePath) {
        state = buildSpareNavState(product, {
          origin: catalogOriginFromReturnView(returnView),
          searchQuery: catalogSearchQuery,
          spareViewMode: 'items',
        });
      } else if (isMapPath) {
        state = buildProductNavState(product, {
          origin: 'map',
          returnCategoryId,
        });
      } else {
        state = buildProductNavState(product, {
          origin: flatBrowse ? 'spares' : 'browse',
          returnCategoryId,
          searchQuery: catalogSearchQuery,
        });
      }

      navigate(`${productsBasePath}/${product.id}`, { state });
      return;
    }
  };

  const filteredCategories = useMemo(() => {
    const listedCounts = new Map<string, number>();
    for (const product of listedProducts) {
      if (!product.categoryId) continue;
      listedCounts.set(product.categoryId, (listedCounts.get(product.categoryId) ?? 0) + 1);
    }
    return categories
      .filter(c => {
        if (!c.id || isHiddenCatalogCategory(c)) return false;
        if ((listedCounts.get(c.id) ?? 0) > 0) return true;
        // Spare-pool items are not in the shop product list used for this grid.
        return isGenericSparePartsCategory(c) && c.productCount > 0;
      })
      .map(c => {
        const n = listedCounts.get(c.id) ?? 0;
        if (n === 0 || n === c.productCount) return c;
        return { ...c, productCount: n, totalProductCount: n };
      })
      .sort((a, b) => {
        const orderDiff = a.displayOrder - b.displayOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });
  }, [categories, listedProducts]);

  const filteredProducts = useMemo(() => {
    let list = listedProducts;
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
    if (activeCategory && !search.trim() && !stockFilter) {
      list = [...list].sort(compareCatalogProductsInCategory);
    }
    return list;
  }, [listedProducts, search, activeCategory, stockFilter]);

  const canReorderCategoryProducts = Boolean(
    manageCategories
    && onCategoryProductsReorder
    && activeCategory
    && !search.trim()
    && !stockFilter
    && !flatBrowse,
  );

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
  }, managePageHeader && !hideFilterBar);

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

      {showCategoryGrid && !flatBrowse && !showProducts && filteredCategories.length === 0 && listedProducts.length > 0 && (
        <div className="catalog-empty panel glass">
          <FolderOpen size={40} />
          <p>No categories yet</p>
          <span className="text-muted text-sm">Use search or stock filters to browse products.</span>
        </div>
      )}

      {listHeaderExtra}

      {showProducts && (
        <div className="catalog-results">
          {variant === 'public' && browseHeaderTitle ? (
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
          ) : null}

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
                  ? 'Uncategorized Zoho items appear here after catalog sync.'
                  : 'Try adjusting your filters or search term.')}
              </span>
            </div>
          ) : canReorderCategoryProducts && (filterMode === 'minimal' || viewMode === 'grid') ? (
            <ProductFolderGrid
              products={filteredProducts}
              onProductSelect={openProduct}
              onReorder={nextProducts => onCategoryProductsReorder!(activeCategory, nextProducts)}
              enableCart={enableCart}
              isCartable={isCartable}
              showStockQuantity={showStockQuantity}
              dealerView={dealerView}
              manageItemLabel={onManageItem ? manageItemLabel : undefined}
              onManageItem={onManageItem}
              spareLinkCountByProductId={spareLinkCountByProductId}
              warehouseLinkedProductIds={warehouseLinkedProductIds}
              openNcQtyByProductId={openNcQtyByProductId}
              auditedLocationByProductId={auditedLocationByProductId}
              raisedPoQtyByProductId={raisedPoQtyByProductId}
              onLongPressProduct={onLongPressProduct}
            />
          ) : filterMode === 'minimal' || viewMode === 'grid' ? (
            <div className="catalog-grid catalog-grid--tiles">
              {filteredProducts.map((product, idx) => (
                <ProductBrowseCard
                  key={product.id}
                  product={product}
                  index={idx}
                  onSelect={() => openProduct(product)}
                  enableCart={enableCart}
                  isCartable={isCartable}
                  showStockQuantity={showStockQuantity}
                  dealerView={dealerView}
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
                  warehouseLinked={warehouseLinkedProductIds?.has(product.id)}
                  openNcCount={openNcQtyByProductId?.get(product.id)}
                  auditedLocationLabel={auditedLocationByProductId?.get(product.id)}
                  raisedPoQty={raisedPoQtyByProductId?.get(product.id)}
                  onLongPress={onLongPressProduct}
                  highlighted={highlightedProductId === product.id}
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
                  dealerView={dealerView}
                  raisedPoQty={raisedPoQtyByProductId?.get(product.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
