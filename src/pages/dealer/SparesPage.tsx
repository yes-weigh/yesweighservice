import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { useAuth } from '../../context/AuthContext';
import {
  fetchCatalog,
  getUncategorizedProducts,
  syncCatalog,
} from '../../lib/catalog';
import { canUseCart } from '../../types';
import type { CatalogResponse } from '../../types/catalog';

export const SparesPage: React.FC = () => {
  const { pathname } = useLocation();
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
    <div className="page-content fade-in products-page spares-page">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <CatalogBrowse
        products={sparesProducts}
        categories={[]}
        isLoading={loading}
        showToolbar={false}
        showCategoryGrid={false}
        flatBrowse
        filterMode="minimal"
        searchPlaceholder="Search spare parts, components, accessories…"
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
        productsBasePath={pathname}
        enableCart={canUseCart(user?.role)}
        showStockQuantity={canSync}
      />
    </div>
  );
};
