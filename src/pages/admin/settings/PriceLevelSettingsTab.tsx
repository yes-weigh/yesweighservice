import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Percent,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { fetchCatalog } from '../../../lib/catalog';
import { fetchDealers, fetchDealerById } from '../../../lib/dealers';
import {
  createEmptyPriceLevel,
  enforceUniqueDealerAssignments,
  loadPriceLevels,
  priceLevelsEqual,
  priceLevelsLiveSaveMs,
  savePriceLevels,
} from '../../../lib/priceLevels';
import type { CatalogCategory } from '../../../types/catalog';
import type { ZohoDealer } from '../../../types/dealers';
import type {
  PriceLevel,
  PriceLevelCategoryRule,
  PriceLevelRuleMode,
} from '../../../types/priceLevels';

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function dealerLabel(d: Pick<ZohoDealer, 'contactName' | 'companyName' | 'id'>): string {
  return (d.companyName || d.contactName || d.id).trim();
}

export const PriceLevelSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [savedLevels, setSavedLevels] = useState<PriceLevel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [dealerNames, setDealerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dealerQuery, setDealerQuery] = useState('');
  const [dealerHits, setDealerHits] = useState<ZohoDealer[]>([]);
  const [dealerSearching, setDealerSearching] = useState(false);
  const [categoryPick, setCategoryPick] = useState('');

  const levelsRef = useRef(levels);
  const savedRef = useRef(savedLevels);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveEpochRef = useRef(0);
  const userUid = user?.uid ?? null;

  levelsRef.current = levels;
  savedRef.current = savedLevels;

  const selected = useMemo(
    () => levels.find(l => l.id === selectedId) ?? null,
    [levels, selectedId],
  );

  const usedCategoryIds = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(selected.categoryRules.map(r => r.categoryId));
  }, [selected]);

  const availableCategories = useMemo(
    () => categories.filter(c => !usedCategoryIds.has(c.id)),
    [categories, usedCategoryIds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [docData, catalog] = await Promise.all([
        loadPriceLevels(),
        fetchCatalog(),
      ]);
      setLevels(docData.levels);
      setSavedLevels(docData.levels);
      setSelectedId(prev => prev && docData.levels.some(l => l.id === prev)
        ? prev
        : (docData.levels[0]?.id ?? null));
      setCategories(
        [...catalog.categories].sort((a, b) => a.name.localeCompare(b.name)),
      );

      const allDealerIds = [...new Set(docData.levels.flatMap(l => l.dealerIds))];
      if (allDealerIds.length) {
        const names: Record<string, string> = {};
        await Promise.all(allDealerIds.map(async id => {
          try {
            const d = await fetchDealerById(id);
            names[id] = dealerLabel(d);
          } catch {
            names[id] = id;
          }
        }));
        setDealerNames(names);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load price levels.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const queueSave = useCallback((nextLevels: PriceLevel[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    saveTimerRef.current = setTimeout(() => {
      const current = enforceUniqueDealerAssignments(levelsRef.current);
      if (priceLevelsEqual(current, savedRef.current)) {
        setSaveStatus(prev => (prev === 'pending' ? 'idle' : prev));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      setError('');
      void savePriceLevels(current, userUid)
        .then(saved => {
          setSavedLevels(saved.levels);
          setLevels(prev => {
            if (!priceLevelsEqual(prev, nextLevels) && !priceLevelsEqual(prev, current)) {
              return prev;
            }
            return saved.levels;
          });
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          setError(err instanceof Error ? err.message : 'Could not save price levels.');
        });
    }, priceLevelsLiveSaveMs());
  }, [userUid]);

  const patchLevels = useCallback((updater: (prev: PriceLevel[]) => PriceLevel[]) => {
    setLevels(prev => {
      const next = enforceUniqueDealerAssignments(updater(prev));
      queueSave(next);
      return next;
    });
  }, [queueSave]);

  const addLevel = () => {
    const level = createEmptyPriceLevel(`Level ${levels.length + 1}`, levels.length);
    patchLevels(prev => [...prev, level]);
    setSelectedId(level.id);
  };

  const removeLevel = (id: string) => {
    patchLevels(prev => prev.filter(l => l.id !== id));
    setSelectedId(prev => {
      if (prev !== id) return prev;
      const remaining = levels.filter(l => l.id !== id);
      return remaining[0]?.id ?? null;
    });
  };

  const updateSelected = (patch: Partial<PriceLevel>) => {
    if (!selectedId) return;
    patchLevels(prev => prev.map(l => (l.id === selectedId ? { ...l, ...patch } : l)));
  };

  const searchDealers = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 2) {
      setDealerHits([]);
      return;
    }
    setDealerSearching(true);
    try {
      const res = await fetchDealers({ q: query, limit: 12, page: 1 });
      setDealerHits(res.data || []);
    } catch {
      setDealerHits([]);
    } finally {
      setDealerSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void searchDealers(dealerQuery);
    }, 280);
    return () => clearTimeout(t);
  }, [dealerQuery, searchDealers]);

  const addDealer = (dealer: ZohoDealer) => {
    if (!selected) return;
    setDealerNames(prev => ({ ...prev, [dealer.id]: dealerLabel(dealer) }));
    patchLevels(prev => prev.map(level => {
      if (level.id === selected.id) {
        if (level.dealerIds.includes(dealer.id)) return level;
        return { ...level, dealerIds: [...level.dealerIds, dealer.id] };
      }
      return {
        ...level,
        dealerIds: level.dealerIds.filter(id => id !== dealer.id),
      };
    }));
    setDealerQuery('');
    setDealerHits([]);
  };

  const removeDealer = (dealerId: string) => {
    if (!selected) return;
    updateSelected({
      dealerIds: selected.dealerIds.filter(id => id !== dealerId),
    });
  };

  const addCategoryRule = () => {
    if (!selected || !categoryPick) return;
    const cat = categories.find(c => c.id === categoryPick);
    if (!cat || selected.categoryRules.some(r => r.categoryId === cat.id)) return;
    const rule: PriceLevelCategoryRule = {
      categoryId: cat.id,
      categoryName: cat.name,
      mode: 'discount',
      percent: 0,
    };
    updateSelected({ categoryRules: [...selected.categoryRules, rule] });
    setCategoryPick('');
  };

  const updateRule = (
    categoryId: string,
    patch: Partial<Pick<PriceLevelCategoryRule, 'mode' | 'percent'>>,
  ) => {
    if (!selected) return;
    updateSelected({
      categoryRules: selected.categoryRules.map(r => (
        r.categoryId === categoryId ? { ...r, ...patch } : r
      )),
    });
  };

  const removeRule = (categoryId: string) => {
    if (!selected) return;
    updateSelected({
      categoryRules: selected.categoryRules.filter(r => r.categoryId !== categoryId),
    });
  };

  const saveLabel = saveStatus === 'saving' || saveStatus === 'pending'
    ? 'Saving…'
    : saveStatus === 'saved'
      ? 'Saved'
      : saveStatus === 'error'
        ? 'Save failed'
        : '';

  if (loading) {
    return (
      <div className="panel glass price-levels-tab price-levels-tab--loading">
        <Loader2 className="spin-icon" size={22} aria-hidden />
        <p className="text-muted">Loading price levels…</p>
      </div>
    );
  }

  return (
    <div className="panel glass price-levels-tab">
      <header className="price-levels-tab__header">
        <div>
          <h3>Price level setting</h3>
          <p className="text-muted text-sm">
            Create levels, assign dealers, and set category discount or price hike %.
            Changes save automatically.
          </p>
        </div>
        {saveLabel ? (
          <span
            className={`price-levels-tab__save ${
              saveStatus === 'error' ? 'is-error' : saveStatus === 'saved' ? 'is-saved' : ''
            }`}
          >
            {saveStatus === 'saved' ? <Check size={14} aria-hidden /> : null}
            {(saveStatus === 'saving' || saveStatus === 'pending')
              ? <Loader2 size={14} className="spin-icon" aria-hidden />
              : null}
            {saveLabel}
          </span>
        ) : null}
      </header>

      {error ? <p className="price-levels-tab__error">{error}</p> : null}

      <div className="price-levels-tab__layout">
        <aside className="price-levels-tab__levels">
          <div className="price-levels-tab__levels-head">
            <span>Levels</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={addLevel}>
              <Plus size={14} aria-hidden />
              Add
            </button>
          </div>
          {levels.length === 0 ? (
            <p className="text-muted text-sm price-levels-tab__empty">
              No levels yet. Add one (e.g. Directors, Agents, Dealers).
            </p>
          ) : (
            <ul className="price-levels-tab__level-list">
              {levels.map(level => (
                <li key={level.id}>
                  <button
                    type="button"
                    className={`price-levels-tab__level-btn ${
                      level.id === selectedId ? 'is-active' : ''
                    }`}
                    onClick={() => setSelectedId(level.id)}
                  >
                    <Users size={15} aria-hidden />
                    <span className="price-levels-tab__level-name">{level.name}</span>
                    <span className="price-levels-tab__level-meta">
                      {level.dealerIds.length} dealers · {level.categoryRules.length} rules
                    </span>
                  </button>
                  <button
                    type="button"
                    className="price-levels-tab__level-delete"
                    title="Delete level"
                    aria-label={`Delete ${level.name}`}
                    onClick={() => removeLevel(level.id)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="price-levels-tab__detail">
          {!selected ? (
            <p className="text-muted">Select or create a level to edit.</p>
          ) : (
            <>
              <label className="price-levels-tab__field">
                <span>Level name</span>
                <input
                  type="text"
                  value={selected.name}
                  onChange={e => updateSelected({ name: e.target.value })}
                  placeholder="e.g. Directors"
                />
              </label>

              <div className="price-levels-tab__block">
                <h4>
                  <UserPlus size={16} aria-hidden />
                  Dealers in this level
                </h4>
                <div className="price-levels-tab__dealer-search">
                  <Search size={16} aria-hidden />
                  <input
                    type="search"
                    value={dealerQuery}
                    onChange={e => setDealerQuery(e.target.value)}
                    placeholder="Search dealers by name, company, phone…"
                    autoComplete="off"
                  />
                  {dealerSearching ? <Loader2 size={14} className="spin-icon" aria-hidden /> : null}
                </div>
                {dealerHits.length > 0 ? (
                  <ul className="price-levels-tab__dealer-hits">
                    {dealerHits.map(d => {
                      const already = selected.dealerIds.includes(d.id);
                      return (
                        <li key={d.id}>
                          <button
                            type="button"
                            disabled={already}
                            onClick={() => addDealer(d)}
                          >
                            <strong>{dealerLabel(d)}</strong>
                            <span className="text-muted text-sm">
                              {[d.contactName, d.phone || d.mobile].filter(Boolean).join(' · ')}
                            </span>
                            {already ? <span className="text-muted">Added</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {selected.dealerIds.length === 0 ? (
                  <p className="text-muted text-sm">No dealers assigned yet.</p>
                ) : (
                  <ul className="price-levels-tab__dealer-chips">
                    {selected.dealerIds.map(id => (
                      <li key={id}>
                        <span>{dealerNames[id] || id}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${dealerNames[id] || id}`}
                          onClick={() => removeDealer(id)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="price-levels-tab__block">
                <h4>
                  <Percent size={16} aria-hidden />
                  Category pricing rules
                </h4>
                <p className="text-muted text-sm">
                  Discount shows list + “for you” price to the dealer. Increment shows only
                  the hiked charge price.
                </p>
                <div className="price-levels-tab__add-rule">
                  <select
                    value={categoryPick}
                    onChange={e => setCategoryPick(e.target.value)}
                  >
                    <option value="">Select category…</option>
                    {availableCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!categoryPick}
                    onClick={addCategoryRule}
                  >
                    <Plus size={14} aria-hidden />
                    Add rule
                  </button>
                </div>

                {selected.categoryRules.length === 0 ? (
                  <p className="text-muted text-sm">No category rules yet.</p>
                ) : (
                  <ul className="price-levels-tab__rules">
                    {selected.categoryRules.map(rule => (
                      <li key={rule.categoryId}>
                        <span className="price-levels-tab__rule-cat">
                          {rule.categoryName || rule.categoryId}
                        </span>
                        <select
                          value={rule.mode}
                          onChange={e => updateRule(rule.categoryId, {
                            mode: e.target.value as PriceLevelRuleMode,
                          })}
                          aria-label="Rule type"
                        >
                          <option value="discount">Discount %</option>
                          <option value="increment">Price hike %</option>
                        </select>
                        <label className="price-levels-tab__percent">
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            step={0.1}
                            value={rule.percent === 0 ? '' : rule.percent}
                            placeholder="0"
                            onChange={e => {
                              const v = e.target.value;
                              updateRule(rule.categoryId, {
                                percent: v === '' ? 0 : Number(v),
                              });
                            }}
                          />
                          <span>%</span>
                        </label>
                        <button
                          type="button"
                          className="price-levels-tab__rule-delete"
                          aria-label={`Remove rule for ${rule.categoryName}`}
                          onClick={() => removeRule(rule.categoryId)}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
