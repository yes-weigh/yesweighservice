import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  FolderTree,
  Layers,
  Package,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react';
import { fetchZohoCatalog, formatCurrency } from '../../lib/zohoCatalog';
import type { ZohoCatalogItem, ZohoCatalogResponse, ZohoItemGroup } from '../../types/zoho';

type TabKey = 'all' | 'items' | 'groups';
type StatusFilter = 'all' | 'active' | 'inactive';

function statusClass(status: string): string {
  return status.toLowerCase() === 'active' ? 'active' : 'inactive';
}

function matchesSearch(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

function filterItems(items: ZohoCatalogItem[], query: string, status: StatusFilter): ZohoCatalogItem[] {
  return items.filter(item => {
    const statusOk =
      status === 'all' || item.status.toLowerCase() === (status === 'active' ? 'active' : 'inactive');
    if (!statusOk) return false;
    if (!query.trim()) return true;
    return (
      matchesSearch(item.name, query) ||
      matchesSearch(item.sku, query) ||
      matchesSearch(item.type, query) ||
      matchesSearch(item.groupName ?? '', query)
    );
  });
}

function filterGroups(groups: ZohoItemGroup[], query: string, status: StatusFilter): ZohoItemGroup[] {
  return groups.filter(group => {
    const statusOk =
      status === 'all' || group.status.toLowerCase() === (status === 'active' ? 'active' : 'inactive');
    if (!statusOk) return false;
    if (!query.trim()) return true;
    return (
      matchesSearch(group.name, query) ||
      matchesSearch(group.description, query) ||
      group.items.some(
        item =>
          matchesSearch(item.name, query) ||
          matchesSearch(item.sku, query),
      )
    );
  });
}

export const ProductsPage: React.FC = () => {
  const [catalog, setCatalog] = useState<ZohoCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabKey>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const loadCatalog = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchZohoCatalog();
      setCatalog(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to load products from Zoho Inventory.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const filteredItems = useMemo(
    () => filterItems(catalog?.items ?? [], query, statusFilter),
    [catalog?.items, query, statusFilter],
  );

  const filteredGroups = useMemo(
    () => filterGroups(catalog?.itemGroups ?? [], query, statusFilter),
    [catalog?.itemGroups, query, statusFilter],
  );

  const showItems = tab === 'all' || tab === 'items';
  const showGroups = tab === 'all' || tab === 'groups';

  if (loading) {
    return (
      <div className="page-content fade-in products-page">
        <div className="products-loading panel glass">
          <div className="loader-ring mx-auto" />
          <p className="text-muted text-center mt-4">Loading catalog from Zoho Inventory…</p>
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
          <button type="button" className="btn btn-primary mt-4" onClick={() => void loadCatalog()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const stats = catalog?.stats;

  return (
    <div className="page-content fade-in products-page">
      <div className="products-toolbar panel glass">
        <div className="products-toolbar-copy">
          <p className="products-eyebrow">Zoho Inventory</p>
          <h2>Product catalog</h2>
          <p className="text-muted text-sm">
            Live items and item groups synced from your company Zoho account
            {catalog?.syncedAt
              ? ` · Updated ${new Date(catalog.syncedAt).toLocaleString('en-IN')}`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={refreshing}
          onClick={() => void loadCatalog(true)}
        >
          <RefreshCw size={16} className={refreshing ? 'spin-icon' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="stats-grid stats-grid--4 mb-6">
        <div className="stat-card glass">
          <div className="stat-icon">
            <Package size={24} />
          </div>
          <div className="stat-content">
            <h3>Total items</h3>
            <div className="stat-value">{stats?.totalItems ?? 0}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon">
            <FolderTree size={24} />
          </div>
          <div className="stat-content">
            <h3>Item groups</h3>
            <div className="stat-value">{stats?.totalGroups ?? 0}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon">
            <Layers size={24} />
          </div>
          <div className="stat-content">
            <h3>Active items</h3>
            <div className="stat-value">{stats?.activeItems ?? 0}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon">
            <Boxes size={24} />
          </div>
          <div className="stat-content">
            <h3>Active groups</h3>
            <div className="stat-value">{stats?.activeGroups ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="products-controls panel glass mb-6">
        <div className="products-search input-icon-wrap">
          <Search size={18} className="input-icon" />
          <input
            type="search"
            className="input-field input-with-icon"
            placeholder="Search by name, SKU, type, or group…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>

        <div className="products-filters">
          <div className="products-tabs">
            {([
              ['all', 'All'],
              ['items', 'Items'],
              ['groups', 'Groups'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`products-tab ${tab === key ? 'active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="products-status-filters">
            {([
              ['all', 'All status'],
              ['active', 'Active'],
              ['inactive', 'Inactive'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`products-chip ${statusFilter === key ? 'active' : ''}`}
                onClick={() => setStatusFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showGroups && (
        <section className="products-section mb-6">
          <div className="products-section-header">
            <h3>Item groups</h3>
            <span className="text-muted text-sm">{filteredGroups.length} shown</span>
          </div>

          {filteredGroups.length === 0 ? (
            <div className="panel glass products-empty">
              <FolderTree size={32} className="placeholder-icon" />
              <p className="text-muted">No item groups match your filters.</p>
            </div>
          ) : (
            <div className="products-group-grid">
              {filteredGroups.map(group => {
                const expanded = expandedGroupId === group.id;
                return (
                  <article key={group.id} className="products-group-card glass">
                    <button
                      type="button"
                      className="products-group-card-header"
                      onClick={() => setExpandedGroupId(expanded ? null : group.id)}
                    >
                      <div className="products-group-icon">
                        <FolderTree size={22} />
                      </div>
                      <div className="products-group-meta">
                        <h4>{group.name}</h4>
                        <p className="text-muted text-sm">
                          {group.itemCount} variant{group.itemCount === 1 ? '' : 's'}
                          {group.unit ? ` · ${group.unit}` : ''}
                        </p>
                      </div>
                      <span className={`status-badge ${statusClass(group.status)}`}>
                        {group.status}
                      </span>
                    </button>

                    {group.description && (
                      <p className="products-group-description text-muted text-sm">{group.description}</p>
                    )}

                    {expanded && group.items.length > 0 && (
                      <div className="products-group-items">
                        {group.items.map(item => (
                          <div key={item.id} className="products-group-item">
                            <div>
                              <strong>{item.name}</strong>
                              <p className="text-muted text-sm">
                                {item.sku || 'No SKU'}
                                {item.type ? ` · ${item.type}` : ''}
                              </p>
                            </div>
                            <div className="products-group-item-price">
                              {formatCurrency(item.rate)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showItems && (
        <section className="products-section">
          <div className="products-section-header">
            <h3>Items</h3>
            <span className="text-muted text-sm">{filteredItems.length} shown</span>
          </div>

          <div className="panel glass panel--table">
            <div className="table-scroll-wrap">
              <table className="data-table products-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Type</th>
                    <th>Group</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-muted">
                        No items match your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map(item => (
                      <tr key={item.id}>
                        <td>
                          <div className="products-item-cell">
                            <span className="products-item-icon">
                              <Tag size={16} />
                            </span>
                            <div>
                              <strong>{item.name}</strong>
                              {item.description && (
                                <p className="text-muted text-sm products-item-desc">{item.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{item.sku || '—'}</td>
                        <td>{item.type || '—'}</td>
                        <td>{item.groupName || '—'}</td>
                        <td>{item.unit || '—'}</td>
                        <td>{formatCurrency(item.rate)}</td>
                        <td>
                          <span className={`status-badge ${statusClass(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
