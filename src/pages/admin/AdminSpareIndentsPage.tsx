import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Pencil, ShoppingBag, Trash2, X } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { ProductImageFrame } from '../../components/catalog/ProductImageFrame';
import { QuantityStepper } from '../../components/QuantityStepper';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { invoiceErrorMessage } from '../../lib/invoices';
import { catalogBaseForRole } from '../../lib/catalogRoutes';
import {
  deleteSpareIndent,
  listSpareIndents,
  spareIndentPoPrefill,
  updateSpareIndentQty,
  type SpareIndent,
} from '../../lib/spareIndents';
import { canUpdatePurchaseOrders, isFullSuperAdmin, isStaffUser } from '../../lib/staffAccess';
import { formatAuditAttribution } from '../../lib/yesStore/format';
import { homePathForRole } from '../../types';

export const AdminSpareIndentsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [rows, setRows] = useState<SpareIndent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<SpareIndent | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editVendor, setEditVendor] = useState('');
  const [saving, setSaving] = useState(false);

  const canManage = isFullSuperAdmin(user);
  const canConvert = canUpdatePurchaseOrders(user);

  useCatalogPageHeader({
    title: 'Spare Indent',
    subtitle: 'Spares requested for purchase',
    showBack: false,
    accentTitle: true,
  }, true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listSpareIndents()
      .then(next => {
        if (!cancelled) setRows(next);
      })
      .catch(err => {
        if (!cancelled) setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openRows = useMemo(() => rows.filter(row => row.status === 'open'), [rows]);

  const openEdit = (row: SpareIndent) => {
    setEditing(row);
    setEditQty(Math.max(1, row.qty));
    setEditVendor(row.vendorName || '');
    setError('');
  };

  const saveEdit = async () => {
    if (!editing || !user || !canManage) return;
    setSaving(true);
    setError('');
    try {
      await updateSpareIndentQty({
        id: editing.id,
        qty: editQty,
        vendorName: editVendor,
        updatedByUid: user.uid,
        updatedByName: user.displayName,
      });
      setRows(prev => prev.map(row => (
        row.id === editing.id
          ? { ...row, qty: editQty, vendorName: editVendor.trim() || null }
          : row
      )));
      setEditing(null);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: SpareIndent) => {
    if (!canManage) return;
    const ok = await confirm({
      title: 'Delete spare indent',
      message: `Remove ${row.qty} × ${row.name}?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setError('');
    try {
      await deleteSpareIndent(row.id);
      setRows(prev => prev.filter(item => item.id !== row.id));
    } catch (err) {
      setError(invoiceErrorMessage(err));
    }
  };

  const convert = (row: SpareIndent) => {
    const sameVendor = openRows.filter(item => (
      item.id === row.id
      || (row.vendorId && item.vendorId === row.vendorId)
    ));
    const prefill = spareIndentPoPrefill(sameVendor.length ? sameVendor : [row]);
    navigate(`${homePathForRole('super_admin')}/purchase-orders/new`, {
      state: { spareIndentPrefill: prefill },
    });
  };

  if (!user || (!isStaffUser(user) && user.role !== 'super_admin')) return null;

  return (
    <div className="page-content fade-in spare-indent-page">
      {error ? (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <FetchingLoader label="Loading spare indents…" />
      ) : error ? null : openRows.length === 0 ? (
        <p className="text-muted spare-indent-page__empty">
          No open spare indents. Open a spare part and tap the pencil on Spare Indent to record qty.
        </p>
      ) : (
        <ul className="spare-indent-page__list">
          {openRows.map(row => (
            <li key={row.id} className="spare-indent-page__card panel glass">
              <button
                type="button"
                className="spare-indent-page__product"
                onClick={() => navigate(`${catalogBaseForRole(user.role)}/spare/${row.catalogProductId}`)}
              >
                <ProductImageFrame src={row.imageUrl} alt={row.name} variant="row" />
                <span>
                  <strong>{row.name}</strong>
                  <span className="text-muted">{row.sku || 'No SKU'}</span>
                </span>
              </button>
              <dl className="spare-indent-page__meta">
                <div>
                  <dt>Qty</dt>
                  <dd>{row.qty}</dd>
                </div>
                <div>
                  <dt>Supplier</dt>
                  <dd>{row.vendorName || '—'}</dd>
                </div>
                <div>
                  <dt>Recorded</dt>
                  <dd>{formatAuditAttribution(row.createdByName, row.createdAt)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{row.status === 'converted'
                    ? (row.purchaseOrderNumber ? `PO ${row.purchaseOrderNumber}` : 'Converted')
                    : 'Open'}
                  </dd>
                </div>
              </dl>
              {canManage || canConvert ? (
                <div className="spare-indent-page__actions">
                  {canManage ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(row)}>
                      <Pencil size={14} aria-hidden />
                      Edit
                    </button>
                  ) : null}
                  {canManage ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void remove(row); }}>
                      <Trash2 size={14} aria-hidden />
                      Delete
                    </button>
                  ) : null}
                  {canConvert && row.status === 'open' ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => convert(row)}>
                      <ShoppingBag size={14} aria-hidden />
                      Convert to PO
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="dealers-modal-backdrop" onClick={() => { if (!saving) setEditing(null); }}>
          <div
            className="dealers-modal panel glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="spare-indent-edit-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="dealers-modal__header">
              <h2 id="spare-indent-edit-title">Edit spare indent</h2>
              <button
                type="button"
                className="dealers-modal__close"
                onClick={() => setEditing(null)}
                disabled={saving}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-muted text-sm">{editing.name}</p>
            <label className="dealers-modal__field">
              <span>Qty</span>
              <QuantityStepper value={editQty} onChange={setEditQty} min={1} disabled={saving} />
            </label>
            <label className="dealers-modal__field">
              <span>Supplier</span>
              <input
                type="text"
                value={editVendor}
                disabled={saving}
                onChange={event => setEditVendor(event.target.value)}
              />
            </label>
            <div className="dealers-modal__actions">
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => { void saveEdit(); }}>
                {saving ? 'Saving…' : (
                  <>
                    <Check size={14} aria-hidden />
                    Save
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
