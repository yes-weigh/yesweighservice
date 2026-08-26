import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2 } from 'lucide-react';
import { shareCatalogMediaFile } from '../../lib/catalogMedia/share';
import {
  isYesGatcCertificateSigned,
  type YesGatcCertificate,
  yesGatcCertifiedAt,
} from '../../lib/yesgatcRecords';

function pdfFileName(row: YesGatcCertificate): string {
  const raw = (row.certificateNumber || row.serialNumber || 'certificate')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80);
  return raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`;
}

function YesGatcCertificateShareDialog({
  row,
  onClose,
}: {
  row: YesGatcCertificate;
  onClose: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sharing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, sharing]);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    setShareError('');
    const title = row.certificateNumber || row.serialNumber || 'GATC certificate';
    try {
      if (row.pdfUrl) {
        await shareCatalogMediaFile({
          url: row.pdfUrl,
          fileName: pdfFileName(row),
          contentType: 'application/pdf',
          title,
        });
      } else if (typeof navigator.share === 'function') {
        await navigator.share({
          title,
          text: [row.certificateNumber, row.serialNumber].filter(Boolean).join(' · '),
        });
      } else {
        setShareError('No PDF is attached to this certificate.');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareError(err instanceof Error ? err.message : 'Could not share this certificate.');
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop yesgatc-share-dialog__backdrop"
      role="presentation"
      onClick={() => {
        if (!sharing) onClose();
      }}
    >
      <div
        className="yesgatc-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="yesgatc-share-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="yesgatc-share-dialog__actions">
          <button
            type="button"
            className="yesgatc-share-dialog__btn"
            onClick={onClose}
            disabled={sharing}
          >
            Close
          </button>
          <button
            type="button"
            className="yesgatc-share-dialog__btn"
            onClick={() => void share()}
            disabled={sharing}
          >
            {sharing ? <Loader2 size={16} className="spin-icon" aria-hidden /> : null}
            Share
          </button>
        </div>
        <h2 id="yesgatc-share-title" className="yesgatc-share-dialog__title">
          {row.certificateNumber || 'Certificate'}
        </h2>
        {shareError ? <p className="yesgatc-share-dialog__error">{shareError}</p> : null}
        {row.pdfUrl ? (
          <iframe
            className="yesgatc-share-dialog__frame"
            title={row.certificateNumber || 'Certificate PDF'}
            src={row.pdfUrl}
          />
        ) : (
          <p className="yesgatc-share-dialog__empty">No PDF is attached to this certificate.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function YesGatcCertificateList({
  rows,
  loading,
  empty,
}: {
  rows: YesGatcCertificate[];
  loading: boolean;
  empty: string;
}) {
  const [shareRow, setShareRow] = useState<YesGatcCertificate | null>(null);

  if (loading) {
    return <p className="settings-locations__loading">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="settings-locations__empty">{empty}</p>;
  }

  return (
    <div className="yesgatc-cert-list">
      {rows.map(row => (
        <article key={row.id} className="yesgatc-cert-row">
          <div className="yesgatc-cert-row__top">
            <p className="yesgatc-cert-row__number">{row.certificateNumber || '—'}</p>
            <button
              type="button"
              className="yesgatc-cert-row__download"
              aria-label={`Download ${row.certificateNumber || 'certificate'}`}
              title="Download"
              onClick={() => setShareRow(row)}
            >
              <Download size={18} strokeWidth={2.25} />
            </button>
          </div>
          <div className="yesgatc-cert-row__meta">
            <span>
              <em>Serial no</em>
              <strong className="yesgatc-cert-row__serial">{row.serialNumber || '—'}</strong>
            </span>
            <span>
              <em>Max</em>
              {row.max || '—'}
            </span>
            <span className="yesgatc-cert-row__when">
              <em className={isYesGatcCertificateSigned(row) ? 'yesgatc-cert-row__certified--signed' : undefined}>
                Certified
              </em>
              {yesGatcCertifiedAt(row)}
            </span>
          </div>
        </article>
      ))}
      {shareRow ? (
        <YesGatcCertificateShareDialog row={shareRow} onClose={() => setShareRow(null)} />
      ) : null}
    </div>
  );
}
