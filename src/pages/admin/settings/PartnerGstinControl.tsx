import React, { useEffect, useState } from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';

type Props = {
  value: string;
  partnerLabel: string;
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
};

/** GSTIN field shown on each Delivery Partners detail panel. */
export const PartnerGstinControl: React.FC<Props> = ({
  value,
  partnerLabel,
  onSave,
  disabled = false,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
    setEditing(false);
  }, [value, partnerLabel]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(value);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="settings-courier-rates__card settings-courier-rates__gstin-panel">
      <legend>GST number</legend>
      <div className="settings-courier-rates__gstin-toolbar">
        <p className="text-muted text-sm">
          {editing
            ? 'Editing — save when done or cancel to discard.'
            : 'Click Edit to change this partner\'s GSTIN.'}
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
      <label className="settings-courier-rates__field settings-courier-rates__field--plain">
        <span>{partnerLabel} GSTIN</span>
        <input
          type="text"
          value={draft}
          maxLength={15}
          autoComplete="off"
          spellCheck={false}
          placeholder="15-character GSTIN"
          aria-label={`${partnerLabel} GST number`}
          readOnly={!editing}
          disabled={!editing || disabled || saving}
          onChange={e => {
            setDraft(e.target.value.toUpperCase());
          }}
        />
      </label>
      {editing ? (
        <div className="settings-courier-rates__gstin-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || saving}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 size={16} className="spin" aria-hidden /> : <Save size={16} aria-hidden />}
            Save
          </button>
        </div>
      ) : null}
      <p className="settings-courier-rates__gstin-hint text-muted text-sm">
        Optional. Used on shipping labels, e-way bills, and other tax documents for this partner.
      </p>
    </fieldset>
  );
};
