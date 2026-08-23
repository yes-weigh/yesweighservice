import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  Clock,
  Download,
  LayoutGrid,
  LayoutList,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { CreateDealerModal } from '../../components/dealers/CreateDealerModal';
import { MultiSelect } from '../../components/dealers/MultiSelect';
import { FetchingLoader } from '../../components/FetchingLoader';
import { DealerTile } from '../../components/dealers/DealerTile';
import { DealerStatusLegend } from '../../components/dealers/DealerStatusLegend';
import { DealerLevelDefinitionsPanel } from '../../components/dealers/DealerLevelDefinitionsPanel';
import { ZohoSalespersonsPanel } from '../../components/dealers/ZohoSalespersonsPanel';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import { DEALER_STATUS_LEGEND } from '../../lib/dealerStatus';
import {
  dealerContactPhone,
  dealerErrorMessage,
  exportDealersCsv,
  fetchDealerCategories,
  fetchDealerLocations,
  fetchDealerStats,
  fetchDealers,
  listAssignableDealerStaff,
  dealerStaffSelectOptions,
  patchDealer,
  syncZohoCustomers,
} from '../../lib/dealers';
import { type AssignableStaffOption, type DealerListParams, type DealerStats, type ZohoDealer } from '../../types/dealers';
import { homePathForRole, type Role } from '../../types';
import { canViewDealersInHr, hasStaffPermission } from '../../lib/staffAccess';

type DealersMainTab = 'roster' | 'salespersons' | 'dealer-level';

function parseDealersTab(value: string | null): DealersMainTab {
  if (value === 'salespersons' || value === 'dealer-level') return value;
  // Legacy query from when levels lived under Products.
  if (value === 'price-levels') return 'dealer-level';
  return 'roster';
}

