import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import { formatStockQuantity, updateCatalogProductPackageInfo } from '../../lib/catalog';
import type { CatalogPackageCarton, CatalogPackageInfo, CatalogProduct } from '../../types/catalog';

type CartonKind = 'masterCarton' | 'singleBox';

const CARTON_ROWS: { kind: CartonKind; label: string }[] = [
  { kind: 'masterCarton', label: 'Master Carton' },
  { kind: 'singleBox', label: 'Single Box' },
];

const VALUE_COLUMNS = [
  { key: 'quantity' as const, label: 'Qty' },
  { key: 'weightKg' as const, label: 'Weight' },
  { key: 'lengthCm' as const, label: 'L (cm)' },
  { key: 'breadthCm' as const, label: 'B (cm)' },
  { key: 'heightCm' as const, label: 'H (cm)' },
];

type EditableCarton = {
  quantity: string;
  weightKg: string;
  lengthCm: string;
  breadthCm: string;
  heightCm: string;
};

type PackageForm = Record<CartonKind, EditableCarton>;

function emptyEditableCarton(): EditableCarton {
  return {
    quantity: '',
    weightKg: '',
    lengthCm: '',
    breadthCm: '',
    heightCm: '',
  };
}

function packageInfoToForm(info: CatalogPackageInfo | null | undefined): PackageForm {
  return {
    masterCarton: cartonToEditable(info?.masterCarton),
    singleBox: cartonToEditable(info?.singleBox),
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

function formatWeight(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} kg`;
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

function CartonSection({
  label,
  product,
  carton,
  editing,
  form,
  onFormChange,
}: {
  label: string;
  product: CatalogProduct;
  carton: CatalogPackageCarton | null | undefined;
  editing: boolean;
  form: EditableCarton;
  onFormChange: (next: EditableCarton) => void;
}) {
  const displayValue = (key: keyof EditableCarton): string => {
    if (key === 'quantity') {
      return carton?.quantity != null
        ? formatStockQuantity(carton.quantity, product.unit)
        : '—';
    }
    if (key === 'weightKg') return formatWeight(carton?.weightKg);
    if (key === 'lengthCm') return formatDimension(carton?.lengthCm);
    if (key === 'breadthCm') return formatDimension(carton?.breadthCm);
    return formatDimension(carton?.heightCm);
  };

  return (
    <section className={`product-package__section ${editing ? 'product-package__section--editing' : ''}`}>
      <h3 className="product-package__section-title">{label}</h3>

      <div className="product-package__table-wrap">
        <table className="product-package__table">
          <thead>
            <tr>
              {VALUE_COLUMNS.map(col => (
                <th key={col.key} scope="col">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {editing ? (
                VALUE_COLUMNS.map(col => {
                  const field = EDIT_FIELD_META[col.key];
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
                })
              ) : (
                VALUE_COLUMNS.map(col => (
                  <td
                    key={col.key}
                    className={[
                      'product-package__value-cell',
                      col.key === 'quantity' ? 'product-package__value-cell--qty' : '',
                      col.key === 'weightKg' ? 'product-package__value-cell--weight' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {displayValue(col.key)}
                  </td>
                ))
              )}
            </tr>
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
        singleBox: parseEditableCarton(form.singleBox),
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
        {CARTON_ROWS.map((row, index) => (
          <React.Fragment key={row.kind}>
            {index > 0 && <div className="product-package__divider" aria-hidden />}
            <CartonSection
              label={row.label}
              product={product}
              carton={packageInfo?.[row.kind] ?? null}
              editing={editing}
              form={form[row.kind]}
              onFormChange={next => setForm(prev => ({ ...prev, [row.kind]: next }))}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
