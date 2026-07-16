import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Package, Paperclip, Plus, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import {
  DEFAULT_MRP_RULES,
  MRP_FORMULA_OPTIONS,
  type CatalogApprovalNumberOption,
  type CatalogMrpFormulaId,
  type CatalogMrpRules,
} from '../../../constants/catalogProductSettings';
import {
  attachApprovalNumberPdf,
  loadCatalogProductSettings,
  normalizeMrpFormulaId,
  normalizeMrpMultiplier,
  removeApprovalNumber,
  removeApprovalNumberPdf,
  saveApprovalNumbers,
  saveMasterCartonQuantities,
  saveModelNumbers,
  saveMrpRules,
  saveSpareGroups,
  slugifySpareGroupId,
  spareGroupHasLinkedSpares,
  type CatalogSpareGroupOption,
} from '../../../lib/catalogProductSettings';
import { calculateProductMrpBreakdown, getMrpFormulaOption } from '../../../lib/catalogMrp';
import { PushFirebaseImagesToZohoSection } from './PushFirebaseImagesToZohoSection';

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

type ProductSettingsSubTab = 'packaging' | 'model-approval' | 'spare-groups' | 'images';

const PRODUCT_SETTINGS_SUBTABS: { id: ProductSettingsSubTab; label: string }[] = [
  { id: 'packaging', label: 'Carton & MRP' },
  { id: 'model-approval', label: 'Model & approval' },
  { id: 'spare-groups', label: 'Spare groups' },
  { id: 'images', label: 'Images' },
];

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
  const confirm = useConfirm();
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
  const [modelNumbers, setModelNumbers] = useState<string[]>([]);
  const [approvalNumbers, setApprovalNumbers] = useState<CatalogApprovalNumberOption[]>([]);
  const [spareGroups, setSpareGroups] = useState<CatalogSpareGroupOption[]>([]);
  const [newModel, setNewModel] = useState('');
  const [newApproval, setNewApproval] = useState('');
  const [newSpareGroup, setNewSpareGroup] = useState('');
  const [editingSpareGroupId, setEditingSpareGroupId] = useState<string | null>(null);
  const [editingSpareGroupName, setEditingSpareGroupName] = useState('');
  const [subTab, setSubTab] = useState<ProductSettingsSubTab>('packaging');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newQty, setNewQty] = useState('');
  const approvalPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingPdfApproval, setPendingPdfApproval] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await loadCatalogProductSettings();
      setQuantities(settings.masterCartonQuantities);
      setMrpRules(settings.mrpRules);
      setMrpDraft(toDraft(settings.mrpRules));
      setModelNumbers(settings.modelNumbers);
      setApprovalNumbers(settings.approvalNumbers);
      setSpareGroups(settings.spareGroups);
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

  const persistModelNumbers = async (next: string[], busy: string) => {
    setBusyKey(busy);
    setError('');
    setSuccess('');
    try {
      setModelNumbers(await saveModelNumbers(next, user?.uid ?? null));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save options.');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddModelNumber = async () => {
    const value = newModel.trim();
    if (!value) {
      setError('Enter a value to add.');
      return;
    }
    if (modelNumbers.some(item => item.toLowerCase() === value.toLowerCase())) {
      setError(`${value} is already in the list.`);
      return;
    }
    const ok = await persistModelNumbers([...modelNumbers, value], `add-model-${value}`);
    if (ok) setNewModel('');
  };

  const handleRemoveModelNumber = async (value: string) => {
    const ok = await confirm({
      title: 'Remove model number?',
      message: `Delete “${value}” from the model number list? Products already using it are not changed.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await persistModelNumbers(
      modelNumbers.filter(item => item !== value),
      `remove-model-${value}`,
    );
  };

  const persistSpareGroups = async (next: CatalogSpareGroupOption[], busy: string) => {
    setBusyKey(busy);
    setError('');
    setSuccess('');
    try {
      setSpareGroups(await saveSpareGroups(next, user?.uid ?? null));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save spare groups.');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddSpareGroup = async () => {
    const name = newSpareGroup.trim();
    if (!name) {
      setError('Enter a spare group name.');
      return;
    }
    if (spareGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      setError(`${name} already exists.`);
      return;
    }
    let id = slugifySpareGroupId(name);
    const usedIds = new Set(spareGroups.map(g => g.id));
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    const ok = await persistSpareGroups([...spareGroups, { id, name }], `add-spare-group-${id}`);
    if (ok) setNewSpareGroup('');
  };

  const handleRenameSpareGroup = async (groupId: string) => {
    const name = editingSpareGroupName.trim();
    if (!name) {
      setError('Group name cannot be empty.');
      return;
    }
    if (
      spareGroups.some(
        g => g.id !== groupId && g.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError(`${name} already exists.`);
      return;
    }
    const next = spareGroups.map(g => (g.id === groupId ? { ...g, name } : g));
    const ok = await persistSpareGroups(next, `rename-spare-group-${groupId}`);
    if (ok) {
      setEditingSpareGroupId(null);
      setEditingSpareGroupName('');
    }
  };

  const handleRemoveSpareGroup = async (group: CatalogSpareGroupOption) => {
    setBusyKey(`remove-spare-group-${group.id}`);
    setError('');
    setSuccess('');
    try {
      if (await spareGroupHasLinkedSpares(group.id)) {
        setError(`Cannot delete “${group.name}” — spares are still assigned to it.`);
        return;
      }
      await persistSpareGroups(
        spareGroups.filter(g => g.id !== group.id),
        `remove-spare-group-${group.id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove spare group.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddApproval = async () => {
    const value = newApproval.trim();
    if (!value) {
      setError('Enter an approval number to add.');
      return;
    }
    if (approvalNumbers.some(item => item.value.toLowerCase() === value.toLowerCase())) {
      setError(`${value} is already in the list.`);
      return;
    }
    setBusyKey(`add-approval-${value}`);
    setError('');
    setSuccess('');
    try {
      setApprovalNumbers(await saveApprovalNumbers(
        [...approvalNumbers, { value }],
        user?.uid ?? null,
      ));
      setNewApproval('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save approval number.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveApproval = async (value: string) => {
    const option = approvalNumbers.find(item => item.value === value);
    const ok = await confirm({
      title: 'Remove approval number?',
      message: option?.pdfUrl
        ? `Delete “${value}” and its attached PDF? Products already using it are not changed.`
        : `Delete “${value}” from the approval number list? Products already using it are not changed.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setBusyKey(`remove-approval-${value}`);
    setError('');
    setSuccess('');
    try {
      setApprovalNumbers(await removeApprovalNumber(value, user?.uid ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove approval number.');
    } finally {
      setBusyKey(null);
    }
  };

  const handlePickApprovalPdf = (value: string) => {
    setPendingPdfApproval(value);
    approvalPdfInputRef.current?.click();
  };

  const handleApprovalPdfSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const approvalValue = pendingPdfApproval;
    setPendingPdfApproval(null);
    if (!file || !approvalValue) return;

    setBusyKey(`pdf-approval-${approvalValue}`);
    setError('');
    setSuccess('');
    try {
      setApprovalNumbers(await attachApprovalNumberPdf(
        approvalValue,
        file,
        user?.uid ?? null,
      ));
      setSuccess(`PDF attached to ${approvalValue}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload PDF.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveApprovalPdf = async (value: string) => {
    setBusyKey(`pdf-remove-${value}`);
    setError('');
    setSuccess('');
    try {
      setApprovalNumbers(await removeApprovalNumberPdf(value, user?.uid ?? null));
      setSuccess(`PDF removed from ${value}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove PDF.');
    } finally {
      setBusyKey(null);
    }
  };

  const renderModelOptionSection = () => (
    <div className="settings-product-qty__section">
      <h4 className="settings-product-qty__title">Model numbers</h4>
      {!loading && (
        <>
          <div className="settings-product-qty__chips" aria-label="Model numbers">
            {modelNumbers.map(value => (
              <span key={value} className="settings-product-qty__chip">
                <span>{value}</span>
                <button
                  type="button"
                  className="settings-product-qty__chip-remove"
                  onClick={() => void handleRemoveModelNumber(value)}
                  disabled={busyKey != null}
                  aria-label={`Remove ${value}`}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </span>
            ))}
          </div>
          <div className="settings-locations__add-form settings-product-qty__add-form">
            <label className="settings-locations__field">
              <span>Add</span>
              <input
                type="text"
                value={newModel}
                placeholder="e.g. option"
                onChange={e => setNewModel(e.target.value)}
                disabled={busyKey != null}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddModelNumber();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyKey != null || !newModel.trim()}
              onClick={() => void handleAddModelNumber()}
            >
              <Plus size={15} aria-hidden />
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );

  const renderSpareGroupSection = () => (
    <div className="settings-product-qty__section">
      <h4 className="settings-product-qty__title">Spare groups</h4>
      <p className="settings-product-qty__hint text-muted text-sm">
        Name-only groups for Generic spare parts and uncategorized items. Delete is blocked while spares are assigned.
      </p>
      {!loading && (
        <>
          <div className="settings-product-spare-groups" aria-label="Spare groups">
            {spareGroups.length === 0 && (
              <p className="text-muted text-sm">No spare groups yet.</p>
            )}
            {spareGroups.map(group => (
              <div key={group.id} className="settings-product-spare-groups__row">
                {editingSpareGroupId === group.id ? (
                  <>
                    <input
                      type="text"
                      className="settings-product-spare-groups__rename-input"
                      value={editingSpareGroupName}
                      onChange={e => setEditingSpareGroupName(e.target.value)}
                      disabled={busyKey != null}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleRenameSpareGroup(group.id);
                        }
                        if (e.key === 'Escape') {
                          setEditingSpareGroupId(null);
                          setEditingSpareGroupName('');
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey != null || !editingSpareGroupName.trim()}
                      onClick={() => void handleRenameSpareGroup(group.id)}
                    >
                      <Save size={13} aria-hidden />
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null}
                      onClick={() => {
                        setEditingSpareGroupId(null);
                        setEditingSpareGroupName('');
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="settings-product-spare-groups__name">{group.name}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null}
                      onClick={() => {
                        setEditingSpareGroupId(group.id);
                        setEditingSpareGroupName(group.name);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="settings-product-qty__chip-remove"
                      onClick={() => void handleRemoveSpareGroup(group)}
                      disabled={busyKey != null}
                      aria-label={`Remove ${group.name}`}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="settings-locations__add-form settings-product-qty__add-form">
            <label className="settings-locations__field">
              <span>Add</span>
              <input
                type="text"
                value={newSpareGroup}
                placeholder="e.g. Load cell"
                onChange={e => setNewSpareGroup(e.target.value)}
                disabled={busyKey != null}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddSpareGroup();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyKey != null || !newSpareGroup.trim()}
              onClick={() => void handleAddSpareGroup()}
            >
              <Plus size={15} aria-hidden />
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );

  const renderApprovalOptionSection = () => (
    <div className="settings-product-qty__section">
      <h4 className="settings-product-qty__title">Approval numbers</h4>
      <p className="settings-product-qty__hint text-muted text-sm">
        Optional PDF certificate per approval number.
      </p>
      <input
        ref={approvalPdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="settings-product-approval__file-input"
        aria-hidden
        tabIndex={-1}
        onChange={e => void handleApprovalPdfSelected(e)}
      />
      {!loading && (
        <>
          <div className="settings-product-approval__list" aria-label="Approval numbers">
            {approvalNumbers.map(option => (
              <div key={option.value} className="settings-product-approval__row">
                <div className="settings-product-approval__main">
                  <span className="settings-product-approval__value">{option.value}</span>
                  {option.pdfUrl ? (
                    <a
                      href={option.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="settings-product-approval__pdf-link"
                    >
                      <FileText size={14} aria-hidden />
                      {option.pdfFileName || 'View PDF'}
                    </a>
                  ) : (
                    <span className="settings-product-approval__pdf-empty text-muted text-sm">
                      No PDF
                    </span>
                  )}
                </div>
                <div className="settings-product-approval__actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busyKey != null}
                    onClick={() => handlePickApprovalPdf(option.value)}
                    aria-label={`Attach PDF to ${option.value}`}
                  >
                    <Paperclip size={14} aria-hidden />
                    {option.pdfUrl ? 'Replace PDF' : 'Attach PDF'}
                  </button>
                  {option.pdfUrl && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyKey != null}
                      onClick={() => void handleRemoveApprovalPdf(option.value)}
                      aria-label={`Remove PDF from ${option.value}`}
                    >
                      <X size={14} aria-hidden />
                      Remove PDF
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-product-qty__chip-remove"
                    onClick={() => void handleRemoveApproval(option.value)}
                    disabled={busyKey != null}
                    aria-label={`Remove ${option.value}`}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="settings-locations__add-form settings-product-qty__add-form">
            <label className="settings-locations__field">
              <span>Add</span>
              <input
                type="text"
                value={newApproval}
                placeholder="e.g. IND/09/21/134"
                onChange={e => setNewApproval(e.target.value)}
                disabled={busyKey != null}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddApproval();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyKey != null || !newApproval.trim()}
              onClick={() => void handleAddApproval()}
            >
              <Plus size={15} aria-hidden />
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Product settings</h3>
          <p className="text-muted text-sm">
            Carton qty, MRP, model & approval options, spare groups, and image tools.
          </p>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}
      {success && <p className="settings-locations__success text-sm">{success}</p>}

      <div
        className="settings-sku-correction__subtabs settings-product__subtabs"
        role="tablist"
        aria-label="Product settings sections"
      >
        {PRODUCT_SETTINGS_SUBTABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            className={`settings-sku-correction__subtab ${subTab === tab.id ? 'is-active' : ''}`}
            onClick={() => {
              setSubTab(tab.id);
              setError('');
              setSuccess('');
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-product-qty">
        {subTab === 'packaging' && (
          <>
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
          </>
        )}

        {subTab === 'model-approval' && (
          <>
            {renderModelOptionSection()}
            {renderApprovalOptionSection()}
          </>
        )}
        {subTab === 'spare-groups' && renderSpareGroupSection()}
        {subTab === 'images' && <PushFirebaseImagesToZohoSection />}
      </div>
    </section>
  );
};
