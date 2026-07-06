import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Plus, Trash2 } from 'lucide-react';
import {
  BIN_NUMBERS,
  ROW_NUMBERS,
  type BinNumber,
  type RowNumber,
  type YesStoreBinDoc,
  type YesStoreRackDoc,
  type YesStoreRowDoc,
  VALID_RACK_LETTERS,
} from '../../../types/yes-store';
import {
  deleteBinIfEmpty,
  deleteRackIfEmpty,
  deleteRowIfEmpty,
  ensureBin,
  ensureRack,
  ensureRow,
  listBinsByRow,
  listRacks,
  listRowsByRack,
} from '../../../lib/yesStore/data';

function nextRowNumber(rows: YesStoreRowDoc[]): RowNumber | null {
  const used = new Set(rows.map(row => row.number));
  for (const n of ROW_NUMBERS) {
    if (!used.has(n)) return n;
  }
  return null;
}

function nextBinNumber(bins: YesStoreBinDoc[]): BinNumber | null {
  const used = new Set(bins.map(bin => bin.number));
  for (const n of BIN_NUMBERS) {
    if (!used.has(n)) return n;
  }
  return null;
}

function unusedRackLetters(racks: YesStoreRackDoc[]): string[] {
  const used = new Set(racks.map(rack => rack.id.toLowerCase()));
  return VALID_RACK_LETTERS.filter(letter => !used.has(letter));
}

