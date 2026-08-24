import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  Clock,
  Download,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { CreateDealerModal } from '../../components/dealers/CreateDealerModal';
import { DealerTile } from '../../components/dealers/DealerTile';
import { DealerStatusLegend } from '../../components/dealers/DealerStatusLegend';
import { MultiSelect } from '../../components/dealers/MultiSelect';
import { ZohoSalespersonsPanel } from '../../components/dealers/ZohoSalespersonsPanel';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  dealerErrorMessage,
  exportDealersCsv,
  listAssignableDealerStaff,
  patchDealer,
  syncZohoCustomers,
} from '../../lib/dealers';
import {
  clearDealerCache,
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../lib/dealer-cache';
import {
  findPriceLevelForDealer,
  isDefaultDealerPriceLevel,
  subscribePriceLevels,
} from '../../lib/priceLevels';
import {
  computeDealerLocations,
  computeDealerStats,
  filterDealerRoster,
  paginateDealers,
  sortDealers,
} from '../../lib/dealerRosterQuery';
import { type AssignableStaffOption, type DealerListParams, type ZohoDealer } from '../../types/dealers';
import type { PriceLevel } from '../../types/priceLevels';
import { homePathForRole, type Role } from '../../types';
import { isHiddenKamName } from '../../lib/dealerKamDisplay';
import { hasStaffPermission } from '../../lib/staffAccess';

type DealersMainTab = 'roster' | 'salespersons';

function parseDealersTab(value: string | null): DealersMainTab {
  if (value === 'salespersons') return value;
  return 'roster';
}

function dealersListBase(role: Role): string {
  return `${homePathForRole(role)}/dealers`;
}

type FilterChip = { value: string; label: string };

function slugifyFilterId(label: string) {
  return `dealers-filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterChip[];
  onChange: (next: string) => void;
}) {
  const id = slugifyFilterId(label);
  return (
    <section className="support-filter-sheet__section dealers-filter-field">
      <select
        id={id}
        aria-label={label}
        className={`catalog-select dealers-filter-select${value ? ' is-selected' : ''}`}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(option => (
          <option key={option.value || 'all'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </section>
  );
}

function FilterMultiDropdown({
  label,
  values,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  options: FilterChip[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  return (
    <section className="support-filter-sheet__section dealers-filter-field" aria-label={label}>
      {options.length === 0 ? (
        <p className="dealers-filter-empty">No options yet</p>
      ) : (
        <MultiSelect
          className="dealers-filter-multiselect"
          options={options}
          value={values}
          onChange={onChange}
          placeholder={placeholder}
          variant="summary"
        />
      )}
    </section>
  );
}


const ZOHO_STATUS_CHIPS: FilterChip[] = [
  { value: '', label: 'All Zoho Status' },
  { value: 'Active', label: 'Active' },
  { value: 'Non Active', label: 'Inactive' },
  { value: 'Black listed', label: 'Blacklisted' },
];

const APP_STATUS_CHIPS: FilterChip[] = [
  { value: '', label: 'All App status' },
  { value: 'logged-in', label: 'Logged in' },
  { value: 'not-logged-in', label: 'Not logged in' },
];

const ASSIGNMENT_CHIPS: FilterChip[] = [
  { value: '', label: 'Assigned+Unassigned' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned' },
];

const PRICE_LEVEL_FILTER_OPTIONS: FilterChip[] = [
  { value: '', label: 'All Price level' },
  { value: 'directors', label: 'Directors' },
  { value: 'dealers', label: 'Dealers' },
  { value: 'subdealer', label: 'Subdealer' },
  { value: 'reseller', label: 'Reseller' },
  { value: 'spareonly', label: 'Spareonly' },
];

type DealerFilters = {
  zohoStatus: string;
  appStatus: string;
  assignment: string;
  staffFilter: string[];
  stateFilter: string[];
  districtFilter: string[];
  priceLevelFilter: string;
};

function emptyDealerFilters(): DealerFilters {
  return {
    zohoStatus: '',
    appStatus: '',
    assignment: '',
    staffFilter: [],
    stateFilter: [],
    districtFilter: [],
    priceLevelFilter: '',
  };
}

function compactPriceLevelName(name: string) {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function rosterPriceLevelKey(level: PriceLevel | null): string {
  if (!level || isDefaultDealerPriceLevel(level)) return 'dealers';
  const compact = compactPriceLevelName(level.name);
  if (compact === 'directors') return 'directors';
  if (compact === 'subdealer' || compact === 'subdealers') return 'subdealer';
  if (compact === 'reseller' || compact === 'resellers') return 'reseller';
  if (compact === 'spareonly' || compact === 'sparesonly') return 'spareonly';
  return compact;
}

export function ZohoDealersPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const dealersBase = user ? dealersListBase(user.role) : '/staff/dealers';
  const canSyncDealers = hasStaffPermission(user, 'dealers.sync');
  const canEditDealers = hasStaffPermission(user, 'dealers.edit');
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

  useEffect(() => {
    if (tabParam !== 'dealer-level' && tabParam !== 'price-levels') return;
    const settingsHome = user?.role === 'staff' ? '/staff' : '/super-admin';
    navigate(`${settingsHome}/settings/price-level`, { replace: true });
  }, [tabParam, navigate, user?.role]);

  const [searchTerm, setSearchTerm] = useState('');
  const [zohoStatus, setZohoStatus] = useState('');
  const [appStatus, setAppStatus] = useState('');
  const [assignment, setAssignment] = useState('');
  const [staffFilter, setStaffFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [districtFilter, setDistrictFilter] = useState<string[]>([]);
  const [priceLevelFilter, setPriceLevelFilter] = useState('');
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>([]);
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

  const [roster, setRoster] = useState<ZohoDealer[]>(() => peekCachedDealers() ?? []);
  const [rosterReady, setRosterReady] = useState(() => Boolean(peekCachedDealers()?.length));
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [assignableStaff, setAssignableStaff] = useState<AssignableStaffOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<DealerFilters>(emptyDealerFilters);
  const [createOpen, setCreateOpen] = useState(false);

  const queryParams = useMemo((): DealerListParams => ({
    page: effectivePaginationOn ? page : 1,
    limit: effectivePaginationOn ? limit : 99999,
    status: 'all',
    ...(searchTerm.trim() ? { q: searchTerm.trim() } : {}),
    ...(assignment === 'assigned' || assignment === 'unassigned' ? { assignment } : {}),
    ...(assignment !== 'unassigned' && staffFilter.length
      ? { assignedStaffUid: staffFilter.join(',') }
      : {}),
    ...(zohoStatus ? { dealerStage: zohoStatus } : {}),
    ...(appStatus === 'logged-in' ? { signedIn: 'true' as const } : {}),
    ...(appStatus === 'not-logged-in' ? { signedIn: 'false' as const } : {}),
    ...(stateFilter.length ? { billingState: stateFilter.join(',') } : {}),
    ...(districtFilter.length ? { district: districtFilter.join(',') } : {}),
    sortField: 'contactName',
    sortDir: 'asc',
  }), [
    effectivePaginationOn, page, searchTerm, assignment, staffFilter, zohoStatus,
    appStatus, stateFilter, districtFilter,
  ]);

  const stats = useMemo(() => computeDealerStats(roster), [roster]);
  const locations = useMemo(() => computeDealerLocations(roster), [roster]);
  const states = locations.states;
  const districtsByState = locations.districtsByState;

  const filteredDealers = useMemo(() => {
    const list = sortDealers(filterDealerRoster(roster, queryParams), 'contactName', 'asc');
    if (!priceLevelFilter) return list;
    return list.filter(dealer => (
      rosterPriceLevelKey(findPriceLevelForDealer(priceLevels, dealer.id)) === priceLevelFilter
    ));
  }, [roster, queryParams, priceLevelFilter, priceLevels]);
  const paged = useMemo(
    () => paginateDealers(
      filteredDealers,
      effectivePaginationOn ? page : 1,
      effectivePaginationOn ? limit : 99999,
    ),
    [filteredDealers, effectivePaginationOn, page],
  );
  const dealers = paged.data;
  const total = paged.pagination.total;
  const loading = !rosterReady && roster.length === 0;

  const loadMeta = useCallback(async () => {
    try {
      setAssignableStaff(await listAssignableDealerStaff());
    } catch (err) {
      console.error('Dealer meta load failed:', err);
      setError(dealerErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => subscribePriceLevels(docData => setPriceLevels(docData.levels)), []);

  useEffect(() => {
    const hidden = new Set(
      assignableStaff.filter(staff => isHiddenKamName(staff.displayName)).map(staff => staff.uid),
    );
    if (!hidden.size) return;
    setStaffFilter(prev => {
      const next = prev.filter(uid => !hidden.has(uid));
      return next.length === prev.length ? prev : next;
    });
  }, [assignableStaff]);

  useEffect(() => {
    const unsub = subscribeDealerCache((dealers, complete) => {
      setRoster(dealers);
      if (dealers.length || complete) setRosterReady(true);
    });
    void ensureDealersCached()
      .catch(err => setError(dealerErrorMessage(err)))
      .finally(() => setRosterReady(true));
    return unsub;
  }, []);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [searchTerm, zohoStatus, appStatus, assignment, staffFilter, stateFilter, districtFilter, priceLevelFilter]);

  const snapshotDealerFilters = (): DealerFilters => ({
    zohoStatus,
    appStatus,
    assignment,
    staffFilter,
    stateFilter,
    districtFilter,
    priceLevelFilter,
  });

  const applyDealerFilters = (next: DealerFilters) => {
    setZohoStatus(next.zohoStatus);
    setAppStatus(next.appStatus);
    setAssignment(next.assignment);
    setStaffFilter(next.staffFilter);
    setStateFilter(next.stateFilter);
    setDistrictFilter(next.districtFilter);
    setPriceLevelFilter(next.priceLevelFilter);
  };

  const openDealerFilters = () => {
    setFilterDraft(snapshotDealerFilters());
    setFiltersOpen(true);
  };

  const handleDraftStateChange = (next: string[]) => {
    setFilterDraft(prev => {
      if (!next.length) return { ...prev, stateFilter: [], districtFilter: [] };
      const allowed = new Set(next.flatMap(state => districtsByState[state] ?? []));
      return {
        ...prev,
        stateFilter: next,
        districtFilter: prev.districtFilter.filter(district => allowed.has(district)),
      };
    });
  };

  const handleDraftAssignmentChange = (next: string) => {
    setFilterDraft(prev => ({
      ...prev,
      assignment: next,
      staffFilter: next === 'unassigned' ? [] : prev.staffFilter,
    }));
  };

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setSuccess('');
    try {
      const count = await syncZohoCustomers();
      clearDealerCache();
      await ensureDealersCached({ force: true });
      await loadMeta();
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
    await ensureDealersCached({ force: true });
    await loadMeta();
  };

  const handleBulkAssignStaff = async (assignedStaffUid: string) => {
    await Promise.all(
      Array.from(selectedIds).map(id => patchDealer(id, {
        assignedStaffUid: assignedStaffUid || null,
      })),
    );
    setSelectedIds(new Set());
    await ensureDealersCached({ force: true });
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const activeFilterCount = [
    zohoStatus,
    appStatus,
    assignment,
    staffFilter.length ? 'kam' : '',
    stateFilter.length ? 'state' : '',
    districtFilter.length ? 'district' : '',
    priceLevelFilter,
  ].filter(Boolean).length;

  const resetDealerFilters = () => {
    const next = emptyDealerFilters();
    setFilterDraft(next);
    applyDealerFilters(next);
    setMainTab('roster');
  };

  const applyDraftDealerFilters = () => {
    applyDealerFilters(filterDraft);
    setMainTab('roster');
    setFiltersOpen(false);
  };

  const applyZohoStatus = (next: string) => {
    setZohoStatus(next);
    setPage(1);
  };

  const filterBadgeCount = activeFilterCount;

  const kamOptions = useMemo(
    () => assignableStaff
      .filter(staff => !isHiddenKamName(staff.displayName))
      .map(staff => ({ value: staff.uid, label: staff.displayName })),
    [assignableStaff],
  );

  const draftDistricts = useMemo(() => {
    if (!filterDraft.stateFilter.length) {
      return Array.from(new Set(Object.values(districtsByState).flat())).sort();
    }
    return filterDraft.stateFilter.flatMap(state => districtsByState[state] ?? []);
  }, [districtsByState, filterDraft.stateFilter]);

  const dealerFilterFields = (
    <div className="dealers-filter-groups">
      <FilterMultiDropdown
        label="State"
        values={filterDraft.stateFilter}
        options={states.map(state => ({ value: state, label: state }))}
        placeholder="All States"
        onChange={handleDraftStateChange}
      />
      {filterDraft.stateFilter.length > 0 ? (
        <FilterMultiDropdown
          label="District"
          values={filterDraft.districtFilter}
          options={draftDistricts.map(district => ({ value: district, label: district }))}
          placeholder="All Districts"
          onChange={next => setFilterDraft(prev => ({ ...prev, districtFilter: next }))}
        />
      ) : (
        <p className="dealers-filter-hint">Select a state to see districts where you have dealers.</p>
      )}
      <FilterSelect
        label="Price level"
        value={filterDraft.priceLevelFilter}
        options={PRICE_LEVEL_FILTER_OPTIONS}
        onChange={next => setFilterDraft(prev => ({ ...prev, priceLevelFilter: next }))}
      />
      <FilterSelect
        label="Zoho status"
        value={filterDraft.zohoStatus}
        options={ZOHO_STATUS_CHIPS}
        onChange={next => setFilterDraft(prev => ({ ...prev, zohoStatus: next }))}
      />
      <FilterSelect
        label="App status"
        value={filterDraft.appStatus}
        options={APP_STATUS_CHIPS}
        onChange={next => setFilterDraft(prev => ({ ...prev, appStatus: next }))}
      />
      <FilterSelect
        label="Assigned"
        value={filterDraft.assignment}
        options={ASSIGNMENT_CHIPS}
        onChange={handleDraftAssignmentChange}
      />
      {filterDraft.assignment !== 'unassigned' ? (
        <FilterMultiDropdown
          label="KAM"
          values={filterDraft.staffFilter}
          options={kamOptions}
          placeholder="All KAMs"
          onChange={next => setFilterDraft(prev => ({ ...prev, staffFilter: next }))}
        />
      ) : null}
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
        onClick={() => {
          if (filtersOpen) {
            setFiltersOpen(false);
            return;
          }
          openDealerFilters();
        }}
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
            className="support-filter-sheet dealers-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filter dealers"
          >
            <header className="support-filter-sheet__header">
              <h3 className="support-filter-sheet__title">Filters</h3>
              <div className="support-filter-sheet__header-actions">
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

            <div className="dealers-filter-sheet__body">
              {mainTab === 'roster' ? dealerFilterFields : (
                <FilterSelect
                  label="Price level"
                  value={filterDraft.priceLevelFilter}
                  options={PRICE_LEVEL_FILTER_OPTIONS}
                  onChange={next => setFilterDraft(prev => ({ ...prev, priceLevelFilter: next }))}
                />
              )}
            </div>

            <footer className="support-filter-sheet__footer dealers-filter-sheet__footer">
              <button
                type="button"
                className="btn btn-secondary dealers-filter-sheet__clear"
                onClick={resetDealerFilters}
              >
                Clear all
              </button>
              <button
                type="button"
                className="btn btn-primary dealers-filter-sheet__apply"
                onClick={applyDraftDealerFilters}
              >
                Apply
              </button>
            </footer>
          </div>
        </>
      ) : null}

      {mainTab === 'salespersons' ? (
        <ZohoSalespersonsPanel />
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
          className={`dealers-kpi dealers-kpi--roster${zohoStatus === '' ? ' is-active' : ''}`}
          onClick={() => applyZohoStatus('')}
        >
          <Users size={16} />
          <div>
            <h3>
              <span className="dealers-kpi__label-long">Total Dealers</span>
              <span className="dealers-kpi__label-short">Total</span>
            </h3>
            <div className="stat-value">{(stats?.total ?? total).toLocaleString('en-IN')}</div>
          </div>
        </button>
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster dealers-kpi--active${zohoStatus === 'Active' ? ' is-active' : ''}`}
          onClick={() => applyZohoStatus('Active')}
        >
          <UserCheck size={16} />
          <div>
            <h3>
              <span className="dealers-kpi__label-long">Active Dealers</span>
              <span className="dealers-kpi__label-short">Active</span>
            </h3>
            <div className="stat-value">{(stats?.active ?? 0).toLocaleString('en-IN')}</div>
          </div>
        </button>
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster dealers-kpi--inactive${zohoStatus === 'Non Active' ? ' is-active' : ''}`}
          onClick={() => applyZohoStatus('Non Active')}
        >
          <Clock size={16} />
          <div>
            <h3>
              <span className="dealers-kpi__label-long">Inactive Dealers</span>
              <span className="dealers-kpi__label-short">Inactive</span>
            </h3>
            <div className="stat-value">{(stats?.nonActive ?? 0).toLocaleString('en-IN')}</div>
          </div>
        </button>
        <button
          type="button"
          className={`dealers-kpi dealers-kpi--roster dealers-kpi--blacklisted${zohoStatus === 'Black listed' ? ' is-active' : ''}`}
          onClick={() => applyZohoStatus('Black listed')}
        >
          <Ban size={16} />
          <div>
            <h3>Blacklisted</h3>
            <div className="stat-value">{(stats?.blacklisted ?? 0).toLocaleString('en-IN')}</div>
          </div>
        </button>
      </div>

      <div className="dealers-table-panel">
        <div className="dealers-roster" aria-label="Dealer list">
          {dealers.length === 0 ? (
            <p className="dealers-tiles__empty">
              {loading ? 'Loading dealers…' : 'No dealers found. Sync from Zoho to get started.'}
            </p>
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
