import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  DEFAULT_MRP_RULES,
  MRP_FORMULA_OPTIONS,
  type CatalogMrpFormulaId,
  type CatalogMrpRules,
} from '../../../constants/catalogProductSettings';
import {
  loadCatalogProductSettings,
  normalizeMrpFormulaId,
  normalizeMrpMultiplier,
  saveMasterCartonQuantities,
  saveMrpRules,
} from '../../../lib/catalogProductSettings';
import { calculateProductMrpBreakdown, getMrpFormulaOption } from '../../../lib/catalogMrp';

type MrpDraftGroup = {
  formula: CatalogMrpFormulaId;
  multiplier: string;
};

type MrpDraft = {
  categorized: MrpDraftGroup;
  generic: MrpDraftGroup;
};

type MrpTestDraft = {
  rate: string;
  taxPercent: string;
};

const DEFAULT_MRP_TEST: MrpTestDraft = { rate: '100', taxPercent: '18' };

function toDraft(rules: CatalogMrpRules): MrpDraft {
  return {
    categorized: {
      formula: rules.categorized.formula,
      multiplier: String(rules.categorized.multiplier),
    },
    generic: {
      formula: rules.genericAndUncategorized.formula,
      multiplier: String(rules.genericAndUncategorized.multiplier),
    },
  };
}

function groupNeedsMultiplier(formula: CatalogMrpFormulaId): boolean {
  return formula !== 'gstOnly';
}

function resolveDraftGroupRule(draft: MrpDraftGroup) {
  const multiplier = normalizeMrpMultiplier(
    draft.multiplier,
    DEFAULT_MRP_RULES.categorized.multiplier,
  );
  return {
    formula: draft.formula,
    multiplier: groupNeedsMultiplier(draft.formula) ? multiplier : 1,
  };
}

