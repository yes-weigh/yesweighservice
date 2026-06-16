import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, Boxes, Package, RefreshCw } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { useAuth } from '../../context/AuthContext';
import {
  fetchCatalog,
  getCategorizedProducts,
  getCategoriesForProducts,
  getUncategorizedProducts,
  isSparesExcludedCategory,
  saveCatalogCategoryOrder,
  syncCatalog,
  uploadCatalogCategoryThumbnail,
} from '../../lib/catalog';
import { canUseCart } from '../../types';
import type { CatalogCategory, CatalogResponse } from '../../types/catalog';

type SparesViewMode = 'product' | 'spares';

function parseViewMode(value: string | null): SparesViewMode {
  return value === 'spares' ? 'spares' : 'product';
}

export const SparesPage: React.FC = () => {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canSync = user?.role === 'staff' || user?.role === 'super_admin';
  const viewMode = parseViewMode(searchParams.get('view'));

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const sparesProducts = useMemo(
    () => getUncategorizedProducts(catalog?.items ?? []),
    [catalog?.items],
  );

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

  const setViewMode = (mode: SparesViewMode) => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Catalog sync failed.');
    } finally {
      setSyncing(false);
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
    : (canSync
      ? 'Ungrouped Zoho items — flat spare list'
      : 'Browse all spare parts');

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
    </div>
  );

  const modeBar = (
    <div className="spares-mode-bar">
      <div className="spares-mode-bar__controls">
        {modeToggle}
        <p id="spares-mode-hint" className="spares-mode-bar__hint">{modeHint}</p>
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
    <div className="page-content fade-in products-page spares-page">
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
          isLoading={loading}
          showToolbar={false}
          filterMode={canSync ? 'full' : 'minimal'}
          manageCategories={canSync}
          onCategoriesReorder={canSync ? cats => void handleCategoriesReorder(cats) : undefined}
          onCategoryThumbnail={canSync ? handleCategoryThumbnail : undefined}
          productsBasePath={`${pathname}/product`}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={canSync}
          searchPlaceholder="Search products to map spares…"
          simpleCategoryTiles
          activeCategoryId={categoryId}
          onActiveCategoryChange={setCategoryId}
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
          searchPlaceholder="Search spare parts, components, accessories…"
          productsBasePath={pathname}
          enableCart={canUseCart(user?.role)}
          showStockQuantity={canSync}
        />
      )}
    </div>
  );
};
