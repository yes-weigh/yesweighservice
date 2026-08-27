import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';
import { fetchDealers } from '../../../lib/dealers';
import {
  clearYesGatcRcDealerLink,
  listYesGatcRcDetails,
  saveYesGatcRcDealerLink,
  yesGatcRcLabel,
  type YesGatcRcDetail,
} from '../../../lib/yesgatcRecords';
import type { ZohoDealer } from '../../../types/dealers';

function dealerLabel(dealer: ZohoDealer): string {
  return dealer.companyName?.trim() || dealer.contactName?.trim() || dealer.id;
}

function RcDealerPicker({
  row,
  onClose,
  onLinked,
}: {
  row: YesGatcRcDetail;
  onClose: () => void;
  onLinked: (next: YesGatcRcDetail) => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dealers, setDealers] = useState<ZohoDealer[]>([]);

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
    const timer = window.setTimeout(() => {
      void fetchDealers({
        page: 1,
        limit: 20,
        q: query.trim() || undefined,
        sortField: 'companyName',
        sortDir: 'asc',
      })
        .then(res => {
          if (!cancelled) setDealers(res.data);
        })
        .catch(err => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load dealers.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const pick = async (dealer: ZohoDealer) => {
    if (saving) return;
    setSaving(true);
    setError('');
    const name = dealerLabel(dealer);
    try {
      await saveYesGatcRcDealerLink(row.id, row.code, dealer.id, name);
      onLinked({ ...row, dealerId: dealer.id, dealerName: name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link this dealer.');
      setSaving(false);
    }
  };

  const unlink = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await clearYesGatcRcDealerLink(row.id);
      onLinked({ ...row, dealerId: null, dealerName: null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear this dealer.');
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop yesgatc-rc-picker__backdrop"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="yesgatc-rc-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="yesgatc-rc-picker-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="yesgatc-rc-picker__head">
          <div>
            <h3 id="yesgatc-rc-picker-title">Select dealer</h3>
            <p className="text-muted text-sm">
              {yesGatcRcLabel(row)}
              {row.code ? ` · ${row.code}` : ''}
            </p>
          </div>
          <button type="button" className="yesgatc-rc-picker__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <label className="yesgatc-rc-picker__search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search dealers"
            autoFocus
          />
        </label>
        {error ? <p className="settings-locations__error">{error}</p> : null}
        <div className="yesgatc-rc-picker__list">
          {loading ? (
            <p className="settings-locations__loading">
              <Loader2 size={16} className="spin-icon" aria-hidden /> Loading dealers…
            </p>
          ) : dealers.length === 0 ? (
            <p className="settings-locations__empty">No dealers match.</p>
          ) : (
            dealers.map(dealer => (
              <button
                key={dealer.id}
                type="button"
                className="yesgatc-rc-picker__item"
                disabled={saving}
                onClick={() => void pick(dealer)}
              >
                <strong>{dealerLabel(dealer)}</strong>
                <span>{[dealer.billingState, dealer.district, dealer.phone || dealer.mobile].filter(Boolean).join(' · ')}</span>
              </button>
            ))
          )}
        </div>
        {row.dealerId ? (
          <button type="button" className="btn btn-secondary yesgatc-rc-picker__clear" disabled={saving} onClick={() => void unlink()}>
            Clear dealer
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export const RcDetailsTab: React.FC = () => {
  const [rows, setRows] = useState<YesGatcRcDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<YesGatcRcDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listYesGatcRcDetails());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load RC details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>RC details</h3>
        </div>
      </header>
      {error ? <p className="settings-locations__error">{error}</p> : null}
      {loading ? (
        <p className="settings-locations__loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="settings-locations__empty">No RC details yet.</p>
      ) : (
        <div className="yesgatc-rc-list">
          {rows.map(row => (
            <article key={row.id} className="yesgatc-rc-row">
              <div className="yesgatc-rc-row__text">
                <p className="yesgatc-rc-row__name">{yesGatcRcLabel(row)}</p>
                <p className="yesgatc-rc-row__code">{row.code || '—'}</p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm yesgatc-rc-row__select"
                onClick={() => setPicking(row)}
              >
                Select
              </button>
            </article>
          ))}
        </div>
      )}
      {picking ? (
        <RcDealerPicker
          row={picking}
          onClose={() => setPicking(null)}
          onLinked={next => {
            setRows(current => current.map(row => (row.id === next.id ? next : row)));
          }}
        />
      ) : null}
    </section>
  );
};
