import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import {
  formatStockQuantity,
  catalogProductWarehouseStock,
} from '../../lib/catalog';
import type { CatalogInventorySiteConfig } from '../../lib/catalogInventorySites';
import {
  calculateGroupTotals,
  formatQtyDifference,
  type InventoryAuditGroupTotals,
} from '../../lib/yesStore/inventoryAudit';
import {
  listWarehouseZoneRows,
  listWarehouseZones,
} from '../../lib/warehouseLocations/data';
import { saveCatalogSiteInventory } from '../../lib/catalogSiteInventory/data';
import { recordCatalogProductAudit } from '../../lib/catalogProductAudit/data';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import {
  getCatalogSiteInventoryLocations,
  type CatalogSiteInventoryDoc,
  type CatalogSiteInventoryLocation,
} from '../../types/catalog-site-inventory';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import {
  formatItemLocationShort,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';

export interface SiteStockAuditAdjustment {
  /** Zoho-adjusted audited total for this site (last audited − Zoho movement). */
  adjustedQty: number;
  /** Last counted location total before Zoho adjustment. */
  lastAuditedQty: number;
  /** Zoho movement applied to audited qty (usually negative after sales). */
  zohoAdjustedQty: number;
}

function allocateAdjustedLocationQtys(
  locations: CatalogSiteInventoryLocation[],
  adjustment: SiteStockAuditAdjustment | null | undefined,
): Array<{
  location: CatalogSiteInventoryLocation;
  displayQty: number;
  lastAuditedQty: number;
  zohoAdjustedQty: number;
}> {
  if (!adjustment || locations.length === 0) {
    return locations.map(location => ({
      location,
      displayQty: location.quantity,
      lastAuditedQty: location.quantity,
      zohoAdjustedQty: 0,
    }));
  }

  const totalLive = locations.reduce((sum, loc) => sum + loc.quantity, 0);
  if (totalLive <= 0 || locations.length === 1) {
    const only = locations[0];
    return locations.map(location => ({
      location,
      displayQty: location === only ? adjustment.adjustedQty : 0,
      lastAuditedQty: location.quantity,
      zohoAdjustedQty: location === only ? adjustment.zohoAdjustedQty : 0,
    }));
  }

  let allocatedDelta = 0;
  return locations.map((location, index) => {
    const isLast = index === locations.length - 1;
    const share = location.quantity / totalLive;
    const rowDelta = isLast
      ? adjustment.zohoAdjustedQty - allocatedDelta
      : Math.round(share * adjustment.zohoAdjustedQty);
    if (!isLast) allocatedDelta += rowDelta;
    return {
      location,
      displayQty: location.quantity + rowDelta,
      lastAuditedQty: location.quantity,
      zohoAdjustedQty: rowDelta,
    };
  });
}

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
      <table className="product-site-stock__table product-site-stock__table--hero-values">
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

function LocationDropdownField({
  label,
  value,
  onChange,
  disabled,
  placeholder = 'Select',
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="product-site-stock__dropdown-field">
      <span className="product-site-stock__dropdown-label">{label}</span>
      <select
        className="product-site-stock__dropdown"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
      >
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CochinEditRow({
  row,
  zones,
  zoneRows,
  saving,
  canRemove,
  onUpdate,
  onRemove,
}: {
  row: EditableCochinRow;
  zones: WarehouseZoneDoc[];
  zoneRows: WarehouseZoneRowDoc[];
  saving: boolean;
  canRemove: boolean;
  onUpdate: (patch: Partial<EditableCochinRow>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="product-site-stock__edit-row">
      <LocationDropdownField
        label="Zone"
        value={row.zoneId}
        disabled={saving || zones.length === 0}
        onChange={zoneId => onUpdate({ zoneId, zoneRowNumber: '' })}
        options={zones.map(zone => ({
          value: zone.id,
          label: `${zone.id.toUpperCase()}${zone.label ? ` — ${zone.label}` : ''}`,
        }))}
      />
      <LocationDropdownField
        label="Row"
        value={row.zoneRowNumber}
        disabled={saving || !row.zoneId || zoneRows.length === 0}
        onChange={zoneRowNumber => onUpdate({ zoneRowNumber })}
        options={zoneRows.map(zoneRow => ({
          value: String(zoneRow.number),
          label: String(zoneRow.number),
        }))}
      />
      <label className="product-site-stock__dropdown-field">
        <span className="product-site-stock__dropdown-label">Qty</span>
        <input
          type="number"
          className="product-site-stock__dropdown product-site-stock__dropdown--qty"
          min={0}
          step={1}
          value={row.quantity}
          onChange={e => onUpdate({ quantity: e.target.value })}
          disabled={saving}
          aria-label="Counted qty"
        />
      </label>
      <button
        type="button"
        className="product-site-stock__row-remove product-site-stock__row-remove--inline"
        onClick={onRemove}
        disabled={saving || !canRemove}
        aria-label="Remove row"
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

function CochinLocationSection({
  product,
  siteConfig,
  record,
  canEdit,
  editorUid,
  editorName,
  onSaved,
  auditAdjustment,
}: {
  product: CatalogProduct;
  siteConfig: CatalogInventorySiteConfig;
  record: CatalogSiteInventoryDoc | null;
  canEdit: boolean;
  editorUid: string;
  editorName?: string | null;
  onSaved: (record: CatalogSiteInventoryDoc) => void;
  auditAdjustment?: SiteStockAuditAdjustment | null;
}) {
  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [rowsByZone, setRowsByZone] = useState<Record<string, WarehouseZoneRowDoc[]>>({});
  const [rows, setRows] = useState<EditableCochinRow[]>(() => [createEditableRow()]);
  const [editing, setEditing] = useState(false);
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
    if (!editing) {
      setRows(rowsFromRecord(record, zones[0]?.id ?? ''));
    }
  }, [record, zones, editing]);

  const readOnlyLocations = useMemo(
    () => getCatalogSiteInventoryLocations(record),
    [record],
  );

  const displayLocations = useMemo(
    () => allocateAdjustedLocationQtys(readOnlyLocations, auditAdjustment),
    [readOnlyLocations, auditAdjustment],
  );

  const showAuditHints = Boolean(
    auditAdjustment
    && auditAdjustment.zohoAdjustedQty !== 0
    && !editing,
  );

  const startEditing = () => {
    setRows(rowsFromRecord(record, zones[0]?.id ?? ''));
    setError('');
    setEditing(true);
  };

  const cancelEditing = () => {
    setRows(rowsFromRecord(record, zones[0]?.id ?? ''));
    setError('');
    setEditing(false);
  };

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
      setEditing(false);
      void recordCatalogProductAudit(product.id, 'cochin_inventory').catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Cochin stock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={[
        'product-site-stock',
        editing ? 'product-site-stock--editing' : '',
      ].filter(Boolean).join(' ')}
    >
      <header className="product-site-stock__header">
        <h3 className="product-site-stock__title">{siteConfig.warehouseName}</h3>
        <div className="product-site-stock__header-actions">
          <SiteTypeBadge site={siteConfig.site} />
          {canEdit && (
            <button
              type="button"
              className={[
                'product-site-stock__edit-btn',
                editing ? 'product-site-stock__edit-btn--active' : '',
              ].filter(Boolean).join(' ')}
              title={editing ? 'Cancel editing' : 'Edit warehouse locations'}
              aria-label={editing ? 'Cancel editing' : 'Edit warehouse locations'}
              aria-pressed={editing}
              onClick={() => (editing ? cancelEditing() : startEditing())}
            >
              {editing ? <X size={15} aria-hidden /> : <Pencil size={15} aria-hidden />}
            </button>
          )}
        </div>
      </header>

      {editing && canEdit ? (
        <div className="product-site-stock__editor-modern">
          {rows.map(row => (
            <CochinEditRow
              key={row.id}
              row={row}
              zones={zones}
              zoneRows={row.zoneId ? (rowsByZone[row.zoneId] ?? []) : []}
              saving={saving}
              canRemove={rows.length > 1}
              onUpdate={patch => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
            />
          ))}

          <button
            type="button"
            className="product-site-stock__add-row-btn"
            disabled={saving}
            onClick={addRow}
          >
            <Plus size={14} aria-hidden />
            Add row
          </button>

          {zones.length === 0 && (
            <p className="product-site-stock__hint text-muted text-sm">
              Add warehouse zones in Settings → Warehouse first.
            </p>
          )}
          {error && <p className="product-site-stock__error text-sm">{error}</p>}

          <div className="product-site-stock__editor-toolbar product-site-stock__editor-toolbar--modern">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={saving}
              onClick={cancelEditing}
            >
              Cancel
            </button>
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
      ) : displayLocations.length > 0 ? (
        <div className="product-site-stock__table-wrap product-site-stock__table-wrap--warehouse">
          <table className="product-site-stock__table product-site-stock__table--hero-values">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Row</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {displayLocations.map(({ location, displayQty, lastAuditedQty, zohoAdjustedQty }, index) => (
                <tr key={`${location.zoneId}-${location.zoneRowNumber}-${index}`}>
                  <td>{location.zoneId.toUpperCase()}</td>
                  <td>{location.zoneRowNumber}</td>
                  <td className="product-site-stock__qty-cell">
                    <span className="product-site-stock__qty-main">
                      {formatStockQuantity(displayQty, product.unit)}
                    </span>
                    {showAuditHints && (
                      <span className="product-site-stock__qty-meta">
                        <span>Last audited {formatStockQuantity(lastAuditedQty, product.unit)}</span>
                        <span>
                          Zoho adj. {formatQtyDifference(zohoAdjustedQty)} {product.unit}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="product-site-stock__empty text-muted text-sm">
          {canEdit
            ? 'No warehouse count recorded yet. Tap the pen icon to add locations.'
            : 'No warehouse count recorded yet.'}
        </p>
      )}
    </section>
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
  auditAdjustment?: SiteStockAuditAdjustment | null;
}> = ({
  product,
  siteConfig,
  auditItems,
  cochinRecord,
  canEditCochin,
  editorUid,
  editorName,
  onCochinSaved,
  auditAdjustment = null,
}) => {
  const headOfficeTotals = useMemo(() => {
    if (siteConfig.site !== 'head_office' || auditItems.length === 0) return null;
    const zohoQty = catalogProductWarehouseStock(product, siteConfig.warehouseName);
    return calculateGroupTotals(auditItems, {
      ...product,
      stock: zohoQty,
    });
  }, [siteConfig.site, siteConfig.warehouseName, auditItems, product]);

  if (siteConfig.site === 'cochin') {
    return (
      <CochinLocationSection
        product={product}
        siteConfig={siteConfig}
        record={cochinRecord}
        canEdit={canEditCochin}
        editorUid={editorUid}
        editorName={editorName}
        onSaved={onCochinSaved}
        auditAdjustment={auditAdjustment}
      />
    );
  }

  return (
    <section className="product-site-stock">
      <header className="product-site-stock__header">
        <h3 className="product-site-stock__title">{siteConfig.warehouseName}</h3>
        <SiteTypeBadge site={siteConfig.site} />
      </header>

      {headOfficeTotals && headOfficeTotals.parts.length > 0 ? (
        <HeadOfficeLocationTable
          product={product}
          auditItems={auditItems}
          auditTotals={headOfficeTotals}
        />
      ) : (
        <p className="product-site-stock__empty text-muted text-sm">
          No store room bins linked to this item yet.
        </p>
      )}
    </section>
  );
};
