import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Layers, Search, Square } from 'lucide-react';
import {
  assignCatalogSpareGroups,
} from '../../lib/catalog';
import {
  loadSpareGroups,
  type CatalogSpareGroupOption,
} from '../../lib/catalogProductSettings';
import type { CatalogProduct } from '../../types/catalog';
import { ProductBrowseCard } from './ProductBrowseCard';

type MembershipFilter = 'all' | 'unassigned' | 'assigned' | 'in-selected';

type Props = {
  spares: CatalogProduct[];
  onAssigned?: (productIds: string[], spareGroupId: string | null) => void;
};

function matchesSearch(product: CatalogProduct, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    product.name.toLowerCase().includes(needle)
    || (product.sku ?? '').toLowerCase().includes(needle)
  );
}

export const SpareGroupingView: React.FC<Props> = ({ spares, onAssigned }) => {
  const [groups, setGroups] = useState<CatalogSpareGroupOption[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [membership, setMembership] = useState<MembershipFilter>('unassigned');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  /** Local overrides after assign so list updates before parent refresh. */
  const [localGroupById, setLocalGroupById] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let active = true;
    setLoadingGroups(true);
    void loadSpareGroups()
      .then(loaded => {
        if (!active) return;
        setGroups(loaded);
        if (loaded.length && !selectedGroupId) {
          setSelectedGroupId(loaded[0].id);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only load once on mount
  }, []);

  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) map.set(g.id, g.name);
    return map;
  }, [groups]);

  const resolveGroupId = (product: CatalogProduct): string | null => {
    if (product.id in localGroupById) return localGroupById[product.id] ?? null;
    return product.spareGroupId?.trim() || null;
  };

  const counts = useMemo(() => {
    let unassigned = 0;
    let assigned = 0;
    const byGroup = new Map<string, number>();
    for (const g of groups) byGroup.set(g.id, 0);
    for (const spare of spares) {
      const gid = resolveGroupId(spare);
      if (!gid) {
        unassigned += 1;
      } else {
        assigned += 1;
        byGroup.set(gid, (byGroup.get(gid) ?? 0) + 1);
      }
    }
    return { unassigned, assigned, byGroup, total: spares.length };
  }, [spares, groups, localGroupById]);

  const selectedGroup = groups.find(g => g.id === selectedGroupId) ?? null;

  const visibleSpares = useMemo(() => {
    const q = search.trim();
    return spares.filter(spare => {
      if (!matchesSearch(spare, q)) return false;
      const gid = resolveGroupId(spare);
      if (membership === 'unassigned') return !gid;
      if (membership === 'assigned') return Boolean(gid);
      if (membership === 'in-selected') {
        return Boolean(selectedGroupId) && gid === selectedGroupId;
      }
      return true;
    });
  }, [spares, search, membership, selectedGroupId, localGroupById]);

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

  const runAssign = async (spareGroupId: string | null) => {
    const ids = [...selectedIds];
    if (!ids.length) {
      setError('Select at least one spare.');
      return;
    }
    if (spareGroupId && !groups.some(g => g.id === spareGroupId)) {
      setError('Pick a spare group first.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await assignCatalogSpareGroups(ids, spareGroupId);
      setLocalGroupById(prev => {
        const next = { ...prev };
        for (const id of ids) next[id] = spareGroupId;
        return next;
      });
      setSelectedIds(new Set());
      const label = spareGroupId
        ? groupNameById.get(spareGroupId) ?? spareGroupId
        : 'Unassigned';
      setSuccess(`Assigned ${result.updated} spare${result.updated === 1 ? '' : 's'} → ${label}.`);
      onAssigned?.(ids, spareGroupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign spare group.');
    } finally {
      setBusy(false);
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
            Add groups in Admin → Settings → Product settings → Spare groups.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="spare-grouping panel glass">
      <header className="spare-grouping__head">
        <div>
          <h2 className="spare-grouping__title">Spare grouping</h2>
          <p className="text-muted text-sm">
            Pick a group, multi-select Generic spare parts / uncategorized items, then assign.
            {' '}
            {counts.unassigned} unassigned · {counts.assigned} grouped · {counts.total} total
          </p>
        </div>
      </header>

      {error && <p className="spare-grouping__error">{error}</p>}
      {success && <p className="spare-grouping__success">{success}</p>}

      <div className="spare-grouping__groups" role="listbox" aria-label="Spare groups">
        {groups.map(group => {
          const active = selectedGroupId === group.id;
          const count = counts.byGroup.get(group.id) ?? 0;
          return (
            <button
              key={group.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`spare-grouping__group-chip${active ? ' is-active' : ''}`}
              onClick={() => setSelectedGroupId(group.id)}
            >
              <span>{group.name}</span>
              <span className="spare-grouping__group-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="spare-grouping__toolbar">
        <label className="spare-grouping__search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={search}
            placeholder="Search name or SKU"
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <div className="spare-grouping__filters" role="group" aria-label="Membership filter">
          {(
            [
              ['unassigned', `Unassigned (${counts.unassigned})`],
              ['assigned', `Assigned (${counts.assigned})`],
              ['in-selected', `In ${selectedGroup?.name ?? 'group'}`],
              ['all', `All (${counts.total})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`spare-grouping__filter-chip${membership === key ? ' is-active' : ''}`}
              aria-pressed={membership === key}
              onClick={() => setMembership(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="spare-grouping__actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={toggleAllVisible}
          disabled={!visibleSpares.length || busy}
        >
          {allVisibleSelected ? (
            <CheckSquare size={15} aria-hidden />
          ) : (
            <Square size={15} aria-hidden />
          )}
          {allVisibleSelected ? 'Clear selection' : `Select all (${visibleSpares.length})`}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !selectedIds.size || !selectedGroupId}
          onClick={() => void runAssign(selectedGroupId)}
        >
          Assign {selectedIds.size ? `(${selectedIds.size})` : ''} to {selectedGroup?.name ?? 'group'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || !selectedIds.size}
          onClick={() => void runAssign(null)}
        >
          Unassign {selectedIds.size ? `(${selectedIds.size})` : ''}
        </button>
      </div>

      {visibleSpares.length === 0 ? (
        <p className="text-muted spare-grouping__empty-list">No spares match these filters.</p>
      ) : (
        <div className="catalog-grid catalog-grid--tiles spare-grouping__grid" role="list">
          {visibleSpares.map((spare, index) => {
            const checked = selectedIds.has(spare.id);
            const gid = resolveGroupId(spare);
            const groupLabel = gid ? groupNameById.get(gid) ?? gid : 'Unassigned';
            return (
              <div
                key={spare.id}
                role="listitem"
                className={`spare-grouping__card-wrap${checked ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  className={`spare-grouping__card-check${checked ? ' is-selected' : ''}`}
                  onClick={() => toggleOne(spare.id)}
                  aria-pressed={checked}
                  aria-label={`${checked ? 'Deselect' : 'Select'} ${spare.name}`}
                >
                  {checked ? <CheckSquare size={15} aria-hidden /> : <Square size={15} aria-hidden />}
                </button>
                <span
                  className={`spare-grouping__card-group-badge${gid ? '' : ' is-unassigned'}`}
                >
                  {groupLabel}
                </span>
                <ProductBrowseCard
                  product={spare}
                  index={index}
                  onSelect={() => toggleOne(spare.id)}
                  showStockQuantity
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
