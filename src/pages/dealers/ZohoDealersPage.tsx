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
import { CreateDealerUserModal } from '../../components/dealers/CreateDealerUserModal';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { db } from '../../firebase';
import {
  createKam,
  dealerErrorMessage,
  exportDealersCsv,
  fetchDealerCategories,
  fetchDealerLocations,
  fetchDealerSetting,
  fetchDealers,
  fetchDealerStats,
  fetchKams,
  importCrmDealerOverlay,
  backfillDealerLocations,
  linkDealerPortalUser,
  patchDealer,
  syncZohoCustomers,
} from '../../lib/dealers';
import { deactivateUser, registerUser } from '../../lib/userAdmin';
import { DEALER_STAGES, type DealerListParams, type Kam, type ZohoDealer } from '../../types/dealers';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const ZohoDealersPage: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [kamFilter, setKamFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [districtFilter, setDistrictFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [signedInFilter, setSignedInFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState('contactName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [paginationOn, setPaginationOn] = useState(true);
  const limit = 25;

  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importingCrmOverlay, setImportingCrmOverlay] = useState(false);
  const [backfillingLocations, setBackfillingLocations] = useState(false);
  const [crmOverlayDone, setCrmOverlayDone] = useState(false);
  const [locationsBackfilled, setLocationsBackfilled] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, blacklisted: 0, inactive: 0, unassignedKam: 0 });
  const [states, setStates] = useState<string[]>([]);
  const [districtsByState, setDistrictsByState] = useState<Record<string, string[]>>({});
  const [kams, setKams] = useState<Kam[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createFor, setCreateFor] = useState<ZohoDealer | null>(null);

  const queryParams = useMemo((): DealerListParams => ({
    page: paginationOn ? page : 1,
    limit: paginationOn ? limit : 99999,
    status: 'all',
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(kamFilter.length ? { kamId: kamFilter.join(',') } : {}),
    ...(stageFilter.length ? { dealerStage: stageFilter.join(',') } : {}),
    ...(stateFilter.length ? { billingState: stateFilter.join(',') } : {}),
    ...(districtFilter.length ? { district: districtFilter.join(',') } : {}),
    ...(categoryFilter.length ? { categories: categoryFilter.join(',') } : {}),
    ...(signedInFilter.length === 1
      ? { signedIn: signedInFilter[0] === 'yes' ? 'true' : 'false' }
      : {}),
    sortField,
    sortDir,
  }), [
    paginationOn, page, debouncedSearch, kamFilter, stageFilter, stateFilter,
    districtFilter, categoryFilter, signedInFilter, sortField, sortDir,
  ]);

  const districts = useMemo(() => {
    if (!stateFilter.length) {
      return Array.from(new Set(Object.values(districtsByState).flat())).sort();
    }
    return stateFilter.flatMap(s => districtsByState[s] ?? []);
  }, [districtsByState, stateFilter]);

  const loadMeta = useCallback(async () => {
    try {
      const [statsRes, locRes, kamsRes, catsRes, crmOverlayDoneRes, locDone] = await Promise.all([
        fetchDealerStats(),
        fetchDealerLocations(),
        fetchKams(),
        fetchDealerCategories(),
        fetchDealerSetting('crm_overlay_import_done', false),
        fetchDealerSetting('locations_backfilled', false),
      ]);
      setStats(statsRes);
      setStates(locRes.states);
      setDistrictsByState(locRes.districtsByState);
      setKams(kamsRes);
      setCategories(catsRes);
      setCrmOverlayDone(Boolean(crmOverlayDoneRes));
      setLocationsBackfilled(Boolean(locDone));
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
  }, [debouncedSearch, stageFilter, kamFilter, stateFilter, districtFilter, categoryFilter, signedInFilter]);

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

  const handleImportCrmOverlay = async () => {
    const proceed = crmOverlayDone
      ? await confirm({
        title: 'Re-import CRM overlay?',
        message: 'Reads current KAM, stages, and deactivations from yesweighmomentumhub Firebase and merges them onto Zoho dealers.',
        confirmLabel: 'Import again',
      })
      : await confirm({
        title: 'Import CRM overlay from Firebase?',
        message: 'Copies current dealer KAM, stages, deactivations, categories, and zip codes from yesweighmomentumhub Firebase onto your Zoho-synced dealers. Run Sync from Zoho first.',
        confirmLabel: 'Import CRM overlay',
      });
    if (!proceed) return;

    setImportingCrmOverlay(true);
    setError('');
    setSuccess('');
    try {
      const result = await importCrmDealerOverlay();
      await loadMeta();
      await loadDealers();
      setCrmOverlayDone(true);
      setSuccess(
        `CRM overlay imported from ${result.sourceProject}: `
        + `${result.overridesMatched} overrides, ${result.deactivatedMatched} deactivations, `
        + `${result.documentsUpdated} documents updated.`
        + (result.overridesSkipped
          ? ` ${result.overridesSkipped} CRM names had no Zoho match.`
          : ''),
      );
    } catch (err) {
      console.error('CRM dealer overlay import failed:', err);
      setError(dealerErrorMessage(err));
    } finally {
      setImportingCrmOverlay(false);
    }
  };

  const handleBackfillLocations = async () => {
    const proceed = await confirm({
      title: 'Backfill dealer locations?',
      message: 'Normalizes districts from zip cache, then fetches missing state/district/zip from Zoho (slow — one API call per dealer).',
      confirmLabel: 'Backfill locations',
    });
    if (!proceed) return;

    setBackfillingLocations(true);
    setError('');
    setSuccess('');
    try {
      const result = await backfillDealerLocations();
      await loadMeta();
      await loadDealers();
      setLocationsBackfilled(true);
      setSuccess(
        `Location backfill done: ${result.offlineFixedCount} districts normalized, `
        + `${result.deepFetchCount} dealers updated from Zoho (${result.totalAttempted} attempted).`,
      );
    } catch (err) {
      console.error('Location backfill failed:', err);
      setError(dealerErrorMessage(err));
    } finally {
      setBackfillingLocations(false);
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

  const handleCreateUser = async (payload: {
    loginId: string;
    password: string;
    displayName: string;
    phone?: string;
    email?: string;
  }) => {
    if (!user || !createFor) return;
    const uid = await registerUser(db, {
      loginId: payload.loginId,
      password: payload.password,
      displayName: payload.displayName,
      role: 'dealer',
      phone: payload.phone,
      email: payload.email,
      zohoCustomerId: createFor.id,
      createdByUid: user.uid,
    });
    await linkDealerPortalUser(createFor.id, uid);
    await loadDealers();
    await loadMeta();
  };

  const handleDeactivatePortal = async (dealer: ZohoDealer) => {
    if (!dealer.portalUserId) return;
    const ok = await confirm({
      title: 'Deactivate portal user?',
      message: `Deactivate login for ${dealer.portalUserName ?? dealer.contactName}?`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    await deactivateUser(db, dealer.portalUserId);
    await loadDealers();
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

  return (
    <div className="page-content fade-in dealers-page">
      <div className="dealers-page__header panel glass">
        <div>
          <h2>Dealers</h2>
          <p className="text-muted text-sm">Zoho customers — sync, filter, and create portal logins.</p>
        </div>
      </div>

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
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => { setStageFilter([]); setKamFilter([]); setSignedInFilter([]); }}>
          <Users size={22} />
          <div><h3>Total</h3><p className="stat-value">{stats.total}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setStageFilter(['Active'])}>
          <UserCheck size={22} />
          <div><h3>Active</h3><p className="stat-value">{stats.active}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setStageFilter(['Non Active'])}>
          <UserX size={22} />
          <div><h3>Non Active</h3><p className="stat-value">{stats.inactive}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setStageFilter(['Black listed'])}>
          <Ban size={22} />
          <div><h3>Blacklisted</h3><p className="stat-value">{stats.blacklisted}</p></div>
        </button>
        <button type="button" className="stat-card glass dealers-kpi" onClick={() => setKamFilter(['unassigned'])}>
          <Briefcase size={22} />
          <div><h3>Unassigned KAM</h3><p className="stat-value">{stats.unassignedKam}</p></div>
        </button>
      </div>

      <div className="dealers-toolbar panel glass">
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
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaginationOn(v => !v)}>
            {paginationOn ? 'Pagination on' : 'Show all'}
          </button>
          <button type="button" className="btn btn-primary" disabled={syncing} onClick={() => void handleSync()}>
            <RefreshCw size={16} className={syncing ? 'spin-icon' : undefined} />
            {syncing ? 'Syncing…' : 'Sync from Zoho'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={importingCrmOverlay}
            onClick={() => void handleImportCrmOverlay()}
            title={crmOverlayDone ? 'CRM overlay already imported — click to re-import from Firebase' : 'Import KAM/stages from yesweighmomentumhub Firebase'}
          >
            {importingCrmOverlay ? 'Importing…' : crmOverlayDone ? 'Re-import CRM overlay' : 'Import CRM overlay'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={backfillingLocations}
            onClick={() => void handleBackfillLocations()}
            title={locationsBackfilled ? 'Locations already backfilled — click to run again' : 'Fill missing state/district/zip from Zoho'}
          >
            {backfillingLocations ? 'Backfilling…' : locationsBackfilled ? 'Re-backfill locations' : 'Backfill locations'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void handleExport()}>
            <Download size={16} /> Export CSV
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadDealers()}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const name = window.prompt('New KAM name');
              if (!name?.trim()) return;
              void createKam(name.trim()).then(() => loadMeta());
            }}
          >
            + KAM
          </button>
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
            placeholder="Stage"
            value={stageFilter}
            onChange={setStageFilter}
            options={DEALER_STAGES.map(s => ({ value: s, label: s }))}
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
          <MultiSelect
            placeholder="Signed in"
            value={signedInFilter}
            onChange={setSignedInFilter}
            options={[
              { value: 'yes', label: 'Signed in' },
              { value: 'no', label: 'Not signed in' },
            ]}
          />
        </div>
      </div>

      <div className="panel glass dealers-table-wrap">
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
              <th><button type="button" onClick={() => handleSort('dealerStage')}>Stage <SortMark field="dealerStage" /></button></th>
              <th>Signed in</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="dealers-table__empty">Loading dealers…</td></tr>
            ) : dealers.length === 0 ? (
              <tr><td colSpan={12} className="dealers-table__empty">No dealers found. Sync from Zoho to get started.</td></tr>
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
                    <select
                      className="catalog-select dealers-inline-select"
                      value={dealer.dealerStage ?? ''}
                      onChange={e => void updateField(dealer.id, { dealerStage: e.target.value || null })}
                      aria-label="Stage"
                    >
                      <option value="">—</option>
                      {DEALER_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    {dealer.signedIn ? (
                      <span className="dealers-signed-badge dealers-signed-badge--yes">Yes</span>
                    ) : (
                      <span className="dealers-signed-badge">No</span>
                    )}
                  </td>
                  <td className="dealers-table__actions">
                    {dealer.signedIn ? (
                      <>
                        <span className="text-sm">{dealer.portalUserName}</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Deactivate portal user"
                          onClick={() => void handleDeactivatePortal(dealer)}
                        >
                          <UserX size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setCreateFor(dealer)}
                      >
                        Create user
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {paginationOn && total > limit && (
        <div className="dealers-pagination">
          <span className="text-muted text-sm">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="dealers-pagination__btns">
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page * limit >= total} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </div>
      )}

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

      {createFor && (
        <CreateDealerUserModal
          dealer={createFor}
          onClose={() => setCreateFor(null)}
          onSubmit={handleCreateUser}
        />
      )}
    </div>
  );
};
