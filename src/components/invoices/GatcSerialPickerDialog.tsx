import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';
import {
  certificateCapacityKg,
  listUnlinkedIwpGatcCertificates,
  type UnlinkedIwpGatcCertificate,
} from '../../lib/gatcStampedSerialAllot';

function capacityLabel(row: UnlinkedIwpGatcCertificate): string {
  const raw = String(row.max ?? '').trim();
  if (!raw) return '—';
  if (/kg|g\b|t\b/i.test(raw)) return raw;
  return `${raw} kg`;
}

export function GatcSerialPickerDialog({
  title,
  need,
  capacityKg,
  saving,
  error,
  onClose,
  onSave,
}: {
  title: string;
  need: number;
  capacityKg?: number | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (certificateIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<UnlinkedIwpGatcCertificate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, saving]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void listUnlinkedIwpGatcCertificates()
      .then(list => {
        if (!cancelled) setRows(list);
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load unlinked GATC serials.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => {
      if (capacityKg != null && certificateCapacityKg(row) !== capacityKg) return false;
      if (!needle) return true;
      const blob = `${row.serialNumber} ${row.max} ${row.certificateNumber}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [capacityKg, query, rows]);

  const toggle = (id: string) => {
    if (saving) return;
    setSelected(current => (
      current.includes(id)
        ? current.filter(item => item !== id)
        : current.length >= need
          ? current
          : [...current, id]
    ));
  };

  const canSave = selected.length === need && !saving && !loading;
  const full = selected.length >= need;

  return createPortal(
    <div
      className="dealers-modal-backdrop gatc-serial-picker__backdrop"
      role="presentation"
    >
      <div
        className="gatc-serial-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gatc-serial-picker-title"
      >
        <header className="gatc-serial-picker__head">
          <div>
            <h3 id="gatc-serial-picker-title">Add GATC serial number</h3>
            <p className="text-muted text-sm">
              {title}
              {need ? ` · select ${need}` : ''}
              {capacityKg != null ? ` · ${capacityKg} kg` : ''}
            </p>
          </div>
          <button
            type="button"
            className="gatc-serial-picker__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </header>
        <label className="gatc-serial-picker__search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search serial"
            autoFocus
          />
        </label>
        <p className="gatc-serial-picker__count">
          {selected.length} of {need} selected
          {visible.length || !loading ? ` · ${visible.length} available` : ''}
          {capacityKg != null ? ` · ${capacityKg} kg` : ''}
        </p>
        {loadError ? <p className="invoice-nongatc-serials__error">{loadError}</p> : null}
        {error ? <p className="invoice-nongatc-serials__error">{error}</p> : null}
        <div className="gatc-serial-picker__board">
          {loading ? (
            <p className="gatc-serial-picker__status">
              <Loader2 size={16} className="spin-icon" aria-hidden /> Loading unlinked GATC…
            </p>
          ) : visible.length === 0 ? (
            <p className="gatc-serial-picker__status">
              {capacityKg != null
                ? `No unlinked Interweighing certificates for ${capacityKg} kg.`
                : 'No unlinked Interweighing certificates.'}
            </p>
          ) : (
            <div className="gatc-serial-picker__grid">
              {visible.map(row => {
                const checked = selected.includes(row.id);
                const locked = !checked && full;
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={[
                      'gatc-serial-picker__seat',
                      checked ? 'gatc-serial-picker__seat--on' : '',
                      locked ? 'gatc-serial-picker__seat--locked' : '',
                    ].filter(Boolean).join(' ')}
                    disabled={saving || locked}
                    aria-pressed={checked}
                    onClick={() => toggle(row.id)}
                  >
                    <strong>{row.serialNumber || '—'}</strong>
                    <span>{capacityLabel(row)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="gatc-serial-picker__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={() => onSave(selected)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
