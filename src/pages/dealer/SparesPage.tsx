import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, Boxes, Link2, Package, RefreshCw, Search } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { SpareLinkEditor } from '../../components/catalog/SpareLinkEditor';
import { useAuth } from '../../context/AuthContext';
import {
  fetchCatalog,
  fetchCatalogSpareLinks,
  fetchSpareLinkIndex,
  getCategorizedProducts,
  getCategoriesForProducts,
  getUncategorizedProducts,
  getUnlinkedSpares,
  isSparesExcludedCategory,
  saveCatalogCategoryOrder,
  saveCatalogSpareProductLinks,
  syncCatalog,
  uploadCatalogCategoryThumbnail,
} from '../../lib/catalog';
import { canUseCart } from '../../types';
import type { CatalogCategory, CatalogProduct, CatalogResponse } from '../../types/catalog';

type SparesViewMode = 'product' | 'spares' | 'unlinked';

function parseViewMode(value: string | null, allowUnlinked: boolean): SparesViewMode {
  if (value === 'spares') return 'spares';
  if (value === 'unlinked' && allowUnlinked) return 'unlinked';
  return 'product';
}

export const SparesPage: React.FC = () => {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canSync = user?.role === 'staff' || user?.role === 'super_admin';
  const viewMode = parseViewMode(searchParams.get('view'), canSync);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [linkedSpareIds, setLinkedSpareIds] = useState<Set<string> | null>(null);
  const [spareCountByProductId, setSpareCountByProductId] = useState<Map<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [linksLoading, setLinksLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sparesSearch, setSparesSearch] = useState('');

  const [linkEditorSpare, setLinkEditorSpare] = useState<CatalogProduct | null>(null);
  const [linkEditorProductIds, setLinkEditorProductIds] = useState<string[]>([]);
  const [linkEditorSaving, setLinkEditorSaving] = useState(false);

  const loadLinkedSpareIds = useCallback(async () => {
    if (!canSync) return;
    setLinksLoading(true);
    try {
      const index = await fetchSpareLinkIndex();
      setLinkedSpareIds(index.linkedSpareIds);
      setSpareCountByProductId(index.spareCountByProductId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load spare link status.');
    } finally {
      setLinksLoading(false);
    }
  }, [canSync]);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load spares catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadLinkedSpareIds();
  }, [loadLinkedSpareIds]);

  const sparesProducts = useMemo(
    () => getUncategorizedProducts(catalog?.items ?? []),
    [catalog?.items],
  );

  const unlinkedSpares = useMemo(() => {
    if (!linkedSpareIds) return [];
    return getUnlinkedSpares(catalog?.items ?? [], linkedSpareIds);
  }, [catalog?.items, linkedSpareIds]);

  const catalogProducts = useMemo(
    () => getCategorizedProducts(catalog?.items ?? [])
      .filter(p => {
        const cat = catalog?.categories?.find(c => c.id === p.categoryId);
        return !cat || !isSparesExcludedCategory(cat);
      }),
    [catalog?.items, catalog?.categories],
  );

  const catalogCategories = useMemo(
    () => getCategoriesForProducts(catalog?.categories ?? [], catalogProducts)
      .filter(c => !isSparesExcludedCategory(c)),
    [catalog?.categories, catalogProducts],
  );

  const productPool = useMemo(
    () => getCategorizedProducts(catalog?.items ?? []),
    [catalog?.items],
  );

  const setViewMode = (mode: SparesViewMode) => {
    if (mode === 'product') setSparesSearch('');
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (mode === 'product') next.delete('view');
      else next.set('view', mode);
      return next;
    }, { replace: true });
  };

  const categoryId = searchParams.get('category') ?? '';

  const setCategoryId = useCallback((id: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('category', id);
      else next.delete('category');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleCategoriesReorder = async (nextCategories: CatalogCategory[]) => {
    const orderById = new Map(nextCategories.map((cat, index) => [cat.id, index]));
    setCatalog(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: prev.categories.map(cat => {
          const order = orderById.get(cat.id);
          return order !== undefined ? { ...cat, displayOrder: order } : cat;
        }),
      };
    });
    try {
      await saveCatalogCategoryOrder(
        nextCategories.map((cat, index) => ({
          id: cat.id,
          name: cat.name,
          displayOrder: index,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save category order.');
      await loadCatalog();
    }
  };

  const handleCategoryThumbnail = async (
    categoryId: string,
    categoryName: string,
    file: File,
  ): Promise<string | null> => {
    setError(null);
    try {
      const thumbnailUrl = await uploadCatalogCategoryThumbnail(categoryId, categoryName, file);
      setCatalog(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          categories: prev.categories.map(cat =>
            cat.id === categoryId ? { ...cat, thumbnailUrl } : cat,
          ),
        };
      });
      return thumbnailUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Category image upload failed.');
      return null;
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncCatalog();
      await loadCatalog();
      await loadLinkedSpareIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Catalog sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const openLinkEditor = async (spare: CatalogProduct) => {
    setLinkEditorSpare(spare);
    setLinkEditorProductIds([]);
    try {
      const response = await fetchCatalogSpareLinks({ spareId: spare.id });
      setLinkEditorProductIds(response.items.map(item => item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load existing product links.');
    }
  };

  const handleSaveSpareLinks = async (productIds: string[]) => {
    if (!linkEditorSpare) return;
    setLinkEditorSaving(true);
    setError(null);
    try {
      await saveCatalogSpareProductLinks(linkEditorSpare.id, productIds);
      setLinkEditorSpare(null);
      await loadLinkedSpareIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product mapping.');
    } finally {
      setLinkEditorSaving(false);
    }
  };

  const syncButton = canSync ? (
    <button
      type="button"
      className="btn btn-primary catalog-sync-btn zoho-sync-btn"
      disabled={syncing || loading}
      onClick={() => void handleSync()}
    >
      <RefreshCw size={16} className={syncing ? 'spin-icon' : undefined} />
      {syncing ? 'Syncing catalog…' : 'Sync from Zoho'}
    </button>
  ) : undefined;

  const modeHint = viewMode === 'product'
    ? (canSync
      ? 'Pick a product, then map compatible spares'
      : 'Pick a product to see compatible spares')
    : viewMode === 'unlinked'
      ? 'Spares not linked to any product — use the link button or open a spare to map products'
      : (canSync
        ? 'Ungrouped Zoho items — flat spare list'
        : 'Browse all spare parts');

  const isFlatBrowse = viewMode === 'spares' || viewMode === 'unlinked';

  const modeToggle = (
    <div className="spares-mode-toggle" role="tablist" aria-label="Spares browse mode">
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === 'product'}
        aria-controls="spares-mode-hint"
        title="Browse products by category to map spares"
        className={`spares-mode-toggle__btn ${viewMode === 'product' ? 'spares-mode-toggle__btn--active' : ''}`}
        onClick={() => setViewMode('product')}
      >
        <Package size={16} aria-hidden />
        <span className="spares-mode-toggle__label">By product</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === 'spares'}
        aria-controls="spares-mode-hint"
        title="Browse all spare parts in one list"
        className={`spares-mode-toggle__btn ${viewMode === 'spares' ? 'spares-mode-toggle__btn--active' : ''}`}
        onClick={() => setViewMode('spares')}
      >
        <Boxes size={16} aria-hidden />
        <span className="spares-mode-toggle__label">All spares</span>
      </button>
      {canSync && (
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'unlinked'}
          aria-controls="spares-mode-hint"
          title="Spares not linked to any product"
          className={`spares-mode-toggle__btn spares-mode-toggle__btn--unlinked ${viewMode === 'unlinked' ? 'spares-mode-toggle__btn--active' : ''}`}
          onClick={() => setViewMode('unlinked')}
        >
          <Link2 size={16} aria-hidden />
          <span className="spares-mode-toggle__label">Unlinked</span>
          {linkedSpareIds && unlinkedSpares.length > 0 && (
            <span className="spares-mode-toggle__badge">{unlinkedSpares.length}</span>
          )}
        </button>
      )}
    </div>
  );

  const modeBar = (
    <div
      className={`spares-mode-bar ${isFlatBrowse ? 'spares-mode-bar--all-spares' : ''}`}
    >
      <div className="spares-mode-bar__controls">
        {modeToggle}
        {isFlatBrowse ? (
          <div className="spares-mode-bar__search catalog-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder={
                viewMode === 'unlinked'
                  ? 'Search unlinked spares by name or SKU…'
                  : 'Search spares by name or SKU…'
              }
              value={sparesSearch}
              onChange={e => setSparesSearch(e.target.value)}
              aria-label="Search spare parts"
            />
          </div>
        ) : (
          <p id="spares-mode-hint" className="spares-mode-bar__hint">{modeHint}</p>
        )}
      </div>
      {syncButton && (
        <div className="spares-mode-bar__actions">
          {syncButton}
        </div>
      )}
    </div>
  );

  if (loading && !catalog) {
    return (
      <div className="page-content fade-in products-page spares-page">
        <div className="catalog-loading panel glass">
          <div className="loader-ring" />
          <p className="text-muted">Loading spares…</p>
        </div>
      </div>
    );
  }

  if (error && !catalog) {
    return (
      <div className="page-content fade-in products-page spares-page">
        <div className="panel glass products-error">
          <AlertCircle size={40} className="products-error-icon" />
          <h2>Could not load spares</h2>
          <p className="text-muted">{error}</p>
          <div className="products-error-actions">
            <button type="button" className="btn btn-primary" onClick={() => void loadCatalog()}>
              Try again
            </button>
            {canSync && (
              <button type="button" className="btn btn-secondary zoho-sync-btn" onClick={() => void handleSync()}>
                Sync from Zoho
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`page-content fade-in products-page spares-page ${isFlatBrowse ? 'spares-page--all-spares' : ''}`}
    >
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {modeBar}

      {viewMode === 'product' ? (
        <CatalogBrowse
          products={catalogProducts}
          categories={catalogCategories}
          isLoading={loading || linksLoading}
          showToolbar={false}
          filterMode={canSync ? 'full' : 'minimal'}
          manageCategories={canSync}
          onCategoriesReorder={canSync ? cats => void handleCategoriesReorder(cats) : undefined}
          onCategoryThumbnail={canSync ? handleCategoryThumbnail : undefined}
          productsBasePath={`${pathname}/product`}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={canSync}
          spareLinkCountByProductId={canSync ? spareCountByProductId ?? undefined : undefined}
          searchPlaceholder="Search products to map spares…"
          simpleCategoryTiles
          activeCategoryId={categoryId}
          onActiveCategoryChange={setCategoryId}
        />
      ) : viewMode === 'unlinked' ? (
        <CatalogBrowse
          products={unlinkedSpares}
          categories={[]}
          isLoading={loading || linksLoading}
          showToolbar={false}
          showCategoryGrid={false}
          flatBrowse
          filterMode="minimal"
          hideFilterBar
          searchQuery={sparesSearch}
          onSearchChange={setSparesSearch}
          productsBasePath={pathname}
          showStockQuantity
          returnView="unlinked"
          manageItemLabel="Link to products"
          onManageItem={spare => void openLinkEditor(spare)}
          emptyTitle={
            sparesSearch.trim()
              ? 'No unlinked spares match your search'
              : 'All spares are linked'
          }
          emptyHint={
            sparesSearch.trim()
              ? 'Try a different name or SKU.'
              : 'Every ungrouped spare in the catalog is mapped to at least one product.'
          }
        />
      ) : (
        <CatalogBrowse
          products={sparesProducts}
          categories={[]}
          isLoading={loading}
          showToolbar={false}
          showCategoryGrid={false}
          flatBrowse
          filterMode="minimal"
          hideFilterBar
          searchQuery={sparesSearch}
          onSearchChange={setSparesSearch}
          productsBasePath={pathname}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={canSync}
          returnView="spares"
        />
      )}

      {linkEditorSpare && (
        <SpareLinkEditor
          mode="spare"
          itemName={linkEditorSpare.name}
          pool={productPool}
          selectedIds={linkEditorProductIds}
          saving={linkEditorSaving}
          onClose={() => setLinkEditorSpare(null)}
          onSave={handleSaveSpareLinks}
        />
      )}
    </div>
  );
};
