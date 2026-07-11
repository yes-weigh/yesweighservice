import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Printer, Save, Trash2, X } from 'lucide-react';
import {
  formatStockQuantity,
  catalogProductWarehouseStock,
} from '../../lib/catalog';
import type { CatalogInventorySiteConfig } from '../../lib/catalogInventorySites';
import {
  calculateGroupTotals,
  type InventoryAuditGroupTotals,
} from '../../lib/yesStore/inventoryAudit';
import { formatAuditDateTime } from '../../lib/yesStore/format';
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
} from '../../types/catalog-site-inventory';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import {
  formatItemLocationShort,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';
import {
  BinLabelPrintDialog,
  binLabelFieldsFromStoreItem,
} from './BinLabelPrintDialog';
import type { BinLabelFields } from '../../lib/localPrinterLabel';

function QtyWithAuditStamp({
  qtyLabel,
  auditedAt,
}: {
  qtyLabel: string;
  auditedAt?: string | null;
}) {
  const stamp = auditedAt ? formatAuditDateTime(auditedAt) : '';
  const hasStamp = Boolean(auditedAt && stamp && stamp !== '—');

  return (
    <td className="product-site-stock__qty-cell">
      <span className="product-site-stock__qty-main">{qtyLabel}</span>
      {hasStamp && (
        <span className="product-site-stock__qty-meta">{stamp}</span>
      )}
    </td>
  );
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
  const [printFields, setPrintFields] = useState<BinLabelFields | null>(null);

  return (
    <div className="product-site-stock__table-wrap product-site-stock__table-wrap--store">
      <table className="product-site-stock__table product-site-stock__table--hero-values">
        <thead>
          <tr>
            <th>Rack</th>
            <th>Row</th>
            <th>Bin</th>
            {isBundle && <th>Part</th>}
            <th>Qty</th>
            <th className="product-site-stock__actions-col" aria-label="Actions" />
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
            const auditedAt =
              binItem.lastAuditedAt ?? binItem.countedAt ?? binItem.updatedAt;

            return (
              <tr key={part.itemId}>
                <td>{binItem.rackId.toUpperCase()}</td>
                <td>{binItem.rowNumber}</td>
                <td>{binItem.binNumber}</td>
                {isBundle && (
                  <td>{showPartLabel ? part.partLabel : '—'}</td>
                )}
                <QtyWithAuditStamp
                  qtyLabel={formatStockQuantity(readItemQuantity(binItem), product.unit)}
                  auditedAt={auditedAt}
                />
                <td className="product-site-stock__actions-cell">
                  <button
                    type="button"
                    className="product-site-stock__print-btn"
                    onClick={() => setPrintFields(binLabelFieldsFromStoreItem(product, binItem))}
                    aria-label="Print label"
                    title="Print label"
                  >
                    <Printer size={16} aria-hidden />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {printFields && (
        <BinLabelPrintDialog
          fields={printFields}
          onClose={() => setPrintFields(null)}
        />
      )}
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
}: {
  product: CatalogProduct;
  siteConfig: CatalogInventorySiteConfig;
  record: CatalogSiteInventoryDoc | null;
  canEdit: boolean;
  editorUid: string;
  editorName?: string | null;
  onSaved: (record: CatalogSiteInventoryDoc) => void;
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
      ) : readOnlyLocations.length > 0 ? (
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
              {readOnlyLocations.map((location, index) => (
                <tr key={`${location.zoneId}-${location.zoneRowNumber}-${index}`}>
                  <td>{location.zoneId.toUpperCase()}</td>
                  <td>{location.zoneRowNumber}</td>
                  <QtyWithAuditStamp
                    qtyLabel={formatStockQuantity(location.quantity, product.unit)}
                    auditedAt={record?.updatedAt}
                  />
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
