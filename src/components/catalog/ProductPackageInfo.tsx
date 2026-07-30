import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
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
  const boxes = rows
    .map(row => {
      const parsed = parseEditableCarton({ ...row, quantity: '' });
      if (!parsed) return null;
      return { ...parsed, quantity: null };
    })
    .filter((row): row is CatalogPackageCarton => Boolean(row));
  return boxes.length ? boxes : null;
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
            <input
              type="number"
              min={field.min}
              step={field.step}
              className="product-package__input"
              value={form[col.key]}
              onChange={e => onFormChange({ ...form, [col.key]: e.target.value })}
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
  onPackageInfoChange?: (info: CatalogPackageInfo) => void;
}> = ({
  product,
  packageInfo = null,
  canEdit = false,
  embedded = false,
  onPackageInfoChange,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PackageForm>(() => packageInfoToForm(packageInfo));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterCartonQuantities, setMasterCartonQuantities] = useState<number[]>([]);

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
    if (!editing) {
      setForm(packageInfoToForm(packageInfo));
    }
  }, [packageInfo, editing]);

  const handleCancel = useCallback(() => {
    setForm(packageInfoToForm(packageInfo));
    setError(null);
    setEditing(false);
  }, [packageInfo]);

  useEffect(() => {
    if (!editing || saving) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target)) return;
      handleCancel();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [editing, saving, handleCancel]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateCatalogProductPackageInfo(product.id, {
        masterCarton: parseEditableCarton(form.masterCarton),
        singleBox: parseEditableSingleBoxes(form.singleBox),
      });
      onPackageInfoChange?.(saved);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save package information.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`product-detail-page__package-info ${embedded ? 'product-detail-page__package-info--embedded' : ''}`} ref={cardRef}>
      <div className="product-package__head">
        {!embedded && (
          <h2 className="product-detail-page__stock-locations-title">Package information</h2>
        )}
        <div className={`product-package__head-actions ${embedded ? 'product-package__head-actions--embedded' : ''}`}>
          <span className="product-package__badge">Package</span>
          {canEdit && !editing && (
            <button
              type="button"
              className="product-package__edit-btn"
              onClick={() => setEditing(true)}
              aria-label="Edit package information"
            >
              <Pencil size={13} />
            </button>
          )}
          {canEdit && editing && (
            <div className="product-package__row-actions">
              <button
                type="button"
                className="product-package__icon-btn product-package__icon-btn--save"
                onClick={() => void handleSave()}
                disabled={saving}
                aria-label="Save package information"
              >
                <Save size={13} />
              </button>
              <button
                type="button"
                className="product-package__icon-btn product-package__icon-btn--cancel"
                onClick={handleCancel}
                disabled={saving}
                aria-label="Cancel editing package information"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <p className="product-package__row-error">{error}</p>}

      <div className={`product-package__card ${editing ? 'product-package__card--editing' : ''}`}>
        <MasterCartonSection
          product={product}
          carton={packageInfo?.masterCarton ?? null}
          editing={editing}
          form={form.masterCarton}
          onFormChange={next => setForm(prev => ({ ...prev, masterCarton: next }))}
          quantityOptions={masterCartonQuantities.length > 0 ? masterCartonQuantities : null}
        />
        <div className="product-package__divider" aria-hidden />
        <SingleBoxSection
          product={product}
          cartons={packageInfo?.singleBox ?? null}
          editing={editing}
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
    </div>
  );
};
