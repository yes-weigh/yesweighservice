import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Briefcase,
  Download,
  RefreshCw,
  Search,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { MultiSelect } from '../../components/dealers/MultiSelect';
import { DealerStatusCell } from '../../components/dealers/DealerStatusCell';
import { DealerTile } from '../../components/dealers/DealerTile';
import { DealerStatusLegend } from '../../components/dealers/DealerStatusLegend';
import { useConfirm } from '../../context/ConfirmContext';
import { DEALER_STATUS_LEGEND } from '../../lib/dealerStatus';
import {
  dealerErrorMessage,
  exportDealersCsv,
  fetchDealerCategories,
  fetchDealerLocations,
  fetchDealers,
  fetchDealerStats,
  fetchKams,
  patchDealer,
  syncZohoCustomers,
} from '../../lib/dealers';
import { type DealerListParams, type Kam, type ZohoDealer } from '../../types/dealers';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const ZohoDealersPage: React.FC = () => {
  const confirm = useConfirm();

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [kamFilter, setKamFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [districtFilter, setDistrictFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState('contactName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [paginationOn, setPaginationOn] = useState(true);
  const limit = 25;

  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, blacklisted: 0, inactive: 0, unassignedKam: 0 });
  const [states, setStates] = useState<string[]>([]);
  const [districtsByState, setDistrictsByState] = useState<Record<string, string[]>>({});
  const [kams, setKams] = useState<Kam[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const queryParams = useMemo((): DealerListParams => ({
    page: paginationOn ? page : 1,
    limit: paginationOn ? limit : 99999,
    status: 'all',
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(kamFilter.length ? { kamId: kamFilter.join(',') } : {}),
    ...(statusFilter.length ? { dealerStatus: statusFilter.join(',') } : {}),
    ...(stateFilter.length ? { billingState: stateFilter.join(',') } : {}),
    ...(districtFilter.length ? { district: districtFilter.join(',') } : {}),
    ...(categoryFilter.length ? { categories: categoryFilter.join(',') } : {}),
    sortField,
    sortDir,
  }), [
    paginationOn, page, debouncedSearch, kamFilter, statusFilter, stateFilter,
    districtFilter, categoryFilter, sortField, sortDir,
  ]);

  const districts = useMemo(() => {
    if (!stateFilter.length) {
      return Array.from(new Set(Object.values(districtsByState).flat())).sort();
    }
    return stateFilter.flatMap(s => districtsByState[s] ?? []);
  }, [districtsByState, stateFilter]);

  const loadMeta = useCallback(async () => {
    try {
      const [statsRes, locRes, kamsRes, catsRes] = await Promise.all([
        fetchDealerStats(),
        fetchDealerLocations(),
        fetchKams(),
        fetchDealerCategories(),
      ]);
      setStats(statsRes);
      setStates(locRes.states);
      setDistrictsByState(locRes.districtsByState);
      setKams(kamsRes);
      setCategories(catsRes);
    } catch (err) {
      console.error('Dealer meta load failed:', err);
      setError(dealerErrorMessage(err));
    }
  }, []);

  const loadDealers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchDealers(queryParams);
      setDealers(res.data);
      setTotal(res.pagination.total);
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadDealers();
  }, [loadDealers]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [debouncedSearch, statusFilter, kamFilter, stateFilter, districtFilter, categoryFilter]);

  useEffect(() => {
    setDistrictFilter([]);
  }, [stateFilter]);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setSuccess('');
    try {
      const count = await syncZohoCustomers();
      await loadMeta();
      await loadDealers();
      if (count === 0) {
        setError('Sync finished but Zoho returned 0 customers. Check Zoho Inventory contacts and API scopes.');
      } else {
        setSuccess(`Synced ${count} dealers from Zoho. Visible rows exclude filtered/blacklisted entries.`);
      }
    } catch (err) {
      console.error('Zoho dealer sync failed:', err);
      setError(dealerErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    try {
      const csv = await exportDealersCsv(queryParams);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dealers_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(dealerErrorMessage(err));
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleBulkDeactivate = async () => {
    const ok = await confirm({
      title: 'Blacklist dealers?',
      message: `Mark ${selectedIds.size} dealers as blacklisted and filtered?`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    await Promise.all(
      Array.from(selectedIds).map(id =>
        patchDealer(id, {
          isFiltered: true,
          filterReason: 'Manual',
          dealerStage: 'Black listed',
        }),
      ),
    );
    setSelectedIds(new Set());
    await loadDealers();
    await loadMeta();
  };

  const handleBulkKam = async (kamId: string) => {
    await Promise.all(
      Array.from(selectedIds).map(id => patchDealer(id, { kamId })),
    );
    setSelectedIds(new Set());
    await loadDealers();
  };

  const updateField = async (id: string, patch: Partial<ZohoDealer>) => {
    await patchDealer(id, patch);
    await loadDealers();
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(dealers.map(d => d.id)) : new Set());
  };

  const toggleRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SortMark = ({ field }: { field: string }) => (
    <span className="dealers-sort-mark">{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const renderPaginationBar = (position: 'top' | 'bottom') => (
    <div
      className={`dealers-pagination dealers-pagination--inset dealers-pagination--${position}`}
      aria-label={position === 'top' ? 'Table pagination' : 'Table pagination footer'}
    >
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          setPage(1);
          setPaginationOn(v => !v);
        }}
      >
        {paginationOn ? 'Pagination on' : 'Show all'}
      </button>

      {paginationOn ? (
        <>
          <span className="dealers-pagination__info text-muted text-sm">
            {total > 0
              ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`
              : 'No dealers'}
          </span>
          <div className="dealers-pagination__btns">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </button>
            <span className="dealers-pagination__page text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <span className="dealers-pagination__info text-muted text-sm">
          {total > 0 ? `Showing all ${total} dealers` : 'No dealers'}
        </span>
      )}
    </div>
  );

  return (
    <div className="page-content fade-in dealers-page">
      {success && (
        <div className="products-inline-error panel glass" style={{ borderColor: 'rgba(16,185,129,0.35)', color: '#6ee7b7' }}>
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="products-inline-error panel glass">
          <span>{error}</span>
        </div>
      )}

      <div className="dealers-kpis stats-grid stats-grid--5">
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => { setStatusFilter([]); setKamFilter([]); }}>
          <Users size={18} />
          <div><h3>Total</h3><p className="stat-value">{stats.total}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setStatusFilter(['active-yes', 'active-no'])}>
          <UserCheck size={18} />
          <div><h3>Active</h3><p className="stat-value">{stats.active}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setStatusFilter(['non-active-yes', 'non-active-no'])}>
          <UserX size={18} />
          <div><h3>Non Active</h3><p className="stat-value">{stats.inactive}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setStatusFilter(['blacklisted-yes', 'blacklisted-no'])}>
          <Ban size={18} />
          <div><h3>Blacklisted</h3><p className="stat-value">{stats.blacklisted}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setKamFilter(['unassigned'])}>
          <Briefcase size={18} />
          <div><h3>Unassigned KAM</h3><p className="stat-value">{stats.unassignedKam}</p></div>
        </button>
      </div>

      <div className="dealers-toolbar panel glass">
        <div className="dealers-toolbar__row">
          <div className="catalog-search dealers-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="Search by name or company…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="dealers-toolbar__actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={syncing} onClick={() => void handleSync()}>
              <RefreshCw size={15} className={syncing ? 'spin-icon' : undefined} />
              {syncing ? 'Syncing…' : 'Sync from Zoho'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleExport()}>
              <Download size={15} /> Export CSV
            </button>
          </div>
        </div>
        <div className="dealers-filters">
          <MultiSelect
            placeholder="KAM"
            value={kamFilter}
            onChange={setKamFilter}
            options={[
              { value: 'unassigned', label: 'Unassigned' },
              ...kams.map(k => ({ value: k.id, label: k.name })),
            ]}
          />
          <MultiSelect
            placeholder="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={DEALER_STATUS_LEGEND.map(item => ({ value: item.key, label: item.symbol }))}
          />
          <MultiSelect
            placeholder="State"
            value={stateFilter}
            onChange={setStateFilter}
            options={states.map(s => ({ value: s, label: s }))}
          />
          <MultiSelect
            placeholder="District"
            value={districtFilter}
            onChange={setDistrictFilter}
            options={districts.map(d => ({ value: d, label: d }))}
          />
          <MultiSelect
            placeholder="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categories.map(c => ({ value: c, label: c }))}
          />
        </div>
      </div>

      <DealerStatusLegend />

      <div className="dealers-table-panel panel glass">
        {renderPaginationBar('top')}
        <div className="dealers-table-wrap dealers-table-wrap--desktop">
        <table className="dealers-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={dealers.length > 0 && selectedIds.size === dealers.length}
                  onChange={e => toggleSelectAll(e.target.checked)}
                />
              </th>
              <th>#</th>
              <th><button type="button" onClick={() => handleSort('contactName')}>Dealer <SortMark field="contactName" /></button></th>
              <th><button type="button" onClick={() => handleSort('firstName')}>Contact <SortMark field="firstName" /></button></th>
              <th><button type="button" onClick={() => handleSort('phone')}>Phone <SortMark field="phone" /></button></th>
              <th>KAM</th>
              <th><button type="button" onClick={() => handleSort('billingState')}>State <SortMark field="billingState" /></button></th>
              <th><button type="button" onClick={() => handleSort('district')}>District <SortMark field="district" /></button></th>
              <th>Categories</th>
              <th><button type="button" onClick={() => handleSort('dealerStage')}>Status <SortMark field="dealerStage" /></button></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="dealers-table__empty">Loading dealers…</td></tr>
            ) : dealers.length === 0 ? (
              <tr><td colSpan={10} className="dealers-table__empty">No dealers found. Sync from Zoho to get started.</td></tr>
            ) : (
              dealers.map((dealer, idx) => (
                <tr key={dealer.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(dealer.id)}
                      onChange={() => toggleRow(dealer.id)}
                      aria-label={`Select ${dealer.contactName}`}
                    />
                  </td>
                  <td>{paginationOn ? (page - 1) * limit + idx + 1 : idx + 1}</td>
                  <td>{dealer.companyName || dealer.contactName}</td>
                  <td>{dealer.firstName || '—'}</td>
                  <td>{dealer.phone || dealer.mobile || '—'}</td>
                  <td>
                    <select
                      className="catalog-select dealers-inline-select"
                      value={dealer.kamId ?? ''}
                      onChange={e => void updateField(dealer.id, { kamId: e.target.value || null })}
                      aria-label="KAM"
                    >
                      <option value="">Unassigned</option>
                      {kams.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                  </td>
                  <td>{dealer.billingState || '—'}</td>
                  <td>{dealer.district || '—'}</td>
                  <td>
                    <select
                      className="catalog-select dealers-inline-select"
                      value={dealer.categories[0] ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        void updateField(dealer.id, { categories: val ? [val] : [] });
                      }}
                      aria-label="Category"
                    >
                      <option value="">—</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <DealerStatusCell
                      dealer={dealer}
                      onStageChange={stage => void updateField(dealer.id, { dealerStage: stage })}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        <div className="dealers-tiles dealers-tiles--mobile" aria-label="Dealer list">
          {loading ? (
            <p className="dealers-tiles__empty">Loading dealers…</p>
          ) : dealers.length === 0 ? (
            <p className="dealers-tiles__empty">No dealers found. Sync from Zoho to get started.</p>
          ) : (
            dealers.map((dealer, idx) => (
              <DealerTile
                key={dealer.id}
                dealer={dealer}
                index={paginationOn ? (page - 1) * limit + idx + 1 : idx + 1}
                selected={selectedIds.has(dealer.id)}
                onToggle={() => toggleRow(dealer.id)}
                kams={kams}
                categories={categories}
                onUpdate={patch => void updateField(dealer.id, patch)}
              />
            ))
          )}
        </div>

        {renderPaginationBar('bottom')}
      </div>

      {selectedIds.size > 0 && (
        <div className="dealers-bulk-bar panel glass">
          <span>{selectedIds.size} selected</span>
          <select
            className="catalog-select"
            defaultValue=""
            aria-label="Assign KAM"
            onChange={e => {
              if (e.target.value) {
                void handleBulkKam(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="" disabled>Assign KAM…</option>
            {kams.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => void handleBulkDeactivate()}>
            <Ban size={14} /> Blacklist
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}

    </div>
  );
};
