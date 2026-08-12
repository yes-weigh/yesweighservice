import React, { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { saveLogisticsSpareBoxDefinitions } from '../../../lib/logisticsSettings';
import {
  createEmptySpareBoxDefinitionDraft,
  normalizeSpareBoxDefinitions,
  type SpareBoxDefinition,
} from '../../../types/spare-box-definitions';

type SpareBoxDefinitionsSettingsProps = {
  definitions: SpareBoxDefinition[];
  updatedBy?: string | null;
  onSaved: (next: SpareBoxDefinition[]) => void;
  onError: (message: string) => void;
};

type DraftRow = {
  id: string;
  name: string;
  lengthCm: string;
  breadthCm: string;
  heightCm: string;
};

function toDraftRows(defs: SpareBoxDefinition[]): DraftRow[] {
  return defs.map(def => ({
    id: def.id,
    name: def.name,
    lengthCm: String(def.lengthCm),
    breadthCm: String(def.breadthCm),
    heightCm: String(def.heightCm),
  }));
}

function parseDraftRows(rows: DraftRow[]): { ok: SpareBoxDefinition[]; error: string | null } {
  if (rows.length === 0) return { ok: [], error: null };
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) {
      return { ok: [], error: 'Each box needs a name.' };
    }
    const lengthCm = Number(row.lengthCm);
    const breadthCm = Number(row.breadthCm);
    const heightCm = Number(row.heightCm);
    if (!(lengthCm > 0) || !(breadthCm > 0) || !(heightCm > 0)) {
      return { ok: [], error: `“${name || 'Box'}” needs L, B, and H greater than 0.` };
    }
  }
  return {
    ok: normalizeSpareBoxDefinitions(
      rows.map(row => ({
        id: row.id,
        name: row.name,
        lengthCm: Number(row.lengthCm),
        breadthCm: Number(row.breadthCm),
        heightCm: Number(row.heightCm),
      })),
    ),
    error: null,
  };
}

export const SpareBoxDefinitionsSettings: React.FC<SpareBoxDefinitionsSettingsProps> = ({
  definitions,
  updatedBy,
  onSaved,
  onError,
}) => {
  const [draft, setDraft] = useState<DraftRow[]>(() => toDraftRows(definitions));
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(toDraftRows(definitions)));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const dirty = useMemo(
    () => JSON.stringify(draft) !== savedSnapshot,
    [draft, savedSnapshot],
  );

  const updateRow = (id: string, patch: Partial<DraftRow>) => {
    setDraft(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)));
    setNote('');
  };

  const addRow = () => {
    const empty = createEmptySpareBoxDefinitionDraft();
    setDraft(prev => [
      ...prev,
      {
        id: empty.id,
        name: '',
        lengthCm: '',
        breadthCm: '',
        heightCm: '',
      },
    ]);
    setNote('');
  };

  const removeRow = (id: string) => {
    setDraft(prev => prev.filter(row => row.id !== id));
    setNote('');
  };

  const handleSave = async () => {
    const parsed = parseDraftRows(draft);
    if (parsed.error) {
      onError(parsed.error);
      return;
    }
    setBusy(true);
    onError('');
    setNote('');
    try {
      const saved = await saveLogisticsSpareBoxDefinitions(parsed.ok, updatedBy);
      const nextDraft = toDraftRows(saved);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(nextDraft));
      onSaved(saved);
      setNote(saved.length
        ? `Saved ${saved.length} spare box definition${saved.length === 1 ? '' : 's'}.`
        : 'Saved — no spare box definitions.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save spare box definitions.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-logistics__section panel">
      <div className="settings-logistics__default-head">
        <div>
          <h4 className="settings-logistics__title">Spare box dia</h4>
          <p className="text-muted text-sm">
            Named cartons with L×B×H (cm). Book Courier can apply these presets; weight stays
            custom per shipment.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dirty || busy}
          onClick={() => void handleSave()}
        >
          <Save size={15} aria-hidden />
          Save
        </button>
      </div>

      {note && (
        <p className="text-muted text-sm settings-logistics__sync-note" role="status">
          {note}
        </p>
      )}

      <div className="settings-spare-boxes">
        {draft.length === 0 ? (
          <p className="text-muted text-sm settings-spare-boxes__empty">
            No boxes yet. Add a definition to use as a Book Courier preset.
          </p>
        ) : (
          <ul className="settings-spare-boxes__list">
            {draft.map((row, index) => (
              <li key={row.id} className="settings-spare-boxes__row">
                <label className="settings-spare-boxes__field settings-spare-boxes__field--name">
                  <span>Name</span>
                  <input
                    type="text"
                    value={row.name}
                    disabled={busy}
                    placeholder={`Box ${index + 1}`}
                    onChange={e => updateRow(row.id, { name: e.target.value })}
                  />
                </label>
                <label className="settings-spare-boxes__field">
                  <span>L (cm)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    inputMode="decimal"
                    value={row.lengthCm}
                    disabled={busy}
                    placeholder="—"
                    onChange={e => updateRow(row.id, { lengthCm: e.target.value })}
                  />
                </label>
                <label className="settings-spare-boxes__field">
                  <span>B (cm)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    inputMode="decimal"
                    value={row.breadthCm}
                    disabled={busy}
                    placeholder="—"
                    onChange={e => updateRow(row.id, { breadthCm: e.target.value })}
                  />
                </label>
                <label className="settings-spare-boxes__field">
                  <span>H (cm)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    inputMode="decimal"
                    value={row.heightCm}
                    disabled={busy}
                    placeholder="—"
                    onChange={e => updateRow(row.id, { heightCm: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="settings-spare-boxes__remove"
                  disabled={busy}
                  aria-label={`Remove ${row.name.trim() || `box ${index + 1}`}`}
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="btn btn-secondary btn-sm settings-spare-boxes__add"
          disabled={busy}
          onClick={addRow}
        >
          <Plus size={15} aria-hidden />
          Add box
        </button>
      </div>
    </div>
  );
};
