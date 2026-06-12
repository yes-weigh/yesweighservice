import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { useAuth } from '../../context/AuthContext';
import {
  fetchCatalog,
  saveCatalogCategoryOrder,
  syncCatalog,
  uploadCatalogCategoryThumbnail,
} from '../../lib/catalog';
import type { CatalogCategory, CatalogResponse } from '../../types/catalog';

export const ProductsPage: React.FC = () => {
  const { user } = useAuth();
  const canSync = user?.role === 'staff' || user?.role === 'super_admin';

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
      setError(err instanceof Error ? err.message : 'Unable to load product catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

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

  if (loading && !catalog) {
    return (
      <div className="page-content fade-in products-page">
        <div className="catalog-loading panel glass">
          <div className="loader-ring" />
          <p className="text-muted">Loading product catalog…</p>
        </div>
      </div>
    );
  }

  if (error && !catalog) {
    return (
      <div className="page-content fade-in products-page">
        <div className="panel glass products-error">
          <AlertCircle size={40} className="products-error-icon" />
          <h2>Could not load products</h2>
          <p className="text-muted">{error}</p>
          <div className="products-error-actions">
            <button type="button" className="btn btn-primary" onClick={() => void loadCatalog()}>
              Try again
            </button>
            {canSync && (
              <button type="button" className="btn btn-secondary" onClick={() => void handleSync()}>
                Sync from Zoho
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content fade-in products-page">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <CatalogBrowse
        products={catalog?.items ?? []}
        categories={catalog?.categories ?? []}
        isLoading={loading}
        showToolbar={false}
        manageCategories={canSync}
        onCategoriesReorder={canSync ? cats => void handleCategoriesReorder(cats) : undefined}
        onCategoryThumbnail={canSync ? handleCategoryThumbnail : undefined}
        filterExtra={
          canSync ? (
            <button
              type="button"
              className="btn btn-primary catalog-sync-btn"
              disabled={syncing || loading}
              onClick={() => void handleSync()}
            >
              <RefreshCw size={16} className={syncing ? 'spin-icon' : undefined} />
              {syncing ? 'Syncing catalog…' : 'Sync from Zoho'}
            </button>
          ) : undefined
        }
      />
    </div>
  );
};