function dealersListBase(role: Role): string {
  return `${homePathForRole(role)}/dealers`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function ZohoDealersPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const dealersBase = user ? dealersListBase(user.role) : '/staff/dealers';
  const canSyncDealers = hasStaffPermission(user, 'dealers.sync');
  const canEditDealers = hasStaffPermission(user, 'dealers.edit');
  const canManageDealerLevels = canViewDealersInHr(user);
  const tabParam = searchParams.get('tab');
  const mainTab = parseDealersTab(tabParam);
  const setMainTab = (tab: DealersMainTab) => {
    if (tab !== 'roster') setFiltersOpen(false);
    if (tab === 'roster') {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ tab }, { replace: true });
  };

  /** Normalize legacy ?tab=price-levels → dealer-level. */
  useEffect(() => {
    if (tabParam !== 'price-levels') return;
    setSearchParams({ tab: 'dealer-level' }, { replace: true });
  }, [tabParam, setSearchParams]);

  useEffect(() => {
    if (mainTab !== 'dealer-level' || canManageDealerLevels) return;
    setSearchParams({}, { replace: true });
  }, [mainTab, canManageDealerLevels, setSearchParams]);

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [staffFilter, setStaffFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [districtFilter, setDistrictFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState('contactName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [paginationOn, setPaginationOn] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768,
  );
  const limit = 25;
  const effectivePaginationOn = isMobileViewport ? true : paginationOn;

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [districtsByState, setDistrictsByState] = useState<Record<string, string[]>>({});
  const [assignableStaff, setAssignableStaff] = useState<AssignableStaffOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [stats, setStats] = useState<DealerStats | null>(null);

  const queryParams = useMemo((): DealerListParams => ({
    page: effectivePaginationOn ? page : 1,
    limit: effectivePaginationOn ? limit : 99999,
    status: 'all',
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(staffFilter.length ? { assignedStaffUid: staffFilter.join(',') } : {}),
    ...(statusFilter.length ? { dealerStatus: statusFilter.join(',') } : {}),
    ...(stateFilter.length ? { billingState: stateFilter.join(',') } : {}),
    ...(districtFilter.length ? { district: districtFilter.join(',') } : {}),
    ...(categoryFilter.length ? { categories: categoryFilter.join(',') } : {}),
    sortField,
    sortDir,
  }), [
    effectivePaginationOn, page, debouncedSearch, staffFilter, statusFilter, stateFilter,
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
      const [locRes, staffRes, catsRes, statsRes] = await Promise.all([
        fetchDealerLocations(),
        listAssignableDealerStaff(),
        fetchDealerCategories(),
        fetchDealerStats().catch(() => null),
      ]);
      setStates(locRes.states);
      setDistrictsByState(locRes.districtsByState);
      setAssignableStaff(staffRes);
      setCategories(catsRes);
      if (statsRes) setStats(statsRes);
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
  }, [debouncedSearch, statusFilter, staffFilter, stateFilter, districtFilter, categoryFilter]);

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

  const handleBulkAssignStaff = async (assignedStaffUid: string) => {
    await Promise.all(
      Array.from(selectedIds).map(id => patchDealer(id, {
        assignedStaffUid: assignedStaffUid || null,
      })),
    );
    setSelectedIds(new Set());
    await loadDealers();
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const activeFilterCount = [
    staffFilter,
    statusFilter,
    stateFilter,
    districtFilter,
    categoryFilter,
  ].filter(f => f.length > 0).length;

  const resetDealerFilters = () => {
    setStaffFilter([]);
    setStatusFilter([]);
    setStateFilter([]);
    setDistrictFilter([]);
    setCategoryFilter([]);
    setMainTab('roster');
  };

  const applyStatusPreset = (keys: string[]) => {
    setStatusFilter(keys);
    setPage(1);
  };

  const statusPreset = statusFilter.slice().sort().join(',');
  const kpiActive = (keys: string[]) => statusPreset === keys.slice().sort().join(',');

  const filterBadgeCount = activeFilterCount + (mainTab === 'roster' ? 0 : 1);

  const dealerFilterFields = (
    <div className="dealers-filters">
      <MultiSelect
        placeholder="Assigned staff"
        value={staffFilter}
        onChange={setStaffFilter}
        options={[
          { value: 'unassigned', label: 'Unassigned' },
          ...assignableStaff.map(s => ({ value: s.uid, label: s.displayName })),
        ]}
      />
      <MultiSelect
        placeholder="Status"
        value={statusFilter}
        onChange={setStatusFilter}
        options={DEALER_STATUS_LEGEND.map(item => ({ value: item.key, label: item.symbol }))}
      />
      <MultiSelect
        className="dealers-filter--state"
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
  );

  const headerFilter = useMemo(
    () => (
      <button
        type="button"
        className={[
          'catalog-header-filter-btn',
          'dealers-header-filter',
          filtersOpen ? 'catalog-header-filter-btn--open' : '',
          filterBadgeCount > 0 ? 'catalog-header-filter-btn--active' : '',
        ].filter(Boolean).join(' ')}
        aria-label={filterBadgeCount > 0 ? `Filters (${filterBadgeCount} active)` : 'Filters'}
        title="Filters"
        aria-expanded={filtersOpen}
        aria-haspopup="dialog"
        onClick={() => setFiltersOpen(open => !open)}
      >
        <SlidersHorizontal size={18} aria-hidden />
        {filterBadgeCount > 0 ? (
          <span className="support-request-list__filter-pill">{filterBadgeCount}</span>
        ) : null}
      </button>
    ),
    [filterBadgeCount, filtersOpen],
  );

  const headerTools = useMemo(
    () => (
      <div className="dealers-header-tools invoices-header-tools">
        {canEditDealers ? (
          <button
            type="button"
            className="catalog-header-filter-btn create-po-header-btn dealers-add-btn"
            onClick={() => setCreateOpen(true)}
            aria-label="Add dealer"
            title="Add dealer"
          >
            <Plus size={20} strokeWidth={2.5} />
            <span className="dealers-add-btn__label">Add Dealer</span>
          </button>
        ) : null}
        {mainTab === 'roster' ? (
          <div className="catalog-search dealers-search invoices-header-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Search dealers…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              aria-label="Search dealers"
            />
          </div>
        ) : null}
        {headerFilter}
      </div>
    ),
    [canEditDealers, headerFilter, mainTab, searchTerm],
  );

  useCatalogPageHeader({
    title: isMobileViewport ? null : 'Dealer List',
    subtitle: isMobileViewport || total <= 0 ? null : `${total.toLocaleString('en-IN')} Dealers`,
    mobileCompactHeader: isMobileViewport,
  }, true);
  usePageHeaderSlot(headerTools);

  const renderPaginationBar = (position: 'top' | 'bottom') => (
    <div
      className={`dealers-pagination dealers-pagination--inset dealers-pagination--${position}`}
      aria-label={position === 'top' ? 'Table pagination' : 'Table pagination footer'}
    >
      {!isMobileViewport && (
        <button
          type="button"
          className="btn btn-secondary btn-sm dealers-pagination__mode-toggle"
          onClick={() => {
            setPage(1);
            setPaginationOn(v => !v);
          }}
        >
          {paginationOn ? 'Pagination on' : 'Show all'}
        </button>
      )}

      {effectivePaginationOn ? (
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
      {filtersOpen ? (
        <>
          <button
            type="button"
            className="support-filter-sheet__backdrop"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          />
          <div
            className="support-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filter dealers"
          >
            <header className="support-filter-sheet__header">
              <h3 className="support-filter-sheet__title">Filters</h3>
              <div className="support-filter-sheet__header-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm support-filter-sheet__reset"
                  onClick={resetDealerFilters}
                  disabled={filterBadgeCount === 0}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="support-filter-sheet__close"
                  aria-label="Close"
                  onClick={() => setFiltersOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <section className="support-filter-sheet__section">
              <h4 className="support-filter-sheet__section-title">View</h4>
              <div className="support-filter-sheet__options">
                <button
                  type="button"
                  className={`support-filter-sheet__option${mainTab === 'roster' ? ' is-active' : ''}`}
                  onClick={() => setMainTab('roster')}
                >
                  Dealer
                </button>
                <button
                  type="button"
                  className={`support-filter-sheet__option${mainTab === 'salespersons' ? ' is-active' : ''}`}
                  onClick={() => setMainTab('salespersons')}
                >
                  Salesperson
                </button>
                {canManageDealerLevels ? (
                  <button
                    type="button"
                    className={`support-filter-sheet__option${mainTab === 'dealer-level' ? ' is-active' : ''}`}
                    onClick={() => setMainTab('dealer-level')}
                  >
                    Dealer level
                  </button>
                ) : null}
              </div>
            </section>

            {mainTab === 'roster' ? dealerFilterFields : null}
          </div>
        </>
      ) : null}

      {mainTab === 'salespersons' ? (
        <ZohoSalespersonsPanel />
      ) : mainTab === 'dealer-level' && canManageDealerLevels ? (
        <DealerLevelDefinitionsPanel />
      ) : (
      <>
      {success && (
        <div className="products-inline-error dealers-page__notice is-success" style={{ borderColor: 'rgba(16,185,129,0.35)', color: '#6ee7b7' }}>
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="products-inline-error dealers-page__notice">
          <span>{error}</span>
        </div>
      )}

      <div className="dealers-toolbar">
        <div className="dealers-toolbar__row">
          <div className="dealers-toolbar__actions">
            {canSyncDealers && (
              <button type="button" className="btn btn-primary btn-sm zoho-sync-btn" disabled={syncing} onClick={() => void handleSync()}>
                <RefreshCw size={15} className={syncing ? 'spin-icon' : undefined} />
                <span className="dealers-toolbar__btn-label">{syncing ? 'Syncing…' : 'Sync from Zoho'}</span>
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleExport()}>
              <Download size={15} />
              <span className="dealers-toolbar__btn-label">Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      <div className="dealers-kpis dealers-kpis--roster" role="group" aria-label="Dealer counts">
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster${statusFilter.length === 0 ? ' is-active' : ''}`}
          onClick={() => applyStatusPreset([])}
        >
          <Users size={16} />
          <div>
            <h3>Total Dealers</h3>
            <div className="stat-value">{(stats?.total ?? total).toLocaleString('en-IN')}</div>
          </div>
        </button>
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster dealers-kpi--active${kpiActive(['active-yes', 'active-no']) ? ' is-active' : ''}`}
          onClick={() => applyStatusPreset(['active-yes', 'active-no'])}
        >
          <UserCheck size={16} />
          <div>
            <h3>Active Dealers</h3>
            <div className="stat-value">{(stats?.active ?? 0).toLocaleString('en-IN')}</div>
          </div>
        </button>
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster dealers-kpi--inactive${kpiActive(['non-active-yes', 'non-active-no']) ? ' is-active' : ''}`}
          onClick={() => applyStatusPreset(['non-active-yes', 'non-active-no'])}
        >
          <Clock size={16} />
          <div>
            <h3>Inactive Dealers</h3>
            <div className="stat-value">{(stats?.nonActive ?? 0).toLocaleString('en-IN')}</div>
          </div>
        </button>
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster dealers-kpi--blacklisted${kpiActive(['blacklisted-yes', 'blacklisted-no']) ? ' is-active' : ''}`}
          onClick={() => applyStatusPreset(['blacklisted-yes', 'blacklisted-no'])}
        >
          <Ban size={16} />
          <div>
            <h3>Blacklisted</h3>
            <div className="stat-value">{(stats?.blacklisted ?? 0).toLocaleString('en-IN')}</div>
          </div>
        </button>
      </div>

      <div className="dealers-roster-bar">
        <label className="dealers-sort">
          Sort by:
          <select
            value={sortField}
            onChange={e => {
              setSortField(e.target.value);
              setSortDir('asc');
              setPage(1);
            }}
            aria-label="Sort dealers"
          >
            <option value="contactName">Dealer name</option>
            <option value="firstName">Contact</option>
            <option value="billingState">State</option>
            <option value="district">District</option>
            <option value="dealerStage">Status</option>
          </select>
        </label>
        <div className="dealers-view-toggle">
          <span className="dealers-view-toggle__label">View:</span>
          <button
            type="button"
            className={`dealers-view-toggle__btn${viewMode === 'list' ? ' is-active' : ''}`}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
          >
            <LayoutList size={16} />
          </button>
          <button
            type="button"
            className={`dealers-view-toggle__btn${viewMode === 'grid' ? ' is-active' : ''}`}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      <div className="dealers-table-panel">
        <div
          className={`dealers-roster${viewMode === 'grid' ? ' dealers-roster--grid' : ''}`}
          aria-label="Dealer list"
        >
          {loading ? (
            <FetchingLoader label="Fetching dealers" className="dealers-tiles__loading" />
          ) : dealers.length === 0 ? (
            <p className="dealers-tiles__empty">No dealers found. Sync from Zoho to get started.</p>
          ) : (
            dealers.map(dealer => (
              <DealerTile
                key={dealer.id}
                dealer={dealer}
                onOpen={() => navigate(`${dealersBase}/${dealer.id}`, { state: { dealer } })}
              />
            ))
          )}
        </div>

        {renderPaginationBar('bottom')}
      </div>

      <DealerStatusLegend />

      {selectedIds.size > 0 && canEditDealers && (
        <div className="dealers-bulk-bar panel glass">
          <span>{selectedIds.size} selected</span>
          <select
            className="catalog-select"
            defaultValue=""
            aria-label="Assign staff"
            onChange={e => {
              if (e.target.value) {
                const uid = e.target.value === '__unassigned__' ? '' : e.target.value;
                void handleBulkAssignStaff(uid);
                e.target.value = '';
              }
            }}
          >
            <option value="" disabled>Assign staff…</option>
            <option value="__unassigned__">Unassigned</option>
            {assignableStaff.map(s => (
              <option key={s.uid} value={s.uid}>{s.displayName}</option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => void handleBulkDeactivate()}>
            <Ban size={14} /> Blacklist
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}
      </>
      )}

      {createOpen && canEditDealers ? (
        <CreateDealerModal
          onClose={() => setCreateOpen(false)}
          onCreated={dealer => {
            setCreateOpen(false);
            navigate(`${dealersBase}/${dealer.id}`, { state: { dealer } });
          }}
        />
      ) : null}

    </div>
  );
}

export default ZohoDealersPage;
