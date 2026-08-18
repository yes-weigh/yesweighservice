import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  ChevronRight,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { ProductImageFrame } from '../../components/catalog/ProductImageFrame';
import { QuantityStepper } from '../../components/QuantityStepper';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { createAdminPurchaseOrder } from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';
import { catalogBaseForRole } from '../../lib/catalogRoutes';
import {
  deleteSpareIndent,
  listSpareIndents,
  markSpareIndentsConverted,
  spareIndentPoPrefill,
  updateSpareIndentQty,
  type SpareIndent,
} from '../../lib/spareIndents';
import {
  loadLatestPurchaseCostsByItemId,
} from '../../lib/sparePurchaseCosts';
import { canUpdatePurchaseOrders, isFullSuperAdmin, isStaffUser } from '../../lib/staffAccess';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import {
  fetchZohoVendorsLive,
  loadZohoVendors,
  syncZohoVendorsFromZoho,
  vendorPlaceLabel,
  type ZohoVendorOption,
} from '../../lib/zoho-vendors';
import { homePathForRole } from '../../types';

function todayYmd(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function indentReference(): string {
  const now = new Date();
  const stamp = `${now.getHours()}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `SI-${todayYmd().replace(/-/g, '')}-${stamp}`;
}

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickingVendor, setPickingVendor] = useState(false);
  const [vendorQuery, setVendorQuery] = useState('');
  const [vendors, setVendors] = useState<ZohoVendorOption[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorsFetching, setVendorsFetching] = useState(false);
  const [creating, setCreating] = useState(false);

  const canManage = isFullSuperAdmin(user);
  const canConvert = canUpdatePurchaseOrders(user);
  const openRows = useMemo(() => rows.filter(row => row.status === 'open'), [rows]);
  const selectedRows = useMemo(
    () => openRows.filter(row => selectedIds.has(row.id)),
    [openRows, selectedIds],
  );
  const allSelected = openRows.length > 0 && selectedRows.length === openRows.length;
  const filteredVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    const active = vendors.filter(row => row.status === 'active' || !row.status);
    if (!q) return active;
    return active.filter(vendor => {
      const haystack = [
        vendor.name,
        vendor.companyName,
        vendor.phone,
        vendor.gstNo,
        vendor.city,
        vendor.state,
        vendor.country,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [vendorQuery, vendors]);

  useCatalogPageHeader({
    title: pickingVendor ? 'Vendor' : 'Spare Indent',
    subtitle: pickingVendor
      ? 'Select a vendor to push the selected indents to Zoho.'
      : 'Spares requested for purchase',
    showBack: pickingVendor,
    onBack: pickingVendor
      ? () => {
          if (!creating) {
            setPickingVendor(false);
            setError('');
          }
        }
      : undefined,
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

  const reloadVendors = useCallback(async () => {
    try {
      const next = await loadZohoVendors();
      if (next.length) {
        setVendors(next.filter(row => row.status === 'active' || !row.status));
        return;
      }
    } catch {
      // Fall through to live Zoho list.
    }
    const live = await fetchZohoVendorsLive();
    setVendors(live.filter(row => row.status === 'active' || !row.status));
  }, []);

  useEffect(() => {
    if (!pickingVendor) return;
    let cancelled = false;
    setVendorsLoading(true);
    void reloadVendors()
      .catch(err => {
        if (!cancelled) setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setVendorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickingVendor, reloadVendors]);

  const toggleRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(openRows.map(row => row.id)));
  };

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
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    } catch (err) {
      setError(invoiceErrorMessage(err));
    }
  };

  const startConvert = () => {
    if (!canConvert || selectedRows.length === 0) return;
    setError('');
    setVendorQuery('');
    setPickingVendor(true);
  };

  const fetchVendorsFromZoho = async () => {
    setVendorsFetching(true);
    setError('');
    try {
      try {
        await syncZohoVendorsFromZoho();
        await reloadVendors();
      } catch {
        const live = await fetchZohoVendorsLive();
        setVendors(live.filter(row => row.status === 'active' || !row.status));
      }
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setVendorsFetching(false);
    }
  };

  const pushToZoho = async (vendor: ZohoVendorOption) => {
    if (!canConvert || creating || selectedRows.length === 0) return;
    setCreating(true);
    setError('');
    try {
      const prefill = spareIndentPoPrefill(selectedRows);
      let costs = new Map();
      if (prefill.lines.some(line => line.rate == null || !(line.rate > 0))) {
        try {
          costs = await loadLatestPurchaseCostsByItemId();
        } catch {
          costs = new Map();
        }
      }
      const created = await createAdminPurchaseOrder({
        vendorId: vendor.id,
        date: todayYmd(),
        referenceNumber: indentReference(),
        lines: prefill.lines.map(line => ({
          productId: line.productId,
          quantity: line.quantity,
          rate: line.rate && line.rate > 0
            ? line.rate
            : (costs.get(line.productId)?.latest?.amount ?? 0),
          name: line.name,
        })),
      });
      await markSpareIndentsConverted({
        indentIds: prefill.indentIds,
        purchaseOrderId: created.id,
        purchaseOrderNumber: created.purchaseOrderNumber,
      });
      setRows(prev => prev.filter(row => !prefill.indentIds.includes(row.id)));
      setSelectedIds(new Set());
      setPickingVendor(false);
      navigate(`${homePathForRole('super_admin')}/purchase-orders/${created.id}`, { replace: true });
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  if (!user || (!isStaffUser(user) && user.role !== 'super_admin')) return null;

  return (
    <div className={`page-content fade-in spare-indent-page${pickingVendor ? ' spare-indent-page--vendor' : ''}`}>
      {error ? (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {pickingVendor ? (
        <section className="staff-create-so-page__dealer-stage">
          <header className="staff-create-so-page__dealer-hero">
            <span className="staff-create-so-page__dealer-hero-icon" aria-hidden>
              <Store size={22} />
            </span>
            <div className="staff-create-so-page__dealer-hero-copy">
              <h2>Select vendor</h2>
              <p>
                {selectedRows.length} indent{selectedRows.length === 1 ? '' : 's'} will push to Zoho.
                No catalog or PI step.
              </p>
            </div>
          </header>
          <div className="staff-create-so-page__dealer-panel panel glass">
            <h3 className="staff-create-so-page__dealer-panel-title">Vendor</h3>
            <p className="text-muted text-sm staff-create-so-page__dealer-panel-hint">
              Vendors stored in Firestore. Fetch from Zoho when you need a fresh list.
            </p>
            <div className="staff-create-so-page__dealer-search">
              <div className="create-po-page__vendor-search-row">
                <div className="catalog-search staff-create-so-page__dealer-search-input">
                  <Search size={15} aria-hidden />
                  <input
                    type="search"
                    placeholder="Search vendor by name…"
                    value={vendorQuery}
                    onChange={e => setVendorQuery(e.target.value)}
                    aria-label="Search vendors"
                    autoComplete="off"
                    disabled={creating}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm create-po-page__vendor-fetch"
                  disabled={vendorsFetching || vendorsLoading || creating}
                  onClick={() => { void fetchVendorsFromZoho(); }}
                >
                  <RefreshCw size={14} aria-hidden className={vendorsFetching ? 'is-spinning' : ''} />
                  {vendorsFetching ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {creating ? (
                <FetchingLoader label="Creating purchase order in Zoho…" />
              ) : vendorsLoading && vendors.length === 0 ? (
                <p className="text-muted text-sm">Loading vendors…</p>
              ) : filteredVendors.length > 0 ? (
                <ul className="staff-create-so-page__dealer-list" role="listbox">
                  {filteredVendors.map(vendor => {
                    const location = vendorPlaceLabel(vendor);
                    const meta = [vendor.currencyCode, vendor.phone].filter(Boolean).join(' • ');
                    return (
                      <li key={vendor.id}>
                        <button
                          type="button"
                          className="staff-create-so-page__dealer-option"
                          disabled={creating}
                          onClick={() => { void pushToZoho(vendor); }}
                        >
                          <span className="staff-create-so-page__dealer-option-main">
                            <strong>{vendor.name}</strong>
                            {meta ? (
                              <span className="staff-create-so-page__dealer-option-meta">{meta}</span>
                            ) : null}
                          </span>
                          <span className="staff-create-so-page__dealer-option-side">
                            {location ? (
                              <span className="staff-create-so-page__dealer-option-location">
                                <MapPin size={13} aria-hidden />
                                {location}
                              </span>
                            ) : null}
                            <ChevronRight size={18} className="staff-create-so-page__dealer-option-chevron" aria-hidden />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : vendorQuery.trim() ? (
                <p className="text-muted text-sm">No vendors match “{vendorQuery.trim()}”.</p>
              ) : (
                <p className="text-muted text-sm">
                  {vendors.length === 0
                    ? 'No vendors in Firestore yet. Tap Fetch to pull them from Zoho.'
                    : 'No active vendors found.'}
                </p>
              )}
            </div>
            <p className="staff-create-so-page__dealer-loaded">
              <Users size={14} aria-hidden />
              <span>{vendors.length.toLocaleString('en-IN')} vendors loaded</span>
            </p>
          </div>
        </section>
      ) : loading ? (
        <FetchingLoader label="Loading spare indents…" />
      ) : error && openRows.length === 0 ? null : openRows.length === 0 ? (
        <p className="text-muted spare-indent-page__empty">
          No open spare indents. Open a spare part and tap the pencil on Spare Indent to record qty.
        </p>
      ) : (
        <>
          {canConvert ? (
            <div className="spare-indent-page__select-bar">
              <label className="spare-indent-page__select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                />
                <span>{allSelected ? 'Clear' : 'Select all'}</span>
              </label>
              <span className="text-muted text-sm">{selectedRows.length} selected</span>
            </div>
          ) : null}
          <ul className="spare-indent-page__list">
            {openRows.map(row => {
              const selected = selectedIds.has(row.id);
              return (
                <li
                  key={row.id}
                  className={`spare-indent-page__card panel glass${selected ? ' is-selected' : ''}`}
                >
                  {canConvert ? (
                    <label className="spare-indent-page__check">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="spare-indent-page__media"
                    onClick={() => navigate(`${catalogBaseForRole(user.role)}/spare/${row.catalogProductId}`)}
                  >
                    <ProductImageFrame src={row.imageUrl} alt={row.name} variant="row" />
                  </button>
                  <div className="spare-indent-page__info">
                    <strong>{row.name}</strong>
                    <span className="spare-indent-page__sku">{row.sku || 'No SKU'}</span>
                    <span>{row.qty} nos</span>
                    <span>{formatAuditDateTime(row.createdAt)}</span>
                    <span>{row.createdByName}</span>
                    {row.vendorName ? <span>{row.vendorName}</span> : null}
                    {canManage ? (
                      <div className="spare-indent-page__row-actions">
                        <button type="button" className="spare-indent-page__icon-btn" onClick={() => openEdit(row)} aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="spare-indent-page__icon-btn" onClick={() => { void remove(row); }} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {canConvert ? (
            <div className="spare-indent-page__convert-bar">
              <button
                type="button"
                className="btn btn-primary spare-indent-page__convert-btn"
                disabled={selectedRows.length === 0}
                onClick={startConvert}
              >
                <ShoppingBag size={16} aria-hidden />
                Convert to PO{selectedRows.length ? ` (${selectedRows.length})` : ''}
              </button>
            </div>
          ) : null}
        </>
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
