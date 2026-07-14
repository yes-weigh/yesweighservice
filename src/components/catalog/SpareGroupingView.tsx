import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  ChevronDown,
  Layers,
  Save,
  Search,
  Square,
  Undo2,
  X,
} from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import {
  assignCatalogSpareGroups,
} from '../../lib/catalog';
import {
  loadSpareGroups,
  type CatalogSpareGroupOption,
} from '../../lib/catalogProductSettings';
import type { CatalogProduct } from '../../types/catalog';
import { ProductBrowseCard } from './ProductBrowseCard';
import { fillSearchFromScan, SkuScanButton } from './SkuScanButton';

type ListView = 'needs-group' | 'this-group' | 'all';
type DraftMap = Record<string, string | null>;

type Props = {
  spares: CatalogProduct[];
  onAssigned?: (productIds: string[], spareGroupId: string | null) => void;
};

type PickerState = {
  productIds: string[];
  title: string;
};

function matchesSearch(product: CatalogProduct, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    product.name.toLowerCase().includes(needle)
    || (product.sku ?? '').toLowerCase().includes(needle)
  );
}

function baselineFromSpares(spares: CatalogProduct[]): DraftMap {
  const next: DraftMap = {};
  for (const spare of spares) {
    next[spare.id] = spare.spareGroupId?.trim() || null;
  }
  return next;
}

