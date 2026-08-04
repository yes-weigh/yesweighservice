import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { DecimalTextInput } from '../DecimalAmountInput';
import { formatStockQuantity, updateCatalogProductPackageInfo } from '../../lib/catalog';
import { loadMasterCartonQuantities } from '../../lib/catalogProductSettings';
import type { CatalogPackageCarton, CatalogPackageInfo, CatalogProduct } from '../../types/catalog';

const MASTER_CARTON_COLUMNS = [
  { key: 'quantity' as const, label: 'Qty' },
  { key: 'weightKg' as const, label: 'Weight (kg)' },
  { key: 'lengthCm' as const, label: 'L (cm)' },
  { key: 'breadthCm' as const, label: 'B (cm)' },
  { key: 'heightCm' as const, label: 'H (cm)' },
];

/** Single box is physical dimensions only — no per-package qty. */
const SINGLE_BOX_COLUMNS = [
  { key: 'weightKg' as const, label: 'Weight (kg)' },
  { key: 'lengthCm' as const, label: 'L (cm)' },
  { key: 'breadthCm' as const, label: 'B (cm)' },
  { key: 'heightCm' as const, label: 'H (cm)' },
];

type CartonColumnKey = (typeof MASTER_CARTON_COLUMNS)[number]['key'];
type CartonColumn = { key: CartonColumnKey; label: string };

type EditableCarton = {
  quantity: string;
  weightKg: string;
  lengthCm: string;
  breadthCm: string;
  heightCm: string;
};

type PackageForm = {
  masterCarton: EditableCarton;
  singleBox: EditableCarton[];
};

function emptyEditableCarton(): EditableCarton {
  return {
    quantity: '',
    weightKg: '',
    lengthCm: '',
    breadthCm: '',
    heightCm: '',
  };
}

function cartonToEditable(carton: CatalogPackageCarton | null | undefined): EditableCarton {
  if (!carton) return emptyEditableCarton();
  return {
    quantity: carton.quantity != null ? String(carton.quantity) : '',
    weightKg: carton.weightKg != null ? String(carton.weightKg) : '',
    lengthCm: carton.lengthCm != null ? String(carton.lengthCm) : '',
    breadthCm: carton.breadthCm != null ? String(carton.breadthCm) : '',
    heightCm: carton.heightCm != null ? String(carton.heightCm) : '',
  };
}

function packageInfoToForm(info: CatalogPackageInfo | null | undefined): PackageForm {
  const boxes = info?.singleBox?.length
    ? info.singleBox.map(cartonToEditable)
    : [emptyEditableCarton()];
  return {
    masterCarton: cartonToEditable(info?.masterCarton),
    singleBox: boxes,
  };
}

function parseEditableCarton(form: EditableCarton): CatalogPackageCarton | null {
  const parseNum = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  const parseQty = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && Number.isInteger(num) && num > 0 ? num : null;
  };

  const quantity = parseQty(form.quantity);
  const weightKg = parseNum(form.weightKg);
  const lengthCm = parseNum(form.lengthCm);
  const breadthCm = parseNum(form.breadthCm);
  const heightCm = parseNum(form.heightCm);
  const hasValue = [quantity, weightKg, lengthCm, breadthCm, heightCm].some(v => v != null);
  if (!hasValue) return null;

  return { quantity, weightKg, lengthCm, breadthCm, heightCm };
}

function parseEditableSingleBoxes(rows: EditableCarton[]): CatalogPackageCarton[] | null {
  const boxes: CatalogPackageCarton[] = [];
  for (const row of rows) {
    const parsed = parseEditableCarton({ ...row, quantity: '' });
    if (!parsed) continue;
    boxes.push({
      quantity: null,
      weightKg: parsed.weightKg,
      lengthCm: parsed.lengthCm,
      breadthCm: parsed.breadthCm,
      heightCm: parsed.heightCm,
    });
  }
  return boxes.length ? boxes : null;
}

/** Complete single-box row: weight + L/B/H all > 0. */
function singleBoxRowComplete(row: EditableCarton): boolean {
  const parseNum = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  return [row.weightKg, row.lengthCm, row.breadthCm, row.heightCm]
    .every(value => parseNum(value) != null);
}

