import { useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Pencil, Search, X } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { shareCatalogMediaFile } from '../../lib/catalogMedia/share';
import { prefersNativePdfViewer } from '../../lib/pdfViewer';
import {
  fetchAdminInvoicesPage,
  searchAdminInvoicesAutocomplete,
  type AdminFirestoreInvoice,
} from '../../lib/admin-invoices';
import {
  isYesGatcCertificateSigned,
  saveYesGatcCertificateInvoice,
  type YesGatcCertificate,
  yesGatcCertifiedAt,
} from '../../lib/yesgatcRecords';

const InvoicePdfCanvas = lazy(() =>
  import('../invoices/InvoicePdfCanvas').then(m => ({ default: m.InvoicePdfCanvas })),
);

const INVOICE_MIN_DATE = '2026-04-05';

function invoiceOnOrAfterMin(row: AdminFirestoreInvoice): boolean {
  const date = String(row.date ?? '').trim();
  if (!date) return false;
  return date >= INVOICE_MIN_DATE;
}

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
  const useNativeViewer = useMemo(() => prefersNativePdfViewer(), []);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(() => Boolean(row.pdfUrl) && !useNativeViewer);
  const [useIframeFallback, setUseIframeFallback] = useState(() => !row.pdfUrl || useNativeViewer);

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

  useEffect(() => {
    if (!row.pdfUrl || useNativeViewer) return;
    let cancelled = false;
    setLoadingPdf(true);
    setUseIframeFallback(false);
    void fetch(row.pdfUrl)
      .then(response => {
        if (!response.ok) throw new Error('Could not load PDF.');
        return response.arrayBuffer();
      })
      .then(buffer => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer.byteLength);
        bytes.set(new Uint8Array(buffer));
        setPdfBytes(bytes);
        setPdfBlob(new Blob([bytes], { type: 'application/pdf' }));
      })
      .catch(() => {
        if (!cancelled) setUseIframeFallback(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPdf(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.pdfUrl, useNativeViewer]);

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
          blob: pdfBlob,
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
          useIframeFallback ? (
            <iframe
              className="yesgatc-share-dialog__frame"
              title={row.certificateNumber || 'Certificate PDF'}
              src={row.pdfUrl}
            />
          ) : loadingPdf && !pdfBytes ? (
            <div className="yesgatc-share-dialog__loader">
              <FetchingLoader label="Loading certificate…" />
            </div>
          ) : pdfBytes ? (
            <div className="yesgatc-share-dialog__canvas">
              <Suspense fallback={<FetchingLoader label="Preparing viewer…" />}>
                <InvoicePdfCanvas data={pdfBytes} maxScale={1.2} />
              </Suspense>
            </div>
          ) : (
            <p className="yesgatc-share-dialog__empty">No PDF is attached to this certificate.</p>
          )
        ) : (
          <p className="yesgatc-share-dialog__empty">No PDF is attached to this certificate.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function YesGatcInvoicePicker({
  row,
  onClose,
  onLinked,
}: {
  row: YesGatcCertificate;
  onClose: () => void;
  onLinked: (next: YesGatcCertificate) => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [invoices, setInvoices] = useState<AdminFirestoreInvoice[]>([]);

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
      const needle = query.trim();
      const load = needle
        ? searchAdminInvoicesAutocomplete(needle, { limitCount: 20 })
        : fetchAdminInvoicesPage('date', 20, null, 'all', INVOICE_MIN_DATE);
      void load
        .then(rows => {
          if (!cancelled) setInvoices(rows.filter(invoiceOnOrAfterMin));
        })
        .catch(err => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load invoices.');
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

  const pick = async (invoice: AdminFirestoreInvoice) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const linked = await saveYesGatcCertificateInvoice({
        certificateId: row.id,
        serialNumber: row.serialNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.date,
        invoiceCustomerId: invoice.customerId,
      });
      onLinked({
        ...row,
        invoiceId: linked.invoiceId,
        invoiceNumber: linked.invoiceNumber,
        invoiceDate: linked.invoiceDate,
        invoiceCustomerId: linked.invoiceCustomerId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link this invoice.');
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
        aria-labelledby="yesgatc-invoice-picker-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="yesgatc-rc-picker__head">
          <div>
            <h3 id="yesgatc-invoice-picker-title">Select invoice</h3>
            <p className="text-muted text-sm">
              {row.serialNumber || row.certificateNumber}
              {' · after 5 Apr 2026'}
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
            placeholder="Type invoice number"
            autoFocus
          />
        </label>
        {error ? <p className="settings-locations__error">{error}</p> : null}
        <div className="yesgatc-rc-picker__list">
          {loading ? (
            <p className="settings-locations__loading">
              <Loader2 size={16} className="spin-icon" aria-hidden /> Loading invoices…
            </p>
          ) : invoices.length === 0 ? (
            <p className="settings-locations__empty">No invoices match.</p>
          ) : (
            invoices.map(invoice => (
              <button
                key={`${invoice.customerId}:${invoice.id}`}
                type="button"
                className="yesgatc-rc-picker__item"
                disabled={saving}
                onClick={() => void pick(invoice)}
              >
                <strong>{invoice.invoiceNumber}</strong>
                <span>
                  {[invoice.date, invoice.customerName].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function YesGatcCertificateList({
  rows,
  loading,
  empty,
  onLinked,
}: {
  rows: YesGatcCertificate[];
  loading: boolean;
  empty: string;
  onLinked?: (next: YesGatcCertificate) => void;
}) {
  const [shareRow, setShareRow] = useState<YesGatcCertificate | null>(null);
  const [picking, setPicking] = useState<YesGatcCertificate | null>(null);

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
          <div className="yesgatc-cert-row__head">
            <p className="yesgatc-cert-row__number">{row.certificateNumber || '—'}</p>
            {row.invoiceNumber ? (
              <p className="yesgatc-cert-row__invoice">{row.invoiceNumber}</p>
            ) : (
              <button
                type="button"
                className="yesgatc-cert-row__pencil"
                aria-label={`Link invoice for ${row.serialNumber || row.certificateNumber || 'certificate'}`}
                title="Link invoice"
                onClick={() => setPicking(row)}
              >
                <Pencil size={16} strokeWidth={2.25} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="yesgatc-cert-row__download"
            aria-label={`Download ${row.certificateNumber || 'certificate'}`}
            title="Download"
            onClick={() => setShareRow(row)}
          >
            <Download size={18} strokeWidth={2.25} />
          </button>
          <div className="yesgatc-cert-row__meta">
            <span>
              <em>Serial</em>
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
              {yesGatcCertifiedAt(row, true)}
            </span>
          </div>
        </article>
      ))}
      {shareRow ? (
        <YesGatcCertificateShareDialog row={shareRow} onClose={() => setShareRow(null)} />
      ) : null}
      {picking ? (
        <YesGatcInvoicePicker
          row={picking}
          onClose={() => setPicking(null)}
          onLinked={next => {
            onLinked?.(next);
          }}
        />
      ) : null}
    </div>
  );
}
