import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../../types/warehouse-locations';
import {
  createWarehouseZone,
  createWarehouseZoneRow,
  deleteWarehouseZone,
  deleteWarehouseZoneRow,
  listWarehouseZoneRows,
  listWarehouseZones,
  nextWarehouseRowNumber,
  unusedZoneLetters,
} from '../../../lib/warehouseLocations/data';

export const WarehouseLocationsTab: React.FC = () => {
  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [rowsByZone, setRowsByZone] = useState<Record<string, WarehouseZoneRowDoc[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newZoneLetter, setNewZoneLetter] = useState('');
  const [newZoneLabel, setNewZoneLabel] = useState('');
  const [showAddZone, setShowAddZone] = useState(false);

  const availableLetters = useMemo(() => unusedZoneLetters(zones), [zones]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextZones = await listWarehouseZones();
      const rowEntries = await Promise.all(
        nextZones.map(async zone => [zone.id, await listWarehouseZoneRows(zone.id)] as const),
      );
      setZones(nextZones);
      setRowsByZone(Object.fromEntries(rowEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load warehouse zones.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!showAddZone) return;
    setNewZoneLetter(prev => prev || availableLetters[0] || '');
  }, [showAddZone, availableLetters]);

  const handleAddZone = async () => {
    setBusyKey('add-zone');
    setError('');
    try {
      await createWarehouseZone(newZoneLetter, newZoneLabel);
      setShowAddZone(false);
      setNewZoneLabel('');
      setNewZoneLetter('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add zone.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddRow = async (zoneId: string) => {
    setBusyKey(`add-row-${zoneId}`);
    setError('');
    try {
      const rows = rowsByZone[zoneId] ?? [];
      const rowNumber = nextWarehouseRowNumber(rows);
      await createWarehouseZoneRow(zoneId, rowNumber);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add row.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    setBusyKey(`delete-zone-${zoneId}`);
    setError('');
    try {
      await deleteWarehouseZone(zoneId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete zone.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteRow = async (zoneId: string, rowNumber: number) => {
    setBusyKey(`delete-row-${zoneId}-${rowNumber}`);
    setError('');
    try {
      await deleteWarehouseZoneRow(zoneId, rowNumber);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete row.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Warehouse zones</h3>
          <p className="text-muted text-sm">
            Define floor zones (A, B, C…) and numbered rows for bulk warehouse storage.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!availableLetters.length || busyKey != null}
          onClick={() => setShowAddZone(open => !open)}
        >
          <Plus size={15} aria-hidden />
          Add zone
        </button>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      {showAddZone && (
        <div className="settings-locations__add-form">
          <label className="settings-locations__field">
            <span>Zone letter</span>
            <select
              value={newZoneLetter}
              onChange={e => setNewZoneLetter(e.target.value)}
              disabled={busyKey === 'add-zone'}
            >
              {availableLetters.map(letter => (
                <option key={letter} value={letter}>{letter.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className="settings-locations__field settings-locations__field--grow">
            <span>Label (optional)</span>
            <input
              type="text"
              value={newZoneLabel}
              placeholder="e.g. Cochin main floor"
              onChange={e => setNewZoneLabel(e.target.value)}
              disabled={busyKey === 'add-zone'}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!newZoneLetter || busyKey === 'add-zone'}
            onClick={() => void handleAddZone()}
          >
            Create zone
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddZone(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="settings-locations__loading">
          <div className="loader-ring" />
        </div>
      ) : zones.length === 0 ? (
        <div className="settings-locations__empty">
          <Layers size={28} aria-hidden />
          <p>No warehouse zones yet. Add zone A to get started.</p>
        </div>
      ) : (
        <div className="settings-locations__grid">
          {zones.map(zone => {
            const rows = rowsByZone[zone.id] ?? [];
            return (
              <article key={zone.id} className="location-card location-card--zone">
                <header className="location-card__head">
                  <div className="location-card__title-wrap">
                    <span className="location-card__badge">{zone.id.toUpperCase()}</span>
                    <div>
                      <strong className="location-card__title">
                        Zone {zone.id.toUpperCase()}
                      </strong>
                      {zone.label && (
                        <span className="location-card__subtitle text-muted">{zone.label}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-icon location-card__delete"
                    aria-label={`Delete zone ${zone.id.toUpperCase()}`}
                    disabled={busyKey != null}
                    onClick={() => void handleDeleteZone(zone.id)}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </header>

                <div className="location-card__body">
                  <span className="location-card__section-label">Rows</span>
                  <div className="location-card__chips">
                    {rows.map(row => (
                      <span key={row.id} className="location-chip">
                        Row {row.number}
                        <button
                          type="button"
                          className="location-chip__remove"
                          aria-label={`Remove row ${row.number}`}
                          disabled={busyKey != null}
                          onClick={() => void handleDeleteRow(zone.id, row.number)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="location-chip location-chip--add"
                      disabled={busyKey != null}
                      onClick={() => void handleAddRow(zone.id)}
                    >
                      <Plus size={14} aria-hidden />
                      Row
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
