import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import { formatStockQuantity, updateCatalogProductPackageInfo } from '../../lib/catalog';
import type { CatalogPackageCarton, CatalogPackageInfo, CatalogProduct } from '../../types/catalog';

type CartonKind = 'masterCarton' | 'singleBox';

const CARTON_ROWS: { kind: CartonKind; label: string }[] = [
  { kind: 'masterCarton', label: 'Master Carton' },
  { kind: 'singleBox', label: 'Single Box' },
];

type EditableCarton = {
  quantity: string;
  weightKg: string;
  lengthCm: string;
  breadthCm: string;
  heightCm: string;
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

const EDIT_FIELDS: Array<{
  key: keyof EditableCarton;
  placeholder: string;
  label: string;
  step: string;
  min: number;
}> = [
  { key: 'quantity', placeholder: 'pc', label: 'Quantity per package', step: '1', min: 1 },
  { key: 'weightKg', placeholder: 'kg', label: 'Weight in kg', step: '0.01', min: 0 },
  { key: 'lengthCm', placeholder: '', label: 'Length in cm', step: '0.1', min: 0 },
  { key: 'breadthCm', placeholder: '', label: 'Breadth in cm', step: '0.1', min: 0 },
  { key: 'heightCm', placeholder: '', label: 'Height in cm', step: '0.1', min: 0 },
];

function CartonRow({
  kind,
  label,
  product,
  carton,
  packageInfo,
  canEdit,
  editingKind,
  onEditingKindChange,
  onSaved,
}: {
  kind: CartonKind;
  label: string;
  product: CatalogProduct;
  carton: CatalogPackageCarton | null | undefined;
  packageInfo: CatalogPackageInfo | null | undefined;
  canEdit: boolean;
  editingKind: CartonKind | null;
  onEditingKindChange: (kind: CartonKind | null) => void;
  onSaved: (info: CatalogPackageInfo) => void;
}) {
  const editing = editingKind === kind;
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [form, setForm] = useState<EditableCarton>(() => cartonToEditable(carton));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setForm(cartonToEditable(carton));
    }
  }, [carton, editing]);

  const handleCancel = useCallback(() => {
    setForm(cartonToEditable(carton));
    setError(null);
    onEditingKindChange(null);
  }, [carton, onEditingKindChange]);

  useEffect(() => {
    if (!editing || saving) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rowRef.current?.contains(target)) return;
      handleCancel();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [editing, saving, handleCancel]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const parsed = parseEditableCarton(form);
      const saved = await updateCatalogProductPackageInfo(product.id, {
        masterCarton: kind === 'masterCarton'
          ? parsed
          : packageInfo?.masterCarton ?? null,
        singleBox: kind === 'singleBox'
          ? parsed
          : packageInfo?.singleBox ?? null,
      });
      onSaved(saved);
      onEditingKindChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save package information.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr ref={rowRef} className={editing ? 'product-package__row--editing' : ''}>
      <th scope="row" className="product-package__type-cell">
        <span className="product-package__type-label">{label}</span>
        {error && <span className="product-package__row-error">{error}</span>}
      </th>
      {editing ? (
        EDIT_FIELDS.map(field => (
          <td key={field.key} className="product-package__value-cell">
            <input
              type="number"
              min={field.min}
              step={field.step}
              className="product-package__input"
              value={form[field.key]}
              onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              aria-label={`${label} ${field.label}`}
            />
          </td>
        ))
      ) : (
        <>
          <td className="product-package__value-cell product-package__value-cell--qty">
            {carton?.quantity != null
              ? formatStockQuantity(carton.quantity, product.unit)
              : '—'}
          </td>
          <td className="product-package__value-cell product-package__value-cell--weight">
            {formatWeight(carton?.weightKg)}
          </td>
          <td className="product-package__value-cell">{formatDimension(carton?.lengthCm)}</td>
          <td className="product-package__value-cell">{formatDimension(carton?.breadthCm)}</td>
          <td className="product-package__value-cell">{formatDimension(carton?.heightCm)}</td>
        </>
      )}
      {canEdit && (
        <td className="product-package__action-cell">
          {!editing ? (
            <button
              type="button"
              className="product-package__edit-btn"
              onClick={() => onEditingKindChange(kind)}
              disabled={editingKind != null && editingKind !== kind}
              aria-label={`Edit ${label}`}
            >
              <Pencil size={12} />
            </button>
          ) : (
            <div className="product-package__row-actions">
              <button
                type="button"
                className="product-package__icon-btn product-package__icon-btn--save"
                onClick={() => void handleSave()}
                disabled={saving}
                aria-label={`Save ${label}`}
              >
                <Save size={12} />
              </button>
              <button
                type="button"
                className="product-package__icon-btn product-package__icon-btn--cancel"
                onClick={handleCancel}
                disabled={saving}
                aria-label={`Cancel editing ${label}`}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

export const ProductPackageInfo: React.FC<{
  product: CatalogProduct;
  packageInfo?: CatalogPackageInfo | null;
  canEdit?: boolean;
  onPackageInfoChange?: (info: CatalogPackageInfo) => void;
}> = ({
  product,
  packageInfo = null,
  canEdit = false,
  onPackageInfoChange,
}) => {
  const [editingKind, setEditingKind] = useState<CartonKind | null>(null);

  return (
    <div className="product-detail-page__package-info">
      <h2 className="product-detail-page__stock-locations-title">Package information</h2>
      <div className="product-package__table-wrap">
        <table className="product-package__table">
          <thead>
            <tr>
              <th scope="col" className="product-package__type-col">Type</th>
              <th scope="col">Qty</th>
              <th scope="col">Weight</th>
              <th scope="col">L (cm)</th>
              <th scope="col">B (cm)</th>
              <th scope="col">H (cm)</th>
              {canEdit && <th scope="col" className="product-package__action-col" title="Actions" />}
            </tr>
          </thead>
          <tbody>
            {CARTON_ROWS.map(row => (
              <CartonRow
                key={row.kind}
                kind={row.kind}
                label={row.label}
                product={product}
                carton={packageInfo?.[row.kind] ?? null}
                packageInfo={packageInfo}
                canEdit={canEdit}
                editingKind={editingKind}
                onEditingKindChange={setEditingKind}
                onSaved={info => onPackageInfoChange?.(info)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
