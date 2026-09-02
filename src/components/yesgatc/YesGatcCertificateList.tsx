import { useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Download, Loader2, Pencil, Search, X } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { shareCatalogMediaFile } from '../../lib/catalogMedia/share';
import {
  downloadAdminInvoiceDocument,
  invoiceDocumentToBlob,
  invoiceErrorMessage,
  saveInvoiceDocumentFile,
} from '../../lib/invoices';
import { base64ToUint8Array, prefersNativePdfViewer } from '../../lib/pdfViewer';
import type { InvoiceDocumentDownload } from '../../types/invoices';
import {
  fetchAdminInvoicesPage,
  searchAdminInvoicesAutocomplete,
  type AdminFirestoreInvoice,
} from '../../lib/admin-invoices';
import {
  isYesGatcCertificateSigned,
  isYesGatcOvCertificate,
  loadYesGatcInvoicePartyNames,
  saveYesGatcCertificateInvoice,
  voidYesGatcCertificate,
  yesGatcCertificateRcDisplayName,
  yesGatcCertifiedAt,
  type YesGatcCertificate,
  type YesGatcRcDetail,
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

function YesGatcInvoiceViewDialog({
  row,
  onClose,
}: {
  row: YesGatcCertificate;
  onClose: () => void;
}) {
  const useNativeViewer = useMemo(() => prefersNativePdfViewer(), []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [file, setFile] = useState<InvoiceDocumentDownload | null>(null);

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
    const customerId = row.invoiceCustomerId?.trim();
    const invoiceId = row.invoiceId?.trim();
    if (!customerId || !invoiceId) {
      setError('This certificate has no invoice linked.');
      setLoadingPdf(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadingPdf(true);
    setError('');
    void downloadAdminInvoiceDocument(customerId, invoiceId, 'invoice')
      .then(doc => {
        if (cancelled) return;
        setFile(doc);
        const bytes = base64ToUint8Array(doc.contentBase64);
        if (useNativeViewer) {
          objectUrl = URL.createObjectURL(invoiceDocumentToBlob(doc));
          setPdfUrl(objectUrl);
        } else {
          setPdfBytes(bytes);
        }
      })
      .catch(err => {
        if (!cancelled) setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingPdf(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [row.invoiceCustomerId, row.invoiceId, useNativeViewer]);

  const download = () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      saveInvoiceDocumentFile(file);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop yesgatc-share-dialog__backdrop"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="yesgatc-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="yesgatc-invoice-view-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="yesgatc-share-dialog__actions">
          <button
            type="button"
            className="yesgatc-share-dialog__btn"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
          <button
            type="button"
            className="yesgatc-share-dialog__btn"
            onClick={download}
            disabled={saving || !file}
          >
            {saving ? <Loader2 size={16} className="spin-icon" aria-hidden /> : null}
            Download
          </button>
        </div>
        <h2 id="yesgatc-invoice-view-title" className="yesgatc-share-dialog__title">
          {row.invoiceNumber || 'Invoice'}
        </h2>
        {error ? <p className="yesgatc-share-dialog__error">{error}</p> : null}
        {loadingPdf ? (
          <div className="yesgatc-share-dialog__loader">
            <FetchingLoader label="Loading invoice…" />
          </div>
        ) : pdfUrl ? (
          <iframe
            className="yesgatc-share-dialog__frame"
            title={row.invoiceNumber || 'Invoice PDF'}
            src={pdfUrl}
          />
        ) : pdfBytes ? (
          <div className="yesgatc-share-dialog__canvas">
            <Suspense fallback={<FetchingLoader label="Preparing viewer…" />}>
              <InvoicePdfCanvas data={pdfBytes} maxScale={1.2} />
            </Suspense>
          </div>
        ) : error ? null : (
          <p className="yesgatc-share-dialog__empty">No PDF is attached to this invoice.</p>
        )}
      </div>
    </div>,
    document.body,
  );
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
  const [selected, setSelected] = useState<AdminFirestoreInvoice | null>(null);

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

  const selectedKey = selected
    ? `${selected.customerId}:${selected.id}`
    : '';

  const saveSelected = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const linked = await saveYesGatcCertificateInvoice({
        certificateId: row.id,
        serialNumber: row.serialNumber,
        invoiceId: selected.id,
        invoiceNumber: selected.invoiceNumber,
        invoiceDate: selected.date,
        invoiceCustomerId: selected.customerId,
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
            invoices.map(invoice => {
              const key = `${invoice.customerId}:${invoice.id}`;
              const isSelected = key === selectedKey;
              return (
              <button
                key={key}
                type="button"
                className={[
                  'yesgatc-rc-picker__item',
                  isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
                disabled={saving}
                aria-pressed={isSelected}
                onClick={() => setSelected(invoice)}
              >
                <strong>{invoice.invoiceNumber}</strong>
                <span>
                  {[invoice.date, invoice.customerName].filter(Boolean).join(' · ')}
                </span>
              </button>
              );
            })
          )}
        </div>
        <div className="yesgatc-rc-picker__actions">
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
            disabled={!selected || saving}
            onClick={() => void saveSelected()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function YesGatcVoidConfirmDialog({
  row,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  row: YesGatcCertificate;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [busy, onClose]);

  return createPortal(
    <div
      className="dealers-modal-backdrop yesgatc-void-dialog__backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="yesgatc-void-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="yesgatc-void-title"
        aria-describedby="yesgatc-void-message"
        onClick={event => event.stopPropagation()}
      >
        <header className="yesgatc-void-dialog__head">
          <span className="yesgatc-void-dialog__icon" aria-hidden>
            <Ban size={22} strokeWidth={2.25} />
          </span>
          <div>
            <h3 id="yesgatc-void-title">Void certificate and serial</h3>
            <p id="yesgatc-void-message">
              This cannot be allotted again after voiding.
            </p>
          </div>
        </header>
        <dl className="yesgatc-void-dialog__facts">
          <div>
            <dt>Certificate</dt>
            <dd>{row.certificateNumber || '—'}</dd>
          </div>
          <div>
            <dt>Serial</dt>
            <dd>{row.serialNumber || '—'}</dd>
          </div>
        </dl>
        {error ? <p className="yesgatc-void-dialog__error">{error}</p> : null}
        <div className="yesgatc-void-dialog__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Voiding…' : 'Confirm void'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function YesGatcCertificateList({
  rows,
  rcs = [],
  loading,
  empty,
  onLinked,
  onVoided,
}: {
  rows: YesGatcCertificate[];
  rcs?: readonly YesGatcRcDetail[];
  loading: boolean;
  empty: string;
  onLinked?: (next: YesGatcCertificate) => void;
  onVoided?: (id: string) => void;
}) {
  const { user } = useAuth();
  const [shareRow, setShareRow] = useState<YesGatcCertificate | null>(null);
  const [invoiceRow, setInvoiceRow] = useState<YesGatcCertificate | null>(null);
  const [picking, setPicking] = useState<YesGatcCertificate | null>(null);
  const [voidRow, setVoidRow] = useState<YesGatcCertificate | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [partyNames, setPartyNames] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const linked = rows.filter(row => row.invoiceCustomerId && row.invoiceId);
    if (!linked.length) {
      setPartyNames(new Map());
      return;
    }
    let cancelled = false;
    void loadYesGatcInvoicePartyNames(linked)
      .then(names => {
        if (!cancelled) setPartyNames(names);
      })
      .catch(() => {
        if (!cancelled) setPartyNames(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const openVoid = (row: YesGatcCertificate) => {
    if (voiding || row.invoiceNumber || row.invoiceId || row.voided) return;
    setVoidError('');
    setVoidRow(row);
  };

  const closeVoid = () => {
    if (voiding) return;
    setVoidRow(null);
    setVoidError('');
  };

  const confirmVoid = async () => {
    if (!voidRow || voiding) return;
    setVoiding(true);
    setVoidError('');
    try {
      await voidYesGatcCertificate({
        certificateId: voidRow.id,
        actorName: user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH',
      });
      const id = voidRow.id;
      setVoidRow(null);
      onVoided?.(id);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Could not void this certificate.');
    } finally {
      setVoiding(false);
    }
  };

  if (loading) {
    return <p className="settings-locations__loading">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="settings-locations__empty">{empty}</p>;
  }

  return (
    <div className="yesgatc-cert-list">
      {rows.map(row => {
        if (row.voided) return null;
        const rcName = yesGatcCertificateRcDisplayName(row, rcs);
        const partyName = partyNames.get(row.id) || '';
        const canLinkInvoice = isYesGatcOvCertificate(row);
        const unlinked = !row.invoiceNumber && !row.invoiceId;
        return (
        <article key={row.id} className="yesgatc-cert-row">
          <p className="yesgatc-cert-row__number">{row.certificateNumber || '—'}</p>
          <div className="yesgatc-cert-row__aside">
            {row.invoiceNumber ? (
              <p className="yesgatc-cert-row__invoice">{row.invoiceNumber}</p>
            ) : canLinkInvoice ? (
              <button
                type="button"
                className="yesgatc-cert-row__pencil"
                aria-label={`Link invoice for ${row.serialNumber || row.certificateNumber || 'certificate'}`}
                title="Link invoice"
                onClick={() => setPicking(row)}
              >
                <Pencil size={16} strokeWidth={2.25} />
              </button>
            ) : null}
            <div className="yesgatc-cert-row__actions">
              {unlinked ? (
                <button
                  type="button"
                  className="yesgatc-cert-row__file yesgatc-cert-row__file--void"
                  aria-label={`Void ${row.certificateNumber || 'certificate'} and serial ${row.serialNumber || ''}`}
                  title="Void certificate and serial"
                  disabled={voiding && voidRow?.id === row.id}
                  onClick={() => openVoid(row)}
                >
                  <span className="yesgatc-cert-row__file-icon">
                    <Ban size={18} strokeWidth={2.25} />
                  </span>
                  <span className="yesgatc-cert-row__file-tag">VOID</span>
                </button>
              ) : null}
              {row.invoiceNumber && row.invoiceId && row.invoiceCustomerId ? (
                <button
                  type="button"
                  className="yesgatc-cert-row__file yesgatc-cert-row__file--inv"
                  aria-label={`View invoice ${row.invoiceNumber}`}
                  title="View invoice"
                  onClick={() => setInvoiceRow(row)}
                >
                  <span className="yesgatc-cert-row__file-icon">
                    <Download size={18} strokeWidth={2.25} />
                  </span>
                  <span className="yesgatc-cert-row__file-tag">INV</span>
                </button>
              ) : null}
              <button
                type="button"
                className="yesgatc-cert-row__file yesgatc-cert-row__file--vc"
                aria-label={`Download ${row.certificateNumber || 'certificate'}`}
                title="Download certificate"
                onClick={() => setShareRow(row)}
              >
                <span className="yesgatc-cert-row__file-icon">
                  <Download size={18} strokeWidth={2.25} />
                </span>
                <span className="yesgatc-cert-row__file-tag">VC</span>
              </button>
            </div>
          </div>
          <div className="yesgatc-cert-row__meta">
            <span>
              <em>Serial</em>
              <strong className="yesgatc-cert-row__serial">{row.serialNumber || '—'}</strong>
            </span>
            <span>
              <em>Max</em>
              {row.max || '—'}
            </span>
            <span>
              <em>e</em>
              {row.e || '—'}
            </span>
            <span className="yesgatc-cert-row__when">
              <em className={isYesGatcCertificateSigned(row) ? 'yesgatc-cert-row__certified--signed' : undefined}>
                Certified
              </em>
              {yesGatcCertifiedAt(row, true)}
            </span>
          </div>
          <div className="yesgatc-cert-row__parties">
            <span className="yesgatc-cert-row__rc">
              <em>RC</em>
              <strong>{rcName || '—'}</strong>
            </span>
            <span>
              <em>INV:</em>
              <strong>{row.invoiceNumber ? (partyName || '—') : '—'}</strong>
            </span>
          </div>
        </article>
        );
      })}
      {shareRow ? (
        <YesGatcCertificateShareDialog row={shareRow} onClose={() => setShareRow(null)} />
      ) : null}
      {invoiceRow ? (
        <YesGatcInvoiceViewDialog row={invoiceRow} onClose={() => setInvoiceRow(null)} />
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
      {voidRow ? (
        <YesGatcVoidConfirmDialog
          row={voidRow}
          busy={voiding}
          error={voidError}
          onClose={closeVoid}
          onConfirm={() => void confirmVoid()}
        />
      ) : null}
    </div>
  );
}
