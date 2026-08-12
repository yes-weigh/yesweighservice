import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Check, Package, Plus, X } from 'lucide-react';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { ProductNcSelect } from '../../components/catalog/ProductNcSelect';
import { useAuth } from '../../context/AuthContext';
import {
  goodsReceiptLocationLabel,
  goodsReceiptStatusLabel,
  receiveLineLocations,
  saveGoodsReceiptReceiveCheck,
} from '../../lib/admin-goods-receipts';
import { formatInvoiceDate, invoiceErrorMessage, moveFreightLinesToEnd } from '../../lib/invoices';
import {
  listWarehouseZoneRows,
  listWarehouseZones,
} from '../../lib/warehouseLocations/data';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import type { AdminGoodsReceiptDetailOutletContext } from './adminGoodsReceiptDetailContext';

function formatDiff(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

type LocationDraft = {
  key: string;
  zoneId: string;
  zoneRowNumber: string;
  quantity: string;
};

type LineDraft = {
  locations: LocationDraft[];
};

function newLocationDraft(defaultZoneId = ''): LocationDraft {
  return {
    key: crypto.randomUUID(),
    zoneId: defaultZoneId,
    zoneRowNumber: '',
    quantity: '',
  };
}

function locationsEqual(
  a: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>,
  b: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((loc, i) => (
    loc.zoneId === b[i].zoneId
    && loc.zoneRowNumber === b[i].zoneRowNumber
    && loc.quantity === b[i].quantity
  ));
}

function parseDraftLocations(draft: LineDraft): {
  ok: true;
  locations: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>;
  empty: boolean;
} | {
  ok: false;
  error: string;
} {
  const prepared: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }> = [];
  let anyPartial = false;

  for (const row of draft.locations) {
    const zoneId = row.zoneId.trim().toLowerCase();
    const rowRaw = row.zoneRowNumber.trim();
    const qtyRaw = row.quantity.trim();
    const blank = !zoneId && !rowRaw && !qtyRaw;
    if (blank) continue;

    anyPartial = true;
    if (!zoneId || !rowRaw) {
      return { ok: false, error: 'Each warehouse location needs a zone and row.' };
    }
    const zoneRowNumber = Number(rowRaw);
    const quantity = Number(qtyRaw);
    if (!Number.isFinite(zoneRowNumber) || zoneRowNumber < 1) {
      return { ok: false, error: 'Invalid row number.' };
    }
    if (qtyRaw === '' || !Number.isFinite(quantity) || quantity < 0) {
      return { ok: false, error: 'Enter a valid qty for each warehouse location.' };
    }
    if (quantity <= 0) continue;
    prepared.push({
      zoneId,
      zoneRowNumber: Math.floor(zoneRowNumber),
      quantity: Math.floor(quantity),
    });
  }

  return { ok: true, locations: prepared, empty: !anyPartial && prepared.length === 0 };
}