function hasCompleteSingleBox(rows: EditableCarton[]): boolean {
  return rows.some(singleBoxRowComplete);
}

function formatWeight(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatDimension(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

const EDIT_FIELD_META: Record<
  keyof EditableCarton,
  { placeholder: string; label: string; step: string; min: number }
> = {
  quantity: { placeholder: 'pc', label: 'Quantity per package', step: '1', min: 1 },
  weightKg: { placeholder: 'kg', label: 'Weight in kg', step: '0.01', min: 0 },
  lengthCm: { placeholder: '', label: 'Length in cm', step: '0.1', min: 0 },
  breadthCm: { placeholder: '', label: 'Breadth in cm', step: '0.1', min: 0 },
  heightCm: { placeholder: '', label: 'Height in cm', step: '0.1', min: 0 },
};

function cartonDisplayValue(
  carton: CatalogPackageCarton | null | undefined,
  key: keyof EditableCarton,
  product: CatalogProduct,
): string {
  if (key === 'quantity') {
    return carton?.quantity != null
      ? formatStockQuantity(carton.quantity, product.unit)
      : '—';
  }
  if (key === 'weightKg') return formatWeight(carton?.weightKg);
  if (key === 'lengthCm') return formatDimension(carton?.lengthCm);
  if (key === 'breadthCm') return formatDimension(carton?.breadthCm);
  return formatDimension(carton?.heightCm);
}

function EditableCartonCells({
  label,
  form,
  onFormChange,
  columns,
  quantityOptions,
}: {
  label: string;
  form: EditableCarton;
  onFormChange: (next: EditableCarton) => void;
  columns: CartonColumn[];
  quantityOptions?: number[] | null;
}) {
  const quantitySelectOptions = useMemo(() => {
    if (!quantityOptions) return [];
    const values = new Set(quantityOptions);
    const current = Number(form.quantity);
    if (Number.isFinite(current) && current > 0) values.add(current);
    return [...values].sort((a, b) => a - b);
  }, [quantityOptions, form.quantity]);

  return (
    <>
      {columns.map(col => {
        const field = EDIT_FIELD_META[col.key];
        if (col.key === 'quantity' && quantityOptions) {
          return (
            <td key={col.key} className="product-package__value-cell">
              <select
                className="product-package__input product-package__select"
                value={form.quantity}
                onChange={e => onFormChange({ ...form, quantity: e.target.value })}
                aria-label={`${label} ${field.label}`}
              >
                <option value="">—</option>
                {quantitySelectOptions.map(qty => (
                  <option key={qty} value={String(qty)}>{qty}</option>
                ))}
              </select>
            </td>
          );
        }
        return (
          <td key={col.key} className="product-package__value-cell">
            <DecimalTextInput
              className="product-package__input"
              value={form[col.key]}
              onChange={next => onFormChange({ ...form, [col.key]: next })}
              decimals={Number(field.step) >= 1 ? 0 : Number(field.step) <= 0.01 ? 2 : 1}
              placeholder={field.placeholder}
              aria-label={`${label} ${field.label}`}
            />
          </td>
        );
      })}
    </>
  );
}

function ViewCartonCells({
  carton,
  product,
  columns,
}: {
  carton: CatalogPackageCarton | null | undefined;
  product: CatalogProduct;
  columns: CartonColumn[];
}) {
  return (
    <>
      {columns.map(col => (
        <td
          key={col.key}
          className={[
            'product-package__value-cell',
            col.key === 'quantity' ? 'product-package__value-cell--qty' : '',
            col.key === 'weightKg' ? 'product-package__value-cell--weight' : '',
          ].filter(Boolean).join(' ')}
        >
          {cartonDisplayValue(carton, col.key, product)}
        </td>
      ))}
    </>
  );
}

function MasterCartonSection({
  product,
  carton,
  editing,
  form,
  onFormChange,
  quantityOptions,
}: {
  product: CatalogProduct;
  carton: CatalogPackageCarton | null | undefined;
  editing: boolean;
  form: EditableCarton;
  onFormChange: (next: EditableCarton) => void;
  quantityOptions?: number[] | null;
}) {
  return (
    <section className={`product-package__section ${editing ? 'product-package__section--editing' : ''}`}>
      <h3 className="product-package__section-title">Master Carton</h3>

      <div className="product-package__table-wrap">
        <table className="product-package__table">
          <thead>
            <tr>
              {MASTER_CARTON_COLUMNS.map(col => (
                <th key={col.key} scope="col">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {editing ? (
                <EditableCartonCells
                  label="Master Carton"
                  form={form}
                  onFormChange={onFormChange}
                  columns={MASTER_CARTON_COLUMNS}
                  quantityOptions={quantityOptions}
                />
              ) : (
                <ViewCartonCells
                  carton={carton}
                  product={product}
                  columns={MASTER_CARTON_COLUMNS}
                />
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SingleBoxSection({
  product,
  cartons,
  editing,
  formRows,
  onFormChange,
  onAddRow,
  onRemoveRow,
}: {
  product: CatalogProduct;
  cartons: CatalogPackageCarton[] | null | undefined;
  editing: boolean;
  formRows: EditableCarton[];
  onFormChange: (index: number, next: EditableCarton) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
}) {
  const viewRows = cartons?.length ? cartons : [null];
  const showRowActions = editing && formRows.length > 1;
  const multiRows = editing ? formRows.length > 1 : viewRows.length > 1;

  return (
    <section className={`product-package__section ${editing ? 'product-package__section--editing' : ''}`}>
      <div className="product-package__section-head">
        <h3 className="product-package__section-title">Single Box</h3>
        {editing && (
          <button
            type="button"
            className="product-package__add-row-btn"
            onClick={onAddRow}
            aria-label="Add another single box row"
          >
            <Plus size={14} aria-hidden />
            <span>Add box</span>
          </button>
        )}
      </div>

      <div className="product-package__table-wrap">
        <table className={`product-package__table${multiRows ? ' product-package__table--multi' : ''}`}>
          <thead>
            <tr>
              {SINGLE_BOX_COLUMNS.map(col => (
                <th key={col.key} scope="col">{col.label}</th>
              ))}
              {showRowActions ? (
                <th scope="col" className="product-package__actions-col" aria-label="Remove" />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {editing
              ? formRows.map((row, index) => (
                  <tr key={`single-box-edit-${index}`}>
                    <EditableCartonCells
                      label={`Single Box ${index + 1}`}
                      form={row}
                      onFormChange={next => onFormChange(index, next)}
                      columns={SINGLE_BOX_COLUMNS}
                    />
                    {showRowActions ? (
                      <td className="product-package__value-cell product-package__actions-cell">
                        <button
                          type="button"
                          className="product-package__icon-btn product-package__icon-btn--cancel"
                          onClick={() => onRemoveRow(index)}
                          aria-label={`Remove single box row ${index + 1}`}
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              : viewRows.map((carton, index) => (
                  <tr key={`single-box-view-${index}`}>
                    <ViewCartonCells
                      carton={carton}
                      product={product}
                      columns={SINGLE_BOX_COLUMNS}
                    />
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export const ProductPackageInfo: React.FC<{
  product: CatalogProduct;
  packageInfo?: CatalogPackageInfo | null;
  canEdit?: boolean;
  embedded?: boolean;
  /** Open in edit mode (e.g. fill missing dims on order create). Ignored when embedded — always editable. */
  defaultEditing?: boolean;
  onPackageInfoChange?: (info: CatalogPackageInfo) => void;
}> = ({
  product,
  packageInfo = null,
  canEdit = false,
  embedded = false,
  defaultEditing = false,
  onPackageInfoChange,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  /** Freight / SO embed: always edit in place — no pen toggle. */
  const alwaysEditing = Boolean(canEdit && embedded);
  const [editing, setEditing] = useState(Boolean(canEdit && (embedded || defaultEditing)));
  const [form, setForm] = useState<PackageForm>(() => packageInfoToForm(packageInfo));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterCartonQuantities, setMasterCartonQuantities] = useState<number[]>([]);

  const isEditing = alwaysEditing || editing;
  const canSaveToProduct = useMemo(
    () => hasCompleteSingleBox(form.singleBox),
    [form.singleBox],
  );

  useEffect(() => {
    let active = true;
    void loadMasterCartonQuantities()
      .then(values => {
        if (active) setMasterCartonQuantities(values);
      })
      .catch(() => {
        if (active) setMasterCartonQuantities([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (alwaysEditing) {
      setForm(packageInfoToForm(packageInfo));
    }
  }, [packageInfo, alwaysEditing]);

  useEffect(() => {
    if (alwaysEditing || editing) return;
    setForm(packageInfoToForm(packageInfo));
  }, [packageInfo, editing, alwaysEditing]);

  useEffect(() => {
    if (alwaysEditing) setEditing(true);
  }, [alwaysEditing]);

  const handleCancel = useCallback(() => {
    setForm(packageInfoToForm(packageInfo));
    setError(null);
    if (!alwaysEditing) setEditing(false);
  }, [packageInfo, alwaysEditing]);

  useEffect(() => {
    // Embedded freight fill stays open — no click-outside dismiss / pen cycle.
    if (alwaysEditing || !isEditing || saving) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target)) return;
      handleCancel();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [alwaysEditing, isEditing, saving, handleCancel]);

  const handleSave = async () => {
    if (alwaysEditing && !canSaveToProduct) {
      setError('Fill at least one complete single box (weight + L × B × H) before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await updateCatalogProductPackageInfo(product.id, {
        masterCarton: parseEditableCarton(form.masterCarton),
        singleBox: parseEditableSingleBoxes(form.singleBox),
      });
      onPackageInfoChange?.(saved);
      if (!alwaysEditing) setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save package information.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`product-detail-page__package-info ${embedded ? 'product-detail-page__package-info--embedded' : ''}`} ref={cardRef}>
      {(!embedded || !alwaysEditing) ? (
        <div className="product-package__head">
          {!embedded && (
            <h2 className="product-detail-page__stock-locations-title">Package information</h2>
          )}
          {!alwaysEditing ? (
            <div className={`product-package__head-actions ${embedded ? 'product-package__head-actions--embedded' : ''}`}>
              {!isEditing && <span className="product-package__badge">Package</span>}
              {canEdit && !isEditing && (
                <button
                  type="button"
                  className="product-package__edit-btn"
                  onClick={() => setEditing(true)}
                  aria-label="Edit package information"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {error && <p className="product-package__row-error">{error}</p>}

      <div className={`product-package__card ${isEditing ? 'product-package__card--editing' : ''}`}>
        <MasterCartonSection
          product={product}
          carton={packageInfo?.masterCarton ?? null}
          editing={isEditing}
          form={form.masterCarton}
          onFormChange={next => setForm(prev => ({ ...prev, masterCarton: next }))}
          quantityOptions={masterCartonQuantities.length > 0 ? masterCartonQuantities : null}
        />
        <div className="product-package__divider" aria-hidden />
        <SingleBoxSection
          product={product}
          cartons={packageInfo?.singleBox ?? null}
          editing={isEditing}
          formRows={form.singleBox}
          onFormChange={(index, next) => {
            setForm(prev => ({
              ...prev,
              singleBox: prev.singleBox.map((row, i) => (i === index ? next : row)),
            }));
          }}
          onAddRow={() => {
            setForm(prev => ({
              ...prev,
              singleBox: [...prev.singleBox, emptyEditableCarton()],
            }));
          }}
          onRemoveRow={index => {
            setForm(prev => {
              if (prev.singleBox.length <= 1) {
                return { ...prev, singleBox: [emptyEditableCarton()] };
              }
              return {
                ...prev,
                singleBox: prev.singleBox.filter((_, i) => i !== index),
              };
            });
          }}
        />
      </div>

      {canEdit && isEditing ? (
        <div className="product-package__footer-actions">
          {!alwaysEditing ? (
            <button
              type="button"
              className="product-package__cancel-btn"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="product-package__save-btn"
            onClick={() => void handleSave()}
            disabled={saving || (alwaysEditing && !canSaveToProduct)}
            title={
              alwaysEditing && !canSaveToProduct
                ? 'Enter at least one complete single box (weight + L × B × H)'
                : undefined
            }
          >
            <Save size={15} aria-hidden />
            {saving
              ? 'Saving…'
              : alwaysEditing
                ? 'Save and push to product data'
                : 'Save'}
          </button>
        </div>
      ) : null}
    </div>
  );
};
