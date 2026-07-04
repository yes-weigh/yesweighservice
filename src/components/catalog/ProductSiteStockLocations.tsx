import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  formatStockQuantity,
  catalogProductWarehouseStock,
} from '../../lib/catalog';
import {
  CATALOG_INVENTORY_SITE_CONFIG,
  type CatalogInventorySiteConfig,
} from '../../lib/catalogInventorySites';
import {
  calculateGroupTotals,
  type InventoryAuditGroupTotals,
} from '../../lib/yesStore/inventoryAudit';
import {
  listWarehouseZoneRows,
  listWarehouseZones,
} from '../../lib/warehouseLocations/data';
import { saveCatalogSiteInventory } from '../../lib/catalogSiteInventory/data';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import {
  getCatalogSiteInventoryLocations,
  type CatalogSiteInventoryDoc,
} from '../../types/catalog-site-inventory';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import {
  formatItemLocationShort,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';

function SiteTypeBadge({ site }: { site: CatalogInventorySiteConfig['site'] }) {
  return (
    <span
      className={[
        'product-site-stock__badge',
        site === 'head_office' ? 'product-site-stock__badge--store' : 'product-site-stock__badge--warehouse',
      ].join(' ')}
    >
      {site === 'head_office' ? 'Store room' : 'Warehouse'}
    </span>
  );
}

function HeadOfficeLocationTable({
  product,
  auditItems,
  auditTotals,
}: {
  product: CatalogProduct;
  auditItems: YesStoreItemDoc[];
  auditTotals: InventoryAuditGroupTotals;
}) {
  const isBundle = auditTotals.mode === 'bundle';
  const showQtyColumn = auditTotals.parts.length > 1;

  return (
    <div className="product-site-stock__table-wrap product-site-stock__table-wrap--store">
      <table className="product-site-stock__table">
        <thead>
          <tr>
            <th>Rack</th>
            <th>Row</th>
            <th>Bin</th>
            {isBundle && <th>Part</th>}
            {showQtyColumn && <th>Qty</th>}
          </tr>
        </thead>
        <tbody>
          {auditTotals.parts.map(part => {
            const binItem = auditItems.find(item => item.id === part.itemId);
            if (!binItem) return null;

            const locationShort = formatItemLocationShort(
              binItem.rackId,
              binItem.rowNumber,
              binItem.binNumber,
            );
            const showPartLabel =
              isBundle && part.partLabel.trim() !== locationShort;

            return (
              <tr key={part.itemId}>
                <td>{binItem.rackId.toUpperCase()}</td>
                <td>{binItem.rowNumber}</td>
                <td>{binItem.binNumber}</td>
                {isBundle && (
                  <td>{showPartLabel ? part.partLabel : '—'}</td>
                )}
                {showQtyColumn && (
                  <td className="product-site-stock__qty-cell">
                    {formatStockQuantity(readItemQuantity(binItem), product.unit)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type EditableCochinRow = {
  id: string;
  zoneId: string;
  zoneRowNumber: string;
  quantity: string;
};

function createEditableRow(defaultZoneId = ''): EditableCochinRow {
  return {
    id: crypto.randomUUID(),
    zoneId: defaultZoneId,
    zoneRowNumber: '',
    quantity: '0',
  };
}

function rowsFromRecord(
  record: CatalogSiteInventoryDoc | null,
  defaultZoneId: string,
): EditableCochinRow[] {
  const locations = getCatalogSiteInventoryLocations(record);
  if (locations.length === 0) return [createEditableRow(defaultZoneId)];
  return locations.map(loc => ({
    id: crypto.randomUUID(),
    zoneId: loc.zoneId,
    zoneRowNumber: String(loc.zoneRowNumber),
    quantity: String(loc.quantity),
  }));
}

function CochinLocationEditor({
  product,
  record,
  canEdit,
  editorUid,
  editorName,
  onSaved,
}: {
  product: CatalogProduct;
  record: CatalogSiteInventoryDoc | null;
  canEdit: boolean;
  editorUid: string;
  editorName?: string | null;
  onSaved: (record: CatalogSiteInventoryDoc) => void;
}) {
  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [rowsByZone, setRowsByZone] = useState<Record<string, WarehouseZoneRowDoc[]>>({});
  const [rows, setRows] = useState<EditableCochinRow[]>(() => [createEditableRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void listWarehouseZones().then(async nextZones => {
      if (!active) return;
      const rowEntries = await Promise.all(
        nextZones.map(async zone => [zone.id, await listWarehouseZoneRows(zone.id)] as const),
      );
      if (!active) return;
      setZones(nextZones);
      setRowsByZone(Object.fromEntries(rowEntries));
    }).catch(() => {
      if (active) setZones([]);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRows(rowsFromRecord(record, zones[0]?.id ?? ''));
  }, [record, zones]);

  const readOnlyLocations = useMemo(
    () => getCatalogSiteInventoryLocations(record),
    [record],
  );

  const updateRow = (id: string, patch: Partial<EditableCochinRow>) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows(prev => [...prev, createEditableRow(zones[0]?.id ?? '')]);
  };

  const removeRow = (id: string) => {
    setRows(prev => (prev.length <= 1 ? prev : prev.filter(row => row.id !== id)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await saveCatalogSiteInventory({
        catalogProductId: product.id,
        site: 'cochin',
        locations: rows
          .filter(row => row.zoneId && row.zoneRowNumber)
          .map(row => ({
            zoneId: row.zoneId,
            zoneRowNumber: Number(row.zoneRowNumber),
            quantity: Number(row.quantity),
          })),
        updatedByUid: editorUid,
        updatedByName: editorName,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Cochin stock.');
    } finally {
      setSaving(false);
    }
  };

  if (canEdit) {
    return (
      <div className="product-site-stock__editor-table">
        <div className="product-site-stock__table-wrap product-site-stock__table-wrap--warehouse">
          <table className="product-site-stock__table product-site-stock__table--editable">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Row</th>
                <th>Counted qty</th>
                <th className="product-site-stock__table-action-col">
                  <button
                    type="button"
                    className="product-site-stock__row-add"
                    onClick={addRow}
                    disabled={saving}
                    aria-label="Add row"
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const zoneRows = row.zoneId ? (rowsByZone[row.zoneId] ?? []) : [];
                return (
                  <tr key={row.id}>
                    <td>
                      <select
                        className="product-site-stock__table-input"
                        value={row.zoneId}
                        onChange={e => updateRow(row.id, {
                          zoneId: e.target.value,
                          zoneRowNumber: '',
                        })}
                        disabled={saving}
                        aria-label="Zone"
                      >
                        <option value="">Select</option>
                        {zones.map(zone => (
                          <option key={zone.id} value={zone.id}>
                            {zone.id.toUpperCase()}{zone.label ? ` — ${zone.label}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="product-site-stock__table-input"
                        value={row.zoneRowNumber}
                        onChange={e => updateRow(row.id, { zoneRowNumber: e.target.value })}
                        disabled={saving || !row.zoneId}
                        aria-label="Row"
                      >
                        <option value="">Select</option>
                        {zoneRows.map(zoneRow => (
                          <option key={zoneRow.id} value={zoneRow.number}>
                            {zoneRow.number}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="product-site-stock__table-input product-site-stock__table-input--qty"
                        min={0}
                        step={1}
                        value={row.quantity}
                        onChange={e => updateRow(row.id, { quantity: e.target.value })}
                        disabled={saving}
                        aria-label="Counted qty"
                      />
                    </td>
                    <td className="product-site-stock__table-action-col">
                      <button
                        type="button"
                        className="product-site-stock__row-remove"
                        onClick={() => removeRow(row.id)}
                        disabled={saving || rows.length <= 1}
                        aria-label="Remove row"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {zones.length === 0 && (
          <p className="text-muted text-sm">Add warehouse zones in Settings → Warehouse first.</p>
        )}
        {error && <p className="product-site-stock__error text-sm">{error}</p>}

        <div className="product-site-stock__editor-toolbar">
          <button
            type="button"
            className="btn btn-primary btn-sm product-site-stock__save-btn"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            <Save size={14} aria-hidden />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  if (readOnlyLocations.length === 0) {
    return (
      <p className="product-site-stock__empty text-muted text-sm">
        No warehouse count recorded yet.
      </p>
    );
  }

  return (
    <div className="product-site-stock__table-wrap product-site-stock__table-wrap--warehouse">
      <table className="product-site-stock__table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Row</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {readOnlyLocations.map((loc, index) => (
            <tr key={`${loc.zoneId}-${loc.zoneRowNumber}-${index}`}>
              <td>{loc.zoneId.toUpperCase()}</td>
              <td>{loc.zoneRowNumber}</td>
              <td className="product-site-stock__qty-cell">
                {formatStockQuantity(loc.quantity, product.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ProductSiteStockLocations: React.FC<{
  product: CatalogProductDetail;
  siteConfig: CatalogInventorySiteConfig;
  auditItems: YesStoreItemDoc[];
  cochinRecord: CatalogSiteInventoryDoc | null;
  canEditCochin: boolean;
  editorUid: string;
  editorName?: string | null;
  onCochinSaved: (record: CatalogSiteInventoryDoc) => void;
}> = ({
  product,
  siteConfig,
  auditItems,
  cochinRecord,
  canEditCochin,
  editorUid,
  editorName,
  onCochinSaved,
}) => {
  const headOfficeTotals = useMemo(() => {
    if (siteConfig.site !== 'head_office' || auditItems.length === 0) return null;
    const zohoQty = catalogProductWarehouseStock(product, siteConfig.warehouseName);
    return calculateGroupTotals(auditItems, {
      ...product,
      stock: zohoQty,
    });
  }, [siteConfig.site, siteConfig.warehouseName, auditItems, product]);

  return (
    <section className="product-site-stock">
      <header className="product-site-stock__header">
        <h3 className="product-site-stock__title">{siteConfig.warehouseName}</h3>
        <SiteTypeBadge site={siteConfig.site} />
      </header>

      {siteConfig.site === 'head_office' ? (
        headOfficeTotals && headOfficeTotals.parts.length > 0 ? (
          <HeadOfficeLocationTable
            product={product}
            auditItems={auditItems}
            auditTotals={headOfficeTotals}
          />
        ) : (
          <p className="product-site-stock__empty text-muted text-sm">
            No store room bins linked to this item yet.
          </p>
        )
      ) : (
        <CochinLocationEditor
          product={product}
          record={cochinRecord}
          canEdit={canEditCochin}
          editorUid={editorUid}
          editorName={editorName}
          onSaved={onCochinSaved}
        />
      )}
    </section>
  );
};
