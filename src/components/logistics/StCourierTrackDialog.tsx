import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import {
  fetchStCourierShipmentTrack,
  openStCourierOfficialTrackPage,
  openStCourierTrackPage,
  stCourierTrackFromBooking,
  type StCourierTrackResult,
} from '../../lib/stCourierTrack';
import type { LogisticsCourierTrack } from '../../types/logistics-dispatch';

interface StCourierTrackDialogProps {
  awb: string;
  /** Persist refreshed track onto this logistics booking. */
  bookingId?: string | null;
  /** Last persisted snapshot (shown immediately, then refreshed live). */
  cachedTrack?: LogisticsCourierTrack | null;
  onClose: () => void;
  /** Called after a successful live fetch that was persisted. */
  onTrackUpdated?: (track: StCourierTrackResult) => void;
}

export const StCourierTrackDialog: React.FC<StCourierTrackDialogProps> = ({
  awb,
  bookingId,
  cachedTrack,
  onClose,
  onTrackUpdated,
}) => {
  const cached = stCourierTrackFromBooking(cachedTrack);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(cached && !cached.ok ? (cached.error || '') : '');
  const [result, setResult] = useState<StCourierTrackResult | null>(cached);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchStCourierShipmentTrack(awb, { bookingId });
      setResult(next);
      if (!next.ok) setError(next.error || 'Tracking details not found.');
      else onTrackUpdated?.(next);
    } catch (err) {
      if (!result) setResult(null);
      setError(err instanceof Error ? err.message : 'Could not fetch status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Fresh open / AWB change — intentionally not depending on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on awb/booking only
  }, [awb, bookingId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fetchedLabel = result?.fetchedAt
    ? (() => {
      const parsed = Date.parse(result.fetchedAt);
      if (Number.isNaN(parsed)) return result.fetchedAt;
      return new Date(parsed).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    })()
    : null;

  return createPortal(
    <div className="st-track-dialog" role="dialog" aria-modal="true" aria-label="ST Courier tracking">
      <button type="button" className="st-track-dialog__backdrop" aria-label="Close" onClick={onClose} />
      <div className="st-track-dialog__panel">
        <header className="st-track-dialog__head">
          <div>
            <h3>ST Courier tracking</h3>
            <p className="text-muted text-sm">
              AWB {awb}
              {fetchedLabel ? ` · Updated ${fetchedLabel}` : ''}
              {loading ? ' · Refreshing…' : ''}
            </p>
          </div>
          <div className="st-track-dialog__head-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh status"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'is-spin' : undefined} aria-hidden />
            </button>
            <button type="button" className="st-track-dialog__close" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden />
            </button>
          </div>
        </header>

        <div className="st-track-dialog__body">
          {loading && !result && (
            <p className="text-muted text-sm">Fetching status from ST Courier…</p>
          )}
          {error && (
            <p className="st-track-dialog__error">{error}</p>
          )}
          {result?.ok && (
            <>
              {result.status && (
                <p className="st-track-dialog__status">{result.status}</p>
              )}
              <dl className="st-track-dialog__meta">
                {result.origin && <div><dt>Origin</dt><dd>{result.origin}</dd></div>}
                {result.destination && <div><dt>Destination</dt><dd>{result.destination}</dd></div>}
                {result.consignmentType && <div><dt>Consignment</dt><dd>{result.consignmentType}</dd></div>}
                {result.bookedAt && <div><dt>Booked</dt><dd>{result.bookedAt}</dd></div>}
                {result.deliveredAt && <div><dt>Delivered</dt><dd>{result.deliveredAt}</dd></div>}
              </dl>
              {result.history.length > 0 ? (
                <div className="st-track-dialog__history">
                  <h4>Tracking history</h4>
                  <ol className="st-track-dialog__timeline">
                    {result.history.map((item, index) => (
                      <li
                        key={`${item.at}-${item.activity}-${index}`}
                        className={index === 0 ? 'is-latest' : undefined}
                      >
                        <span className="st-track-dialog__timeline-dot" aria-hidden />
                        <div className="st-track-dialog__timeline-copy">
                          <strong>{item.activity || 'Update'}</strong>
                          {item.location ? (
                            <span className="st-track-dialog__timeline-location">
                              {item.location}
                            </span>
                          ) : null}
                          {item.at ? (
                            <time className="st-track-dialog__timeline-at">{item.at}</time>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : result.ok ? (
                <p className="text-muted text-sm st-track-dialog__history-empty">
                  Tracking history not available for this AWB.
                </p>
              ) : null}
            </>
          )}
        </div>

        <footer className="st-track-dialog__foot">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => openStCourierTrackPage(awb)}
          >
            <ExternalLink size={14} aria-hidden />
            Open track page
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => openStCourierOfficialTrackPage()}
          >
            ST Courier site
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};
