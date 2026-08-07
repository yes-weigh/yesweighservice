import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import {
  fetchStCourierShipmentTrack,
  openStCourierOfficialTrackPage,
  openStCourierTrackPage,
  type StCourierTrackResult,
} from '../../lib/stCourierTrack';

interface StCourierTrackDialogProps {
  awb: string;
  onClose: () => void;
}

export const StCourierTrackDialog: React.FC<StCourierTrackDialogProps> = ({
  awb,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StCourierTrackResult | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchStCourierShipmentTrack(awb);
      setResult(next);
      if (!next.ok) setError(next.error || 'Tracking details not found.');
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Could not fetch status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [awb]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="st-track-dialog" role="dialog" aria-modal="true" aria-label="ST Courier tracking">
      <button type="button" className="st-track-dialog__backdrop" aria-label="Close" onClick={onClose} />
      <div className="st-track-dialog__panel">
        <header className="st-track-dialog__head">
          <div>
            <h3>ST Courier tracking</h3>
            <p className="text-muted text-sm">AWB {awb}</p>
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
              {result.history.length > 0 && (
                <div className="st-track-dialog__history">
                  <h4>History</h4>
                  <ul>
                    {result.history.map((item, index) => (
                      <li key={`${item.at}-${index}`}>
                        <strong>{item.at}</strong>
                        <span>{item.location}</span>
                        <span>{item.activity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