export const SpareGroupingView: React.FC<Props> = ({ spares, onAssigned }) => {
  const confirm = useConfirm();
  const [groups, setGroups] = useState<CatalogSpareGroupOption[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [listView, setListView] = useState<ListView>('needs-group');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [draftById, setDraftById] = useState<DraftMap>({});
  const [baselineById, setBaselineById] = useState<DraftMap>({});
  const dirtyFlag = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingGroups(true);
    void loadSpareGroups()
      .then(loaded => {
        if (!active) return;
        setGroups(loaded);
        setFilterGroupId(prev => prev ?? loaded[0]?.id ?? null);
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load spare groups.');
        }
      })
      .finally(() => {
        if (active) setLoadingGroups(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextBaseline = baselineFromSpares(spares);
    setBaselineById(nextBaseline);
    if (!dirtyFlag.current) {
      setDraftById(nextBaseline);
    } else {
      setDraftById(prev => {
        const merged: DraftMap = {};
        for (const spare of spares) {
          merged[spare.id] = spare.id in prev ? prev[spare.id] : nextBaseline[spare.id];
        }
        return merged;
      });
    }
  }, [spares]);

  const dirtyEntries = useMemo(() => {
    const changed: Array<{ id: string; next: string | null }> = [];
    for (const spare of spares) {
      const baseline = baselineById[spare.id] ?? (spare.spareGroupId?.trim() || null);
      const draft = spare.id in draftById ? draftById[spare.id] : baseline;
      if (draft !== baseline) changed.push({ id: spare.id, next: draft ?? null });
    }
    return changed;
  }, [spares, baselineById, draftById]);

  const dirtyCount = dirtyEntries.length;
  dirtyFlag.current = dirtyCount > 0;

  useEffect(() => {
    if (!dirtyCount) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyCount]);

  useEffect(() => {
    if (!selectMode) setSelectedIds(new Set());
  }, [selectMode]);

  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) map.set(g.id, g.name);
    return map;
  }, [groups]);

  const resolveGroupId = (product: CatalogProduct): string | null => {
    if (product.id in draftById) return draftById[product.id] ?? null;
    return product.spareGroupId?.trim() || null;
  };

  const counts = useMemo(() => {
    let unassigned = 0;
    let assigned = 0;
    const byGroup = new Map<string, number>();
    for (const g of groups) byGroup.set(g.id, 0);
    for (const spare of spares) {
      const gid =
        spare.id in draftById
          ? draftById[spare.id]
          : (spare.spareGroupId?.trim() || null);
      if (!gid) unassigned += 1;
      else {
        assigned += 1;
        byGroup.set(gid, (byGroup.get(gid) ?? 0) + 1);
      }
    }
    return { unassigned, assigned, byGroup, total: spares.length };
  }, [spares, groups, draftById]);

  const filterGroup = groups.find(g => g.id === filterGroupId) ?? null;
  const filterGroupCount = filterGroupId ? (counts.byGroup.get(filterGroupId) ?? 0) : counts.assigned;

  const visibleSpares = useMemo(() => {
    const q = search.trim();
    return spares.filter(spare => {
      if (!matchesSearch(spare, q)) return false;
      const gid =
        spare.id in draftById
          ? draftById[spare.id]
          : (spare.spareGroupId?.trim() || null);
      if (listView === 'needs-group') return !gid;
      if (listView === 'this-group') {
        if (!gid) return false;
        if (!filterGroupId) return true; // all grouped
        return gid === filterGroupId;
      }
      return true;
    });
  }, [spares, search, listView, filterGroupId, draftById]);

  useEffect(() => {
    setSelectedIds(prev => {
      const visible = new Set(visibleSpares.map(s => s.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleSpares]);

  const allVisibleSelected =
    visibleSpares.length > 0 && visibleSpares.every(s => selectedIds.has(s.id));

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(visibleSpares.map(s => s.id)));
  };

  const patchDraft = (ids: string[], spareGroupId: string | null) => {
    setDraftById(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = spareGroupId;
      return next;
    });
    setError('');
  };

  const openPickerForProducts = (products: CatalogProduct[]) => {
    if (!products.length) return;
    setPicker({
      productIds: products.map(p => p.id),
      title:
        products.length === 1
          ? products[0].name
          : `${products.length} selected spares`,
    });
  };

  const handleCardActivate = (spare: CatalogProduct) => {
    if (selectMode) {
      toggleOne(spare.id);
      return;
    }
    openPickerForProducts([spare]);
  };

  const applyPickerChoice = (spareGroupId: string | null) => {
    if (!picker) return;
    patchDraft(picker.productIds, spareGroupId);
    if (spareGroupId) {
      const label = groupNameById.get(spareGroupId) ?? 'group';
      showToast(
        picker.productIds.length === 1
          ? `Queued · ${label}`
          : `Queued · ${picker.productIds.length} → ${label}`,
      );
    } else {
      showToast(
        picker.productIds.length === 1
          ? 'Queued · remove'
          : `Queued · remove ${picker.productIds.length}`,
      );
    }
    setPicker(null);
    setSelectedIds(new Set());
  };

  const pickerCurrentGroupId = useMemo(() => {
    if (!picker?.productIds.length) return null;
    const first = picker.productIds[0] in draftById
      ? draftById[picker.productIds[0]]
      : null;
    const same = picker.productIds.every(id => {
      const value = id in draftById ? draftById[id] : null;
      return value === first;
    });
    return same ? (first ?? null) : null;
  }, [picker, draftById]);

  const handleDiscard = async () => {
    if (!dirtyCount) return;
    const ok = await confirm({
      title: 'Discard changes?',
      message: `${dirtyCount} unsaved grouping change${dirtyCount === 1 ? '' : 's'} will be lost.`,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
    if (!ok) return;
    setDraftById({ ...baselineById });
    setSelectedIds(new Set());
    setPicker(null);
    setError('');
    showToast('Changes discarded');
  };

  const handleSave = async () => {
    if (!dirtyCount || saving) return;
    setSaving(true);
    setError('');
    try {
      const byTarget = new Map<string | null, string[]>();
      for (const entry of dirtyEntries) {
        const list = byTarget.get(entry.next) ?? [];
        list.push(entry.id);
        byTarget.set(entry.next, list);
      }

      for (const [spareGroupId, productIds] of byTarget) {
        await assignCatalogSpareGroups(productIds, spareGroupId);
        onAssigned?.(productIds, spareGroupId);
      }

      const nextBaseline = { ...baselineById };
      for (const entry of dirtyEntries) nextBaseline[entry.id] = entry.next;
      setBaselineById(nextBaseline);
      setDraftById(nextBaseline);
      dirtyFlag.current = false;
      setSelectedIds(new Set());
      setPicker(null);
      showToast(`Saved ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save grouping.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingGroups) {
    return (
      <div className="spare-grouping panel glass">
        <div className="spare-grouping__loading">
          <div className="loader-ring" />
        </div>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="spare-grouping panel glass">
        <div className="spare-grouping__empty">
          <Layers size={28} aria-hidden />
          <h2>No spare groups yet</h2>
          <p className="text-muted">
            Add groups in Settings → Product settings → Spare groups.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        'spare-grouping panel glass spare-grouping--mobile',
        selectMode ? 'is-select-mode' : '',
        dirtyCount ? 'is-dirty' : '',
      ].filter(Boolean).join(' ')}
    >
      <header className="spare-grouping__head">
        <div className="spare-grouping__head-main">
          <h2 className="spare-grouping__title">Spare grouping</h2>
          <p className="spare-grouping__stats">
            <span>{counts.unassigned} left</span>
            <span aria-hidden>·</span>
            <span>{counts.assigned} grouped</span>
            {dirtyCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="spare-grouping__dirty-pill">{dirtyCount} unsaved</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className={`spare-grouping__select-toggle${selectMode ? ' is-active' : ''}`}
          aria-pressed={selectMode}
          onClick={() => setSelectMode(v => !v)}
        >
          {selectMode ? <CheckSquare size={15} aria-hidden /> : <Square size={15} aria-hidden />}
          {selectMode ? 'Selecting' : 'Multi-select'}
        </button>
      </header>

      <p className="spare-grouping__lead">
        {selectMode
          ? 'Select cards, then choose a group.'
          : 'Tap a card to choose its group.'}
      </p>

      <div className="spare-grouping__toolbar">
        <div className="spare-grouping__views" role="tablist" aria-label="List">
          <button
            type="button"
            role="tab"
            aria-selected={listView === 'needs-group'}
            className={`spare-grouping__view${listView === 'needs-group' ? ' is-active' : ''}`}
            onClick={() => setListView('needs-group')}
          >
            Needs group
            <span>{counts.unassigned}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listView === 'this-group'}
            className={`spare-grouping__view${listView === 'this-group' ? ' is-active' : ''}`}
            onClick={() => {
              setListView('this-group');
              setFilterGroupId(null);
              setGroupsOpen(true);
            }}
          >
            Grouped
            <span>{counts.assigned}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listView === 'all'}
            className={`spare-grouping__view${listView === 'all' ? ' is-active' : ''}`}
            onClick={() => setListView('all')}
          >
            All
            <span>{counts.total}</span>
          </button>
        </div>

        {listView === 'this-group' && (
          <div className="spare-grouping__collapsed">
            <button
              type="button"
              className={`spare-grouping__collapsed-btn${groupsOpen ? ' is-open' : ''}`}
              aria-expanded={groupsOpen}
              onClick={() => setGroupsOpen(v => !v)}
            >
              <span>
                {filterGroupId ? (
                  <>
                    Group <strong>{filterGroup?.name ?? 'group'}</strong>
                  </>
                ) : (
                  <>
                    Showing <strong>all groups</strong>
                  </>
                )}
              </span>
              <span className="spare-grouping__collapsed-meta">
                {filterGroupCount}
                <ChevronDown size={16} aria-hidden />
              </span>
            </button>
            {groupsOpen && (
              <div className="spare-grouping__collapsed-panel" role="listbox" aria-label="Filter group">
                <button
                  type="button"
                  role="option"
                  aria-selected={!filterGroupId}
                  className={`spare-grouping__collapsed-option${!filterGroupId ? ' is-active' : ''}`}
                  onClick={() => {
                    setFilterGroupId(null);
                    setGroupsOpen(false);
                  }}
                >
                  <span>All groups</span>
                  <span>{counts.assigned}</span>
                </button>
                {groups.map(group => {
                  const active = filterGroupId === group.id;
                  const count = counts.byGroup.get(group.id) ?? 0;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`spare-grouping__collapsed-option${active ? ' is-active' : ''}`}
                      onClick={() => {
                        setFilterGroupId(group.id);
                        setGroupsOpen(false);
                      }}
                    >
                      <span>{group.name}</span>
                      <span>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label className="spare-grouping__search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={search}
            placeholder="Search name or SKU"
            onChange={e => setSearch(e.target.value)}
          />
          <SkuScanButton
            onScan={raw => fillSearchFromScan(raw, setSearch)}
            hint="Point at the spare label QR code."
          />
        </label>
      </div>

      {(error || toast) && (
        <div className="spare-grouping__feedback" role="status">
          {error && <p className="spare-grouping__error">{error}</p>}
          {!error && toast && <p className="spare-grouping__toast">{toast}</p>}
        </div>
      )}

      {selectMode && (
        <div className="spare-grouping__actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={toggleAllVisible}
            disabled={!visibleSpares.length || saving}
          >
            {allVisibleSelected ? 'Clear' : `Select all (${visibleSpares.length})`}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving || !selectedIds.size}
            onClick={() => {
              const items = visibleSpares.filter(s => selectedIds.has(s.id));
              openPickerForProducts(items);
            }}
          >
            Choose group ({selectedIds.size})
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving || !selectedIds.size}
            onClick={() => {
              const items = visibleSpares.filter(s => selectedIds.has(s.id));
              patchDraft(items.map(i => i.id), null);
              setSelectedIds(new Set());
              showToast(`Queued · remove ${items.length}`);
            }}
          >
            <Undo2 size={14} aria-hidden />
            Remove
          </button>
        </div>
      )}

      {visibleSpares.length === 0 ? (
        <p className="text-muted spare-grouping__empty-list">
          {listView === 'this-group'
            ? filterGroupId
              ? `Nothing in ${filterGroup?.name ?? 'this group'} yet.`
              : 'No grouped spares yet.'
            : listView === 'needs-group'
              ? 'All spares are grouped.'
              : 'No spares match.'}
        </p>
      ) : (
        <div className="catalog-grid catalog-grid--tiles spare-grouping__grid" role="list">
          {visibleSpares.map((spare, index) => {
            const checked = selectedIds.has(spare.id);
            const gid = resolveGroupId(spare);
            const groupLabel = gid ? groupNameById.get(gid) ?? gid : 'Unassigned';
            const baselineGid = baselineById[spare.id] ?? (spare.spareGroupId?.trim() || null);
            const draftGid = spare.id in draftById ? draftById[spare.id] : baselineGid;
            const queued = draftGid !== baselineGid;
            return (
              <div
                key={spare.id}
                role="listitem"
                className={[
                  'spare-grouping__card-wrap',
                  'is-clickable',
                  checked ? 'is-selected' : '',
                  queued ? 'is-queued' : '',
                ].filter(Boolean).join(' ')}
              >
                {selectMode && (
                  <button
                    type="button"
                    className={`spare-grouping__card-check${checked ? ' is-selected' : ''}`}
                    onClick={() => toggleOne(spare.id)}
                    aria-pressed={checked}
                    aria-label={`${checked ? 'Deselect' : 'Select'} ${spare.name}`}
                  >
                    {checked ? <CheckSquare size={15} aria-hidden /> : <Square size={15} aria-hidden />}
                  </button>
                )}
                <span
                  className={[
                    'spare-grouping__card-group-badge',
                    gid ? '' : 'is-unassigned',
                    queued ? 'is-queued' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {queued && !gid ? 'Queued remove' : queued ? `Queued · ${groupLabel}` : groupLabel}
                </span>
                <ProductBrowseCard
                  product={spare}
                  index={index}
                  onSelect={() => handleCardActivate(spare)}
                  showStockQuantity
                />
              </div>
            );
          })}
        </div>
      )}

      {picker && createPortal(
        <div className="spare-grouping-sheet" role="dialog" aria-modal="true" aria-label="Choose group">
          <button
            type="button"
            className="spare-grouping-sheet__backdrop"
            aria-label="Close"
            onClick={() => setPicker(null)}
          />
          <div className="spare-grouping-sheet__panel">
            <div className="spare-grouping-sheet__handle" aria-hidden />
            <header className="spare-grouping-sheet__head">
              <div>
                <p className="spare-grouping-sheet__eyebrow">Assign to group</p>
                <h3 className="spare-grouping-sheet__title">{picker.title}</h3>
              </div>
              <button
                type="button"
                className="spare-grouping-sheet__close"
                onClick={() => setPicker(null)}
                aria-label="Close"
              >
                <X size={18} aria-hidden />
              </button>
            </header>
            <div className="spare-grouping-sheet__list">
              {groups.map(group => {
                const count = counts.byGroup.get(group.id) ?? 0;
                const active = pickerCurrentGroupId === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`spare-grouping-sheet__option${active ? ' is-active' : ''}`}
                    onClick={() => applyPickerChoice(group.id)}
                  >
                    <span>{group.name}</span>
                    <span className="spare-grouping-sheet__option-meta">
                      {active ? 'Current' : count}
                    </span>
                  </button>
                );
              })}
            </div>
            {pickerCurrentGroupId && (
              <button
                type="button"
                className="spare-grouping-sheet__remove"
                onClick={() => applyPickerChoice(null)}
              >
                <Undo2 size={16} aria-hidden />
                Remove from group
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}

      {createPortal(
        <div className={`spare-grouping-fixed-save${dirtyCount ? ' is-dirty' : ''}`}>
          <div className="spare-grouping-fixed-save__inner">
            <p className="spare-grouping-fixed-save__note">
              {dirtyCount ? `${dirtyCount} unsaved` : 'No unsaved changes'}
            </p>
            <div className="spare-grouping-fixed-save__actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!dirtyCount || saving}
                onClick={() => void handleDiscard()}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!dirtyCount || saving}
                onClick={() => void handleSave()}
              >
                <Save size={15} aria-hidden />
                {saving ? 'Saving…' : dirtyCount ? `Save (${dirtyCount})` : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
