import React, { useEffect, useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import { formatStockQuantity, updateCatalogProductPackageInfo } from '../../lib/catalog';
import type { CatalogPackageCarton, CatalogPackageInfo, CatalogProduct } from '../../types/catalog';

type CartonKind = 'masterCarton' | 'singleBox';

const CARTON_LABELS: Record<CartonKind, string> = {
  masterCarton: 'Master Carton',
  singleBox: 'Single Box',
};

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

function CartonTable({
  product,
  carton,
  editing,
  form,
  onFormChange,
}: {
  product: CatalogProduct;
  carton: CatalogPackageCarton | null | undefined;
  editing: boolean;
  form: EditableCarton;
  onFormChange: (patch: Partial<EditableCarton>) => void;
}) {
  if (editing) {
    return (
      <div className="product-package__table-wrap">
        <table className="product-package__table product-package__table--editable">
          <thead>
            <tr>
              <th>Qty</th>
              <th>Weight</th>
              <th>L (cm)</th>
              <th>B (cm)</th>
              <th>H (cm)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="product-package__input"
                  value={form.quantity}
                  onChange={e => onFormChange({ quantity: e.target.value })}
                  placeholder="pc"
                  aria-label="Quantity per package"
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="product-package__input"
                  value={form.weightKg}
                  onChange={e => onFormChange({ weightKg: e.target.value })}
                  placeholder="kg"
                  aria-label="Weight in kg"
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="product-package__input"
                  value={form.lengthCm}
                  onChange={e => onFormChange({ lengthCm: e.target.value })}
                  aria-label="Length in cm"
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="product-package__input"
                  value={form.breadthCm}
                  onChange={e => onFormChange({ breadthCm: e.target.value })}
                  aria-label="Breadth in cm"
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="product-package__input"
                  value={form.heightCm}
                  onChange={e => onFormChange({ heightCm: e.target.value })}
                  aria-label="Height in cm"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const hasData = carton && [carton.quantity, carton.weightKg, carton.lengthCm, carton.breadthCm, carton.heightCm]
    .some(v => v != null);

  if (!hasData) {
    return <p className="product-package__empty">No package details recorded yet.</p>;
  }

  return (
    <div className="product-package__table-wrap">
      <table className="product-package__table product-package__table--hero-values">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Weight</th>
            <th>L (cm)</th>
            <th>B (cm)</th>
            <th>H (cm)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="product-package__qty-cell">
              {carton?.quantity != null
                ? formatStockQuantity(carton.quantity, product.unit)
                : '—'}
            </td>
            <td className="product-package__weight-cell">{formatWeight(carton?.weightKg)}</td>
            <td>{formatDimension(carton?.lengthCm)}</td>
            <td>{formatDimension(carton?.breadthCm)}</td>
            <td>{formatDimension(carton?.heightCm)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CartonCard({
  kind,
  product,
  packageInfo,
  canEdit,
  onSaved,
}: {
  kind: CartonKind;
  product: CatalogProduct;
  packageInfo: CatalogPackageInfo | null | undefined;
  canEdit: boolean;
  onSaved: (info: CatalogPackageInfo) => void;
}) {
  const carton = packageInfo?.[kind] ?? null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditableCarton>(() => cartonToEditable(carton));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setForm(cartonToEditable(carton));
    }
  }, [carton, editing]);

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
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save package information.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(cartonToEditable(carton));
    setError(null);
    setEditing(false);
  };

  return (
    <div className={['product-package__card', editing ? 'product-package--editing' : ''].filter(Boolean).join(' ')}>
      <div className="product-package__header">
        <h3 className="product-package__title">{CARTON_LABELS[kind]}</h3>
        {canEdit && !editing && (
          <button
            type="button"
            className="product-package__edit-btn"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${CARTON_LABELS[kind]}`}
          >
            <Pencil size={14} />
          </button>
        )}
        {canEdit && editing && (
          <div className="product-package__header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm product-package__save-btn"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="product-package__edit-btn product-package__edit-btn--active"
              onClick={handleCancel}
              disabled={saving}
              aria-label="Cancel editing"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <CartonTable
        product={product}
        carton={carton}
        editing={editing}
        form={form}
        onFormChange={patch => setForm(prev => ({ ...prev, ...patch }))}
      />

      {error && <p className="product-package__error">{error}</p>}
    </div>
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
  const handleSaved = (info: CatalogPackageInfo) => {
    onPackageInfoChange?.(info);
  };

  return (
    <div className="product-detail-page__package-info">
      <h2 className="product-detail-page__stock-locations-title">Package information</h2>
      <div className="product-detail-page__package-cards">
        <CartonCard
          kind="masterCarton"
          product={product}
          packageInfo={packageInfo}
          canEdit={canEdit}
          onSaved={handleSaved}
        />
        <CartonCard
          kind="singleBox"
          product={product}
          packageInfo={packageInfo}
          canEdit={canEdit}
          onSaved={handleSaved}
        />
      </div>
    </div>
  );
};
