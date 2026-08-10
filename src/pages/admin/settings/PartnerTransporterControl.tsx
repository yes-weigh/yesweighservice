import React, { useEffect, useState } from 'react';
import { Loader2, Pencil, RefreshCw, Save, X } from 'lucide-react';
import type { DeliveryPartnerTransporterRef } from '../../../constants/deliveryPartnerTabs';
import {
  listZohoEwayTransporters,
  type ZohoEwayTransporterOption,
} from '../../../lib/zohoEwayTransporters';

type Props = {
  value: DeliveryPartnerTransporterRef | null;
  partnerLabel: string;
  onSave: (next: DeliveryPartnerTransporterRef | null) => Promise<void>;
  disabled?: boolean;
};

/** Zoho e-way transporter picker shown next to the partner GSTIN field. */
export const PartnerTransporterControl: React.FC<Props> = ({
  value,
  partnerLabel,
  onSave,
  disabled = false,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [options, setOptions] = useState<ZohoEwayTransporterOption[]>([]);

  useEffect(() => {
    setDraftId(value?.id ?? '');
    setEditing(false);
    setOptionsError('');
  }, [value, partnerLabel]);

  const loadOptions = async () => {
    setLoadingOptions(true);
    setOptionsError('');
    try {
      const rows = await listZohoEwayTransporters();
      setOptions(rows);
    } catch (err) {
      setOptions([]);
      setOptionsError(err instanceof Error ? err.message : 'Could not load Zoho transporters.');
    } finally {
      setLoadingOptions(false);
    }
  };

  const startEdit = () => {
    setDraftId(value?.id ?? '');
    setEditing(true);
    if (options.length === 0) {
      void loadOptions();
    }
  };

  const cancelEdit = () => {
    setDraftId(value?.id ?? '');
    setEditing(false);
    setOptionsError('');
  };

  const selectedOption = options.find(row => row.id === draftId) ?? null;
  const displayName = value?.name || 'Not set';

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!draftId) {
        await onSave(null);
      } else {
        const match = options.find(row => row.id === draftId)
          ?? (value?.id === draftId ? value : null);
        if (!match?.id || !match.name) {
          throw new Error('Select a transporter from the Zoho list.');
        }
        await onSave({ id: match.id, name: match.name });
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="settings-courier-rates__card settings-courier-rates__gstin-panel">
      <legend>Zoho transporter</legend>
      <div className="settings-courier-rates__gstin-toolbar">
        <p className="text-muted text-sm">
          {editing
            ? 'Pick the transporter Zoho should use on e-way bills for this partner.'
            : 'Click Edit to link a Zoho transporter for e-way bills.'}
        </p>
        {editing ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || saving}
            onClick={cancelEdit}
          >
            <X size={14} aria-hidden />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            onClick={startEdit}
          >
            <Pencil size={14} aria-hidden />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <label className="settings-courier-rates__field settings-courier-rates__field--plain">
            <span>{partnerLabel} transporter</span>
            <div className="settings-courier-rates__transporter-select-row">
              <select
                value={draftId}
                disabled={disabled || saving || loadingOptions}
                aria-label={`${partnerLabel} Zoho transporter`}
                onChange={e => {
                  setDraftId(e.target.value);
                }}
              >
                <option value="">Not set</option>
                {options.map(row => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.gstin ? ` (${row.gstin})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled || saving || loadingOptions}
                title="Refresh transporter list from Zoho"
                onClick={() => void loadOptions()}
              >
                {loadingOptions
                  ? <Loader2 size={14} className="spin" aria-hidden />
                  : <RefreshCw size={14} aria-hidden />}
                Refresh
              </button>
            </div>
          </label>
          {optionsError ? (
            <p className="settings-courier-rates__transporter-error text-sm">{optionsError}</p>
          ) : null}
          {selectedOption?.gstin ? (
            <p className="text-muted text-sm">
              GSTIN: {selectedOption.gstin}
            </p>
          ) : null}
          <div className="settings-courier-rates__gstin-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={disabled || saving || loadingOptions}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 size={16} className="spin" aria-hidden /> : <Save size={16} aria-hidden />}
              Save
            </button>
          </div>
        </>
      ) : (
        <p className="settings-courier-rates__transporter-display">{displayName}</p>
      )}

      <p className="settings-courier-rates__gstin-hint text-muted text-sm">
        Used as the transporter on Zoho e-way bills when this partner books a shipment.
      </p>
    </fieldset>
  );
};
