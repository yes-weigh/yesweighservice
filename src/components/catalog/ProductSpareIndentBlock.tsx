import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { QuantityStepper } from '../QuantityStepper';
import { invoiceErrorMessage } from '../../lib/invoices';
import {
  createSpareIndent,
  listSpareIndentsForProduct,
  type SpareIndent,
} from '../../lib/spareIndents';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import type { CatalogProduct } from '../../types/catalog';

type Props = {
  product: CatalogProduct;
  canCreate: boolean;
  actorUid: string;
  actorName: string;
};

export const ProductSpareIndentBlock: React.FC<Props> = ({
  product,
  canCreate,
  actorUid,
  actorName,
}) => {
  const [rows, setRows] = useState<SpareIndent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openRows = useMemo(
    () => rows.filter(row => row.status === 'open'),
    [rows],
  );
  const openQty = openRows.reduce((sum, row) => sum + row.qty, 0);

  const reload = useCallback(async () => {
    const next = await listSpareIndentsForProduct(product.id);
    setRows(next);
  }, [product.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void reload()
      .catch(err => {
        if (!cancelled) setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const save = async () => {
    if (!canCreate || saving) return;
    setSaving(true);
    setError('');
    try {
      const created = await createSpareIndent({
        catalogProductId: product.id,
        sku: product.sku,
        name: product.name,
        imageUrl: product.imageUrl,
        qty,
        createdByUid: actorUid,
        createdByName: actorName,
      });
      setRows(prev => [created, ...prev.filter(row => row.id !== created.id)]);
      setEditing(false);
      setQty(1);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="product-site-stock spare-indent-block">
      <header className="product-site-stock__header">
        <h3 className="product-site-stock__title">Spare Indent</h3>
        <div className="product-site-stock__header-actions">
          <span className="product-site-stock__badge product-site-stock__badge--store">
            {openQty > 0 ? `${openQty} to order` : 'To order'}
          </span>
          {canCreate ? (
            <button
              type="button"
              className={[
                'product-site-stock__edit-btn',
                editing ? 'product-site-stock__edit-btn--active' : '',
              ].filter(Boolean).join(' ')}
              title={editing ? 'Cancel' : 'Record spare indent'}
              aria-label={editing ? 'Cancel' : 'Record spare indent'}
              aria-pressed={editing}
              onClick={() => {
                setError('');
                setEditing(open => !open);
              }}
            >
              {editing ? <X size={15} aria-hidden /> : <Pencil size={15} aria-hidden />}
            </button>
          ) : null}
        </div>
      </header>

      {editing && canCreate ? (
        <div className="spare-indent-block__editor">
          <div className="spare-indent-block__editor-row">
            <span className="spare-indent-block__qty-label">Qty to order</span>
            <QuantityStepper value={qty} onChange={setQty} min={1} disabled={saving} />
          </div>
          <button
            type="button"
            className="btn btn-primary spare-indent-block__save"
            disabled={saving || qty < 1}
            onClick={() => { void save(); }}
          >
            {saving ? 'Saving…' : 'Save indent'}
          </button>
        </div>
      ) : null}

      {error ? <p className="spare-indent-block__error">{error}</p> : null}

      {loading ? (
        <p className="spare-indent-block__hint">Loading…</p>
      ) : openRows.length > 0 ? (
        <ul className="spare-indent-block__list">
          {openRows.map(row => (
            <li key={row.id}>
              <div className="spare-indent-block__qty">
                <strong>{row.qty}</strong>
                <span>nos</span>
              </div>
              <div className="spare-indent-block__copy">
                <p className="spare-indent-block__who">{row.createdByName}</p>
                <p className="spare-indent-block__when">{formatAuditDateTime(row.createdAt)}</p>
                {row.vendorName ? (
                  <p className="spare-indent-block__vendor">{row.vendorName}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : error ? null : (
        <p className="spare-indent-block__hint">
          {canCreate ? 'Tap the pencil to record qty to order.' : 'No spare indent yet.'}
        </p>
      )}
    </section>
  );
};