function MrpGroupEditor({
  title,
  draft,
  test,
  disabled,
  onChange,
  onTestChange,
}: {
  title: string;
  draft: MrpDraftGroup;
  test: MrpTestDraft;
  disabled: boolean;
  onChange: (next: MrpDraftGroup) => void;
  onTestChange: (next: MrpTestDraft) => void;
}) {
  const option = getMrpFormulaOption(draft.formula);
  const showMultiplier = groupNeedsMultiplier(draft.formula);
  const rate = Number(test.rate);
  const taxPercent = Number(test.taxPercent);
  const rule = resolveDraftGroupRule(draft);
  const canPreview = Number.isFinite(rate) && rate >= 0
    && Number.isFinite(taxPercent) && taxPercent >= 0
    && rule.multiplier > 0;
  const preview = canPreview
    ? calculateProductMrpBreakdown(rate, taxPercent, rule)
    : null;

  return (
    <div className="settings-product-mrp__group">
      <h5 className="settings-product-mrp__group-title">{title}</h5>

      <label className="settings-locations__field">
        <span>Equation</span>
        <select
          value={draft.formula}
          disabled={disabled}
          onChange={e =>
            onChange({
              ...draft,
              formula: normalizeMrpFormulaId(e.target.value, draft.formula),
            })
          }
          aria-label={`${title} equation`}
        >
          {MRP_FORMULA_OPTIONS.map(opt => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-product-mrp__formula">
        <code>{option.expression}</code>
      </div>

      {showMultiplier && (
        <label className="settings-locations__field">
          <span>Mult</span>
          <input
            type="number"
            min={0.001}
            step={0.1}
            value={draft.multiplier}
            onChange={e => onChange({ ...draft, multiplier: e.target.value })}
            disabled={disabled}
            aria-label={`${title} multiplier`}
          />
        </label>
      )}

      <div className="settings-product-mrp__test">
        <div className="settings-product-mrp__test-grid">
          <label className="settings-locations__field">
            <span>Rate</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={test.rate}
              onChange={e => onTestChange({ ...test, rate: e.target.value })}
              disabled={disabled}
              aria-label={`${title} test rate`}
            />
          </label>
          <label className="settings-locations__field">
            <span>Tax%</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={test.taxPercent}
              onChange={e => onTestChange({ ...test, taxPercent: e.target.value })}
              disabled={disabled}
              aria-label={`${title} test tax percent`}
            />
          </label>
        </div>
        {preview ? (
          <div className="settings-product-mrp__test-result" aria-live="polite">
            <div className="settings-product-mrp__test-result-main">
              <span className="text-muted text-sm">MRP</span>
              <strong>₹ {preview.mrpInclGst.toFixed(2)}</strong>
            </div>
            <p className="settings-product-mrp__test-result-sub text-muted text-sm">
              ₹ {preview.mrpExclGst.toFixed(2)}
              {preview.taxPercentage > 0
                ? ` + ${preview.taxPercentage}% ₹ ${preview.mrpGst.toFixed(2)}`
                : ''}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ProductSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [quantities, setQuantities] = useState<number[]>([]);
  const [mrpRules, setMrpRules] = useState<CatalogMrpRules>({
    categorized: { ...DEFAULT_MRP_RULES.categorized },
    genericAndUncategorized: { ...DEFAULT_MRP_RULES.genericAndUncategorized },
  });
  const [mrpDraft, setMrpDraft] = useState<MrpDraft>(() => toDraft(DEFAULT_MRP_RULES));
  const [mrpTest, setMrpTest] = useState<{ categorized: MrpTestDraft; generic: MrpTestDraft }>({
    categorized: { ...DEFAULT_MRP_TEST },
    generic: { ...DEFAULT_MRP_TEST },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newQty, setNewQty] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await loadCatalogProductSettings();
      setQuantities(settings.masterCartonQuantities);
      setMrpRules(settings.mrpRules);
      setMrpDraft(toDraft(settings.mrpRules));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load product settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const sortedQuantities = useMemo(
    () => [...quantities].sort((a, b) => a - b),
    [quantities],
  );

  const parsedDraftRules = (() => {
    const categorizedMult = Number(mrpDraft.categorized.multiplier);
    const genericMult = Number(mrpDraft.generic.multiplier);
    if (groupNeedsMultiplier(mrpDraft.categorized.formula)) {
      if (!Number.isFinite(categorizedMult) || categorizedMult <= 0) return null;
    }
    if (groupNeedsMultiplier(mrpDraft.generic.formula)) {
      if (!Number.isFinite(genericMult) || genericMult <= 0) return null;
    }

    return {
      categorized: {
        formula: mrpDraft.categorized.formula,
        multiplier: groupNeedsMultiplier(mrpDraft.categorized.formula)
          ? normalizeMrpMultiplier(categorizedMult, DEFAULT_MRP_RULES.categorized.multiplier)
          : DEFAULT_MRP_RULES.categorized.multiplier,
      },
      genericAndUncategorized: {
        formula: mrpDraft.generic.formula,
        multiplier: groupNeedsMultiplier(mrpDraft.generic.formula)
          ? normalizeMrpMultiplier(genericMult, DEFAULT_MRP_RULES.genericAndUncategorized.multiplier)
          : DEFAULT_MRP_RULES.genericAndUncategorized.multiplier,
      },
    } satisfies CatalogMrpRules;
  })();

  const mrpDirty = !parsedDraftRules
    || parsedDraftRules.categorized.formula !== mrpRules.categorized.formula
    || parsedDraftRules.categorized.multiplier !== mrpRules.categorized.multiplier
    || parsedDraftRules.genericAndUncategorized.formula !== mrpRules.genericAndUncategorized.formula
    || parsedDraftRules.genericAndUncategorized.multiplier !== mrpRules.genericAndUncategorized.multiplier;

  const persistQty = async (next: number[], busy: string) => {
    setBusyKey(busy);
    setError('');
    setSuccess('');
    try {
      const saved = await saveMasterCartonQuantities(next, user?.uid ?? null);
      setQuantities(saved);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product settings.');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleAdd = async () => {
    const trimmed = newQty.trim();
    if (!trimmed) {
      setError('Enter a quantity to add.');
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      setError('Quantity must be a whole number greater than zero.');
      return;
    }
    if (quantities.includes(value)) {
      setError(`${value} is already in the list.`);
      return;
    }

    const ok = await persistQty([...quantities, value], `add-${value}`);
    if (ok) setNewQty('');
  };

  const handleRemove = async (value: number) => {
    if (quantities.length <= 1) {
      setError('Keep at least one master carton quantity.');
      return;
    }
    await persistQty(
      quantities.filter(qty => qty !== value),
      `remove-${value}`,
    );
  };

  const handleSaveMrp = async () => {
    if (!parsedDraftRules) {
      setError('Each multiplier must be a number greater than zero.');
      return;
    }

    setBusyKey('mrp');
    setError('');
    setSuccess('');
    try {
      const saved = await saveMrpRules(parsedDraftRules, user?.uid ?? null);
      setMrpRules(saved);
      setMrpDraft(toDraft(saved));
      setSuccess('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save MRP equations.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Product settings</h3>
          <p className="text-muted text-sm">
            Carton qty and MRP for share cards / labels.
          </p>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}
      {success && <p className="settings-locations__success text-sm">{success}</p>}

      <div className="settings-product-qty">
        <div className="settings-product-qty__section">
          <h4 className="settings-product-qty__title">Master carton qty</h4>
          <p className="settings-product-qty__hint text-muted text-sm">
            Options for package info.
          </p>

          {loading ? (
            <div className="settings-locations__loading">
              <div className="loader-ring" />
            </div>
          ) : (
            <>
              <div className="settings-product-qty__chips" aria-label="Master carton quantities">
                {sortedQuantities.map(qty => (
                  <span key={qty} className="settings-product-qty__chip">
                    <span>{qty}</span>
                    <button
                      type="button"
                      className="settings-product-qty__chip-remove"
                      onClick={() => void handleRemove(qty)}
                      disabled={busyKey != null || sortedQuantities.length <= 1}
                      aria-label={`Remove ${qty}`}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>

              <div className="settings-locations__add-form settings-product-qty__add-form">
                <label className="settings-locations__field">
                  <span>Add quantity</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={newQty}
                    placeholder="e.g. 10"
                    onChange={e => setNewQty(e.target.value)}
                    disabled={busyKey != null}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAdd();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyKey != null || !newQty.trim()}
                  onClick={() => void handleAdd()}
                >
                  <Plus size={15} aria-hidden />
                  Add
                </button>
              </div>
            </>
          )}
        </div>

        <div className="settings-product-qty__section settings-product-mrp">
          <h4 className="settings-product-qty__title">MRP</h4>
          <p className="settings-product-qty__hint text-muted text-sm">
            a + 18% = a + a×18/100. Tax from Zoho.
          </p>

          {loading ? (
            <div className="settings-locations__loading">
              <div className="loader-ring" />
            </div>
          ) : (
            <>
              <div className="settings-product-mrp__grid">
                <MrpGroupEditor
                  title="Shop (categorized)"
                  draft={mrpDraft.categorized}
                  test={mrpTest.categorized}
                  disabled={busyKey != null}
                  onChange={categorized => setMrpDraft(prev => ({ ...prev, categorized }))}
                  onTestChange={categorized => setMrpTest(prev => ({ ...prev, categorized }))}
                />
                <MrpGroupEditor
                  title="Generic / uncategorized"
                  draft={mrpDraft.generic}
                  test={mrpTest.generic}
                  disabled={busyKey != null}
                  onChange={generic => setMrpDraft(prev => ({ ...prev, generic }))}
                  onTestChange={generic => setMrpTest(prev => ({ ...prev, generic }))}
                />
              </div>

              <div className="settings-product-mrp__actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyKey != null || !mrpDirty}
                  onClick={() => void handleSaveMrp()}
                >
                  <Save size={15} aria-hidden />
                  {busyKey === 'mrp' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>

        {!loading && sortedQuantities.length === 0 && (
          <div className="settings-locations__empty">
            <Package size={28} aria-hidden />
            <p>No master carton quantities configured yet.</p>
          </div>
        )}
      </div>
    </section>
  );
};
