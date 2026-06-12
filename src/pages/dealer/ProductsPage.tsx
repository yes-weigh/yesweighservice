import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { useAuth } from '../../context/AuthContext';
import { fetchCatalog, syncCatalog } from '../../lib/catalog';
import type { CatalogResponse } from '../../types/catalog';

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

  const stats = catalog?.stats;

  return (
    <div className="page-content fade-in products-page">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="stats-grid stats-grid--4 mb-6">
        <div className="stat-card glass">
          <div className="stat-content">
            <h3>Products</h3>
            <div className="stat-value">{stats?.totalProducts ?? 0}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-content">
            <h3>Categories</h3>
            <div className="stat-value">{stats?.totalCategories ?? 0}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-content">
            <h3>In stock</h3>
            <div className="stat-value">{stats?.inStock ?? 0}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-content">
            <h3>Low / out</h3>
            <div className="stat-value">{(stats?.lowStock ?? 0) + (stats?.outOfStock ?? 0)}</div>
          </div>
        </div>
      </div>

      {!catalog?.syncedAt && (catalog?.items.length ?? 0) === 0 && (
        <div className="products-inline-error panel glass mb-4">
          <AlertCircle size={18} />
          <span>
            Catalog not synced yet.
            {canSync ? ' Use Sync from Zoho to load products.' : ' Ask staff to run a Zoho sync.'}
          </span>
        </div>
      )}

      <CatalogBrowse
        products={catalog?.items ?? []}
        categories={catalog?.categories ?? []}
        isLoading={loading}
        title="Product catalog"
        subtitle={
          catalog?.syncedAt
            ? `Synced from Zoho Inventory · ${new Date(catalog.syncedAt).toLocaleString('en-IN')}`
            : 'Waiting for first Zoho sync'
        }
        headerExtra={
          <div className="catalog-toolbar__actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => void loadCatalog()}
            >
              <RefreshCw size={16} className={loading ? 'spin-icon' : undefined} />
              Refresh
            </button>
            {canSync && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={syncing}
                onClick={() => void handleSync()}
              >
                <RefreshCw size={16} className={syncing ? 'spin-icon' : undefined} />
                {syncing ? 'Syncing…' : 'Sync from Zoho'}
              </button>
            )}
          </div>
        }
      />
    </div>
  );
};