export const StoreRoomTab: React.FC = () => {
  const [racks, setRacks] = useState<YesStoreRackDoc[]>([]);
  const [rowsByRack, setRowsByRack] = useState<Record<string, YesStoreRowDoc[]>>({});
  const [binsByRow, setBinsByRow] = useState<Record<string, YesStoreBinDoc[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showAddRack, setShowAddRack] = useState(false);
  const [newRackLetter, setNewRackLetter] = useState('');

  const availableRackLetters = useMemo(() => unusedRackLetters(racks), [racks]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextRacks = await listRacks();
      const rowEntries = await Promise.all(
        nextRacks.map(async rack => [rack.id, await listRowsByRack(rack.id)] as const),
      );
      const nextRowsByRack = Object.fromEntries(rowEntries);
      const binEntries: Array<[string, YesStoreBinDoc[]]> = [];
      for (const [rackId, rows] of rowEntries) {
        for (const row of rows) {
          const bins = await listBinsByRow(rackId, row.number);
          binEntries.push([`${rackId}_${row.number}`, bins]);
        }
      }
      setRacks(nextRacks);
      setRowsByRack(nextRowsByRack);
      setBinsByRow(Object.fromEntries(binEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load store room layout.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!showAddRack) return;
    setNewRackLetter(prev => prev || availableRackLetters[0] || '');
  }, [showAddRack, availableRackLetters]);

  const handleAddRack = async () => {
    setBusyKey('add-rack');
    setError('');
    try {
      await ensureRack(newRackLetter.toLowerCase());
      setShowAddRack(false);
      setNewRackLetter('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add rack.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddRow = async (rackId: string) => {
    setBusyKey(`add-row-${rackId}`);
    setError('');
    try {
      const rows = rowsByRack[rackId] ?? [];
      const rowNumber = nextRowNumber(rows);
      if (!rowNumber) throw new Error('All row slots (1–7) are used for this rack.');
      await ensureRow(rackId, rowNumber);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add row.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddBin = async (rackId: string, rowNumber: RowNumber) => {
    setBusyKey(`add-bin-${rackId}-${rowNumber}`);
    setError('');
    try {
      const key = `${rackId}_${rowNumber}`;
      const bins = binsByRow[key] ?? [];
      const binNumber = nextBinNumber(bins);
      if (!binNumber) throw new Error('All bin slots (1–9) are used for this row.');
      await ensureBin(rackId, rowNumber, binNumber);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add bin.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteRack = async (rackId: string) => {
    setBusyKey(`delete-rack-${rackId}`);
    setError('');
    try {
      await deleteRackIfEmpty(rackId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete rack.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteRow = async (rackId: string, rowNumber: RowNumber) => {
    setBusyKey(`delete-row-${rackId}-${rowNumber}`);
    setError('');
    try {
      await deleteRowIfEmpty(rackId, rowNumber);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete row.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteBin = async (
    rackId: string,
    rowNumber: RowNumber,
    binNumber: BinNumber,
  ) => {
    setBusyKey(`delete-bin-${rackId}-${rowNumber}-${binNumber}`);
    setError('');
    try {
      await deleteBinIfEmpty(rackId, rowNumber, binNumber);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete bin.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Store room layout</h3>
          <p className="text-muted text-sm">
            Manage rack → row → bin locations used by Yes Store inventory audits.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!availableRackLetters.length || busyKey != null}
          onClick={() => setShowAddRack(open => !open)}
        >
          <Plus size={15} aria-hidden />
          Add rack
        </button>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      {showAddRack && (
        <div className="settings-locations__add-form">
          <label className="settings-locations__field">
            <span>Rack letter</span>
            <select
              value={newRackLetter}
              onChange={e => setNewRackLetter(e.target.value)}
              disabled={busyKey === 'add-rack'}
            >
              {availableRackLetters.map(letter => (
                <option key={letter} value={letter}>{letter.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!newRackLetter || busyKey === 'add-rack'}
            onClick={() => void handleAddRack()}
          >
            Create rack
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddRack(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="settings-locations__loading">
          <div className="loader-ring" />
        </div>
      ) : racks.length === 0 ? (
        <div className="settings-locations__empty">
          <Box size={28} aria-hidden />
          <p>No racks configured yet. Add rack A to start the store room map.</p>
        </div>
      ) : (
        <div className="settings-locations__grid settings-locations__grid--store">
          {racks.map(rack => {
            const rows = rowsByRack[rack.id] ?? [];
            return (
              <article key={rack.id} className="location-card location-card--rack">
                <header className="location-card__head">
                  <div className="location-card__title-wrap">
                    <span className="location-card__badge location-card__badge--rack">
                      {rack.id.toUpperCase()}
                    </span>
                    <div>
                      <strong className="location-card__title">Rack {rack.id.toUpperCase()}</strong>
                      <span className="location-card__subtitle text-muted">
                        {rows.length} row{rows.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <div className="location-card__actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null || !nextRowNumber(rows)}
                      onClick={() => void handleAddRow(rack.id)}
                    >
                      <Plus size={14} aria-hidden />
                      Row
                    </button>
                    <button
                      type="button"
                      className="btn-icon location-card__delete"
                      aria-label={`Delete rack ${rack.id.toUpperCase()}`}
                      disabled={busyKey != null}
                      onClick={() => void handleDeleteRack(rack.id)}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                </header>

                {rows.length === 0 ? (
                  <p className="location-card__empty text-muted text-sm">No rows yet.</p>
                ) : (
                  <div className="location-card__rows-list">
                    {rows.map(row => {
                      const binKey = `${rack.id}_${row.number}`;
                      const bins = binsByRow[binKey] ?? [];
                      return (
                        <div key={row.id} className="location-row-block">
                          <div className="location-row-block__head">
                            <strong>Row {row.number}</strong>
                            <div className="location-row-block__actions">
                              <button
                                type="button"
                                className="location-chip location-chip--add location-chip--compact"
                                disabled={busyKey != null || !nextBinNumber(bins)}
                                onClick={() => void handleAddBin(rack.id, row.number)}
                              >
                                <Plus size={13} aria-hidden />
                                Bin
                              </button>
                              <button
                                type="button"
                                className="btn-icon location-card__delete"
                                aria-label={`Delete row ${row.number}`}
                                disabled={busyKey != null}
                                onClick={() => void handleDeleteRow(rack.id, row.number)}
                              >
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          </div>
                          <div className="location-card__chips">
                            {bins.map(bin => (
                              <span key={bin.id} className="location-chip location-chip--bin">
                                Bin {bin.number}
                                <button
                                  type="button"
                                  className="location-chip__remove"
                                  aria-label={`Remove bin ${bin.number}`}
                                  disabled={busyKey != null}
                                  onClick={() => void handleDeleteBin(rack.id, row.number, bin.number)}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            {bins.length === 0 && (
                              <span className="text-muted text-sm">No bins</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