export const AdminGoodsReceiptDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const { goodsReceipt, setGoodsReceipt, goodsReceiptId } = useOutletContext<
    AdminGoodsReceiptDetailOutletContext
  >();

  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);

  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [rowsByZone, setRowsByZone] = useState<Record<string, WarehouseZoneRowDoc[]>>({});
  const [loadingZones, setLoadingZones] = useState(true);

  const lineItems = useMemo(
    () => (goodsReceipt ? moveFreightLinesToEnd(goodsReceipt.lineItems) : []),
    [goodsReceipt],
  );

  const defaultZoneId = zones[0]?.id ?? '';

  useEffect(() => {
    let active = true;
    setLoadingZones(true);
    void listWarehouseZones()
      .then(async nextZones => {
        if (!active) return;
        const rowEntries = await Promise.all(
          nextZones.map(async zone => [zone.id, await listWarehouseZoneRows(zone.id)] as const),
        );
        if (!active) return;
        setZones(nextZones);
        setRowsByZone(Object.fromEntries(rowEntries));
      })
      .catch(() => {
        if (active) {
          setZones([]);
          setRowsByZone({});
        }
      })
      .finally(() => {
        if (active) setLoadingZones(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!goodsReceipt) return;
    const next: Record<string, LineDraft> = {};
    const savedLines = goodsReceipt.receiveCheck?.lines ?? {};
    for (const line of goodsReceipt.lineItems) {
      if (!line.id) continue;
      const savedLocs = receiveLineLocations(savedLines[line.id]);
      next[line.id] = {
        locations: savedLocs.length > 0
          ? savedLocs.map(loc => ({
            key: crypto.randomUUID(),
            zoneId: loc.zoneId,
            zoneRowNumber: String(loc.zoneRowNumber),
            quantity: String(loc.quantity),
          }))
          : [newLocationDraft(defaultZoneId)],
      };
    }
    setLineDrafts(next);
    setSaveError('');
    setSaveOk(false);
  }, [goodsReceipt, defaultZoneId]);

  const dirty = useMemo(() => {
    if (!goodsReceipt) return false;
    const savedLines = goodsReceipt.receiveCheck?.lines ?? {};
    for (const line of goodsReceipt.lineItems) {
      if (!line.id) continue;
      const draft = lineDrafts[line.id] ?? { locations: [newLocationDraft()] };
      const parsed = parseDraftLocations(draft);
      if (!parsed.ok) return true;
      const saved = receiveLineLocations(savedLines[line.id]);
      if (parsed.empty && saved.length === 0) continue;
      if (!locationsEqual(parsed.locations, saved)) return true;
    }
    return false;
  }, [goodsReceipt, lineDrafts]);

  if (!goodsReceipt) return null;

  const setLocationDraft = (
    lineId: string,
    locationKey: string,
    patch: Partial<Omit<LocationDraft, 'key'>>,
  ) => {
    setLineDrafts(prev => {
      const current = prev[lineId] ?? { locations: [newLocationDraft(defaultZoneId)] };
      return {
        ...prev,
        [lineId]: {
          locations: current.locations.map(loc => (
            loc.key === locationKey ? { ...loc, ...patch } : loc
          )),
        },
      };
    });
    setSaveOk(false);
    setSaveError('');
  };

  const addLocation = (lineId: string) => {
    setLineDrafts(prev => {
      const current = prev[lineId] ?? { locations: [] };
      return {
        ...prev,
        [lineId]: {
          locations: [...current.locations, newLocationDraft(defaultZoneId)],
        },
      };
    });
    setSaveOk(false);
    setSaveError('');
  };

  const removeLocation = (lineId: string, locationKey: string) => {
    setLineDrafts(prev => {
      const current = prev[lineId] ?? { locations: [newLocationDraft(defaultZoneId)] };
      const nextLocations = current.locations.filter(loc => loc.key !== locationKey);
      return {
        ...prev,
        [lineId]: {
          locations: nextLocations.length > 0 ? nextLocations : [newLocationDraft(defaultZoneId)],
        },
      };
    });
    setSaveOk(false);
    setSaveError('');
  };

  const handleSave = async () => {
    if (!user?.uid) {
      setSaveError('You must be signed in to save.');
      return;
    }

    const lines: Record<string, {
      locations: Array<{ zoneId: string; zoneRowNumber: number; quantity: number }>;
    }> = {};

    for (const line of goodsReceipt.lineItems) {
      if (!line.id) continue;
      const draft = lineDrafts[line.id] ?? { locations: [newLocationDraft(defaultZoneId)] };
      const parsed = parseDraftLocations(draft);
      if (!parsed.ok) {
        setSaveError(`${parsed.error} (${line.name})`);
        return;
      }
      if (parsed.empty) continue;
      if (parsed.locations.length === 0) {
        setSaveError(`Enter qty for at least one warehouse location on ${line.name}.`);
        return;
      }
      lines[line.id] = { locations: parsed.locations };
    }

    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      const receiveCheck = await saveGoodsReceiptReceiveCheck(
        goodsReceiptId,
        {
          lines,
          lineItems: goodsReceipt.lineItems,
          previous: goodsReceipt.receiveCheck,
        },
        {
          uid: user.uid,
          displayName: user.displayName,
        },
      );
      setGoodsReceipt(prev => (prev ? { ...prev, receiveCheck } : prev));
      setSaveOk(true);
    } catch (err) {
      setSaveError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="panel glass mb-4" style={{ padding: '1rem 1.25rem' }}>
        <div className="flex gap-4 flex-wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="text-muted text-sm">Vendor</div>
            <strong>{goodsReceipt.vendorName ?? '—'}</strong>
            {(goodsReceipt.vendorCity
              || goodsReceipt.vendorState
              || goodsReceipt.vendorCountry) && (
              <p className="text-muted text-sm mt-1 mb-0">
                {[
                  goodsReceipt.vendorCity,
                  goodsReceipt.vendorState,
                  goodsReceipt.vendorCountry,
                ].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <div>
            <div className="text-muted text-sm">Date</div>
            <strong>{formatInvoiceDate(goodsReceipt.date)}</strong>
          </div>
          {goodsReceipt.dueDate && (
            <div>
              <div className="text-muted text-sm">Due date</div>
              <strong>{formatInvoiceDate(goodsReceipt.dueDate)}</strong>
            </div>
          )}
          <div>
            <div className="text-muted text-sm">Branch</div>
            <strong>{goodsReceiptLocationLabel(goodsReceipt.inventorySite)}</strong>
          </div>
          <div>
            <div className="text-muted text-sm">Status</div>
            <strong>{goodsReceiptStatusLabel(goodsReceipt.status)}</strong>
          </div>
        </div>
        {goodsReceipt.referenceNumber && (
          <p className="text-muted text-sm mt-3 mb-0">Ref {goodsReceipt.referenceNumber}</p>
        )}
        {goodsReceipt.notes && (
          <p className="text-muted text-sm mt-2 mb-0">{goodsReceipt.notes}</p>
        )}
      </section>

      <section className="invoice-detail-items panel glass goods-receipt-receive">
        <div className="goods-receipt-receive__header">
          <h3 className="invoice-detail-items__title mb-0">
            Items{lineItems.length ? ` (${lineItems.length})` : ''}
          </h3>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {saveError && (
          <div className="products-inline-error panel glass mt-3" role="alert">
            <AlertCircle size={16} />
            <span>{saveError}</span>
          </div>
        )}
        {saveOk && !dirty && (
          <p className="goods-receipt-receive__saved text-sm mt-3 mb-0" role="status">
            <Check size={14} aria-hidden />
            Saved
            {goodsReceipt.receiveCheck?.updatedByName
              ? ` · ${goodsReceipt.receiveCheck.updatedByName}`
              : ''}
          </p>
        )}

        {lineItems.length ? (
          <ul className="invoice-detail-item-list mt-3">
            {lineItems.map(item => {
              const ordered = Number(item.quantity ?? 0);
              const draft = lineDrafts[item.id] ?? {
                locations: [newLocationDraft(defaultZoneId)],
              };
              const receivedTotal = draft.locations.reduce((sum, loc) => {
                const n = Number(loc.quantity);
                return sum + (Number.isFinite(n) && n > 0 ? n : 0);
              }, 0);
              const hasAnyQty = draft.locations.some(loc => loc.quantity.trim() !== '');
              const diff = hasAnyQty ? receivedTotal - ordered : null;
              const diffClass = diff == null
                ? ''
                : diff === 0
                  ? 'is-match'
                  : diff > 0
                    ? 'is-over'
                    : 'is-under';

              return (
                <li key={item.id} className="invoice-detail-item admin-invoice-detail-item">
                  <div className="invoice-detail-item__image-wrap">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="invoice-detail-item__image"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="invoice-detail-item__placeholder" aria-hidden>
                        <Package size={22} />
                      </span>
                    )}
                  </div>
                  <DocumentLineItemSpec
                    name={item.name}
                    sku={item.sku}
                    description={item.description}
                  >
                    <div className="goods-receipt-receive__summary">
                      <label className="goods-receipt-receive__field">
                        <span className="goods-receipt-receive__label">Ordered qty</span>
                        <input
                          type="text"
                          className="goods-receipt-receive__input"
                          value={String(ordered)}
                          readOnly
                          tabIndex={-1}
                          aria-readonly="true"
                        />
                      </label>
                      <label className="goods-receipt-receive__field">
                        <span className="goods-receipt-receive__label">Received qty</span>
                        <input
                          type="text"
                          className="goods-receipt-receive__input"
                          value={hasAnyQty ? String(receivedTotal) : ''}
                          placeholder="—"
                          readOnly
                          tabIndex={-1}
                          aria-readonly="true"
                          aria-label={`Received qty for ${item.name}`}
                        />
                      </label>
                      <div className="goods-receipt-receive__diff-wrap">
                        <span className="goods-receipt-receive__label">Difference</span>
                        <strong
                          className={`goods-receipt-receive__diff ${diffClass}`.trim()}
                          aria-label="Difference received minus ordered"
                        >
                          {diff == null ? '—' : formatDiff(diff)}
                        </strong>
                      </div>
                    </div>

                    <div className="goods-receipt-receive__locations">
                      <span className="goods-receipt-receive__label">Warehouse locations</span>
                      {draft.locations.map(loc => {
                        const zoneRows = loc.zoneId ? (rowsByZone[loc.zoneId] ?? []) : [];
                        return (
                          <div
                            key={loc.key}
                            className="goods-receipt-receive__location-row"
                          >
                            <label className="goods-receipt-receive__field">
                              <span className="goods-receipt-receive__label">Zone</span>
                              <ProductNcSelect
                                aria-label={`Zone for ${item.name}`}
                                value={loc.zoneId}
                                disabled={loadingZones || saving}
                                placeholder={loadingZones ? 'Loading…' : 'Select zone'}
                                onChange={next => setLocationDraft(item.id, loc.key, {
                                  zoneId: next,
                                  zoneRowNumber: '',
                                })}
                                options={zones.map(zone => ({
                                  value: zone.id,
                                  label: `${zone.id.toUpperCase()}${zone.label ? ` — ${zone.label}` : ''}`,
                                }))}
                              />
                            </label>
                            <label className="goods-receipt-receive__field">
                              <span className="goods-receipt-receive__label">Row</span>
                              <ProductNcSelect
                                aria-label={`Row for ${item.name}`}
                                value={loc.zoneRowNumber}
                                disabled={saving || !loc.zoneId || zoneRows.length === 0}
                                placeholder={!loc.zoneId ? 'Select zone first' : 'Select row'}
                                onChange={next => setLocationDraft(item.id, loc.key, {
                                  zoneRowNumber: next,
                                })}
                                options={zoneRows.map(row => ({
                                  value: String(row.number),
                                  label: row.label
                                    ? `${row.number} — ${row.label}`
                                    : String(row.number),
                                }))}
                              />
                            </label>
                            <label className="goods-receipt-receive__field goods-receipt-receive__field--qty">
                              <span className="goods-receipt-receive__label">Qty</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                className="goods-receipt-receive__input goods-receipt-receive__input--editable"
                                value={loc.quantity}
                                placeholder="—"
                                disabled={saving}
                                onChange={e => setLocationDraft(item.id, loc.key, {
                                  quantity: e.target.value,
                                })}
                                aria-label={`Qty at location for ${item.name}`}
                              />
                            </label>
                            <button
                              type="button"
                              className="goods-receipt-receive__remove-btn"
                              disabled={saving || draft.locations.length <= 1}
                              onClick={() => removeLocation(item.id, loc.key)}
                              aria-label="Remove warehouse location"
                            >
                              <X size={14} aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className="goods-receipt-receive__add-btn"
                        disabled={saving}
                        onClick={() => addLocation(item.id)}
                      >
                        <Plus size={14} aria-hidden />
                        Add warehouse location
                      </button>
                    </div>
                  </DocumentLineItemSpec>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="invoice-detail-items__empty text-muted text-sm">No line items on this bill.</p>
        )}
      </section>
    </>
  );
};
