import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  listWarehouseZoneRows,
  listWarehouseZones,
} from '../../lib/warehouseLocations/data';
import type { CatalogInventorySite } from '../../types/catalog-site-inventory';
import type { CatalogNcLocationKey } from '../../types/catalog-nc';
import { ncLocationKey } from '../../types/catalog-nc';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import {
  BIN_NUMBERS,
  ROW_NUMBERS,
  VALID_RACK_LETTERS,
  type BinNumber,
  type RowNumber,
} from '../../types/yes-store';
import { ProductNcSelect } from './ProductNcSelect';

export const ProductNcLocationPicker: React.FC<{
  site: CatalogInventorySite;
  value: CatalogNcLocationKey | null;
  onChange: (location: CatalogNcLocationKey | null) => void;
  disabled?: boolean;
}> = ({ site, value, onChange, disabled = false }) => {
  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [rowsByZone, setRowsByZone] = useState<Record<string, WarehouseZoneRowDoc[]>>({});
  const [loadingZones, setLoadingZones] = useState(site === 'cochin');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [zoneId, setZoneId] = useState(value?.zoneId?.trim().toLowerCase() ?? '');
  const [zoneRowNumber, setZoneRowNumber] = useState(
    value?.zoneRowNumber != null ? String(value.zoneRowNumber) : '',
  );
  const [rackId, setRackId] = useState(value?.rackId?.trim().toLowerCase() ?? '');
  const [rowNumber, setRowNumber] = useState(
    value?.rowNumber != null ? String(value.rowNumber) : '',
  );
  const [binNumber, setBinNumber] = useState(
    value?.binNumber != null ? String(value.binNumber) : '',
  );

  useEffect(() => {
    if (site !== 'cochin') return;
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
  }, [site]);

  const zoneRows = zoneId ? (rowsByZone[zoneId] ?? []) : [];

  const nextLocation = useMemo((): CatalogNcLocationKey | null => {
    if (site === 'cochin') {
      if (!zoneId || !zoneRowNumber) return null;
      const row = Number(zoneRowNumber);
      if (!Number.isInteger(row) || row < 1) return null;
      return { site, zoneId, zoneRowNumber: row };
    }
    if (!rackId || !rowNumber || !binNumber) return null;
    const row = Number(rowNumber);
    const bin = Number(binNumber);
    if (!ROW_NUMBERS.includes(row as RowNumber)) return null;
    if (!BIN_NUMBERS.includes(bin as BinNumber)) return null;
    return { site, rackId, rowNumber: row, binNumber: bin };
  }, [site, zoneId, zoneRowNumber, rackId, rowNumber, binNumber]);

  useEffect(() => {
    const nextKey = nextLocation ? ncLocationKey(nextLocation) : '';
    const currentKey = value ? ncLocationKey(value) : '';
    if (nextKey === currentKey) return;
    onChangeRef.current(nextLocation);
  }, [nextLocation, value]);

  if (site === 'cochin') {
    return (
      <>
        <label>
          <span>Zone</span>
          <ProductNcSelect
            aria-label="Zone"
            value={zoneId}
            disabled={disabled || loadingZones}
            placeholder={loadingZones ? 'Loading…' : 'Select zone'}
            onChange={next => {
              setZoneId(next);
              setZoneRowNumber('');
            }}
            options={zones.map(zone => ({
              value: zone.id,
              label: `${zone.id.toUpperCase()}${zone.label ? ` — ${zone.label}` : ''}`,
            }))}
          />
        </label>
        <label>
          <span>Row</span>
          <ProductNcSelect
            aria-label="Row"
            value={zoneRowNumber}
            disabled={disabled || !zoneId || zoneRows.length === 0}
            placeholder={!zoneId ? 'Select zone first' : 'Select row'}
            onChange={setZoneRowNumber}
            options={zoneRows.map(row => ({
              value: String(row.number),
              label: String(row.number),
            }))}
          />
        </label>
        {zones.length === 0 && !loadingZones && (
          <p className="text-muted text-sm product-nc-location-picker__hint">
            Add warehouse zones in Settings → Warehouse first.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <label>
        <span>Rack</span>
        <ProductNcSelect
          aria-label="Rack"
          value={rackId}
          disabled={disabled}
          placeholder="Select rack"
          onChange={next => {
            setRackId(next);
            setRowNumber('');
            setBinNumber('');
          }}
          options={VALID_RACK_LETTERS.map(letter => ({
            value: letter,
            label: letter.toUpperCase(),
          }))}
        />
      </label>
      <label>
        <span>Row</span>
        <ProductNcSelect
          aria-label="Row"
          value={rowNumber}
          disabled={disabled || !rackId}
          placeholder={!rackId ? 'Select rack first' : 'Select row'}
          onChange={next => {
            setRowNumber(next);
            setBinNumber('');
          }}
          options={ROW_NUMBERS.map(n => ({ value: String(n), label: String(n) }))}
        />
      </label>
      <label>
        <span>Bin</span>
        <ProductNcSelect
          aria-label="Bin"
          value={binNumber}
          disabled={disabled || !rackId || !rowNumber}
          placeholder={!rowNumber ? 'Select row first' : 'Select bin'}
          onChange={setBinNumber}
          options={BIN_NUMBERS.map(n => ({ value: String(n), label: String(n) }))}
        />
      </label>
    </>
  );
};
