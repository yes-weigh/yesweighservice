import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Link2, Share2, Upload } from 'lucide-react';
import { WhatsAppShare } from 'whatsapp-share';
import { ZoomableImagePreview } from '../logistics/ZoomableImagePreview';
import { ZoomablePdfPreview } from '../logistics/ZoomablePdfPreview';
import { FetchingLoader } from '../FetchingLoader';
import {
  extractPurchaseOrderBlDate,
  fetchPurchaseOrderBlPreview,
  linkPurchaseOrderBlFromSource,
  listPurchaseOrderBlSources,
  PURCHASE_ORDER_SHIPPING_LINES,
  purchaseOrderHasBl,
  savePurchaseOrderBl,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderBl,
  type PurchaseOrderBlSource,
  type PurchaseOrderTracking,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (next: { bl: PurchaseOrderBl; tracking: PurchaseOrderTracking }) => void;
};

type Mode = 'upload' | 'link';

const DEFAULT_SHIPPING_LINE = 'Wan Hai';
const DEFAULT_PORT_OF_DISCHARGE = 'Cochin';

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function shareBlFile(input: {
  url?: string | null;
  bytes?: Uint8Array | null;
  file?: File | null;
  fileName: string;
  title: string;
}): Promise<void> {
  let blob: Blob;
  let fileName = String(input.fileName || 'bill-of-lading').trim() || 'bill-of-lading';

  if (input.file) {
    blob = input.file;
    fileName = input.file.name || fileName;
  } else if (input.bytes?.length) {
    const copy = new Uint8Array(input.bytes);
    blob = new Blob([copy], { type: 'application/pdf' });
    if (!/\.pdf$/i.test(fileName)) fileName = `${fileName}.pdf`;
  } else if (input.url) {
    const res = await fetch(input.url);
    if (!res.ok) throw new Error('Could not load bill of lading to share.');
    blob = await res.blob();
  } else {
    throw new Error('Nothing to share yet. Upload or open a bill of lading first.');
  }

  const mimeType = blob.type
    || (/\.pdf$/i.test(fileName) ? 'application/pdf' : 'image/jpeg');
  if (!/\.(pdf|jpe?g|png|webp)$/i.test(fileName)) {
    fileName = `${fileName}${mimeType.includes('pdf') ? '.pdf' : '.jpg'}`;
  }
  const title = input.title;

  if (Capacitor.isNativePlatform() && mimeType.startsWith('image/')) {
    await WhatsAppShare.shareImage({
      dataBase64: await blobToBase64(blob),
      fileName,
      mimeType,
    });
    return;
  }

  const shareFile = new File([blob], fileName, { type: mimeType });
  const shareData: ShareData = { files: [shareFile], title, text: title };
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    await navigator.share(shareData);
    return;
  }
  if (typeof navigator.share === 'function' && input.url) {
    await navigator.share({ title, text: title, url: input.url });
    return;
  }

  const anchor = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export const PurchaseOrderBlDialog: React.FC<Props> = ({
  open,
  purchaseOrder,
  canEdit,
  onClose,
  onSaved,
}) => {
  const existing = purchaseOrder.bl;
  const hasFile = purchaseOrderHasBl(existing);
  const [mode, setMode] = useState<Mode>('upload');
  const [shippingLine, setShippingLine] = useState(
    existing?.shippingLine || DEFAULT_SHIPPING_LINE,
  );
  const [blNumber, setBlNumber] = useState(existing?.blNumber ?? '');
  const [containerNumber, setContainerNumber] = useState(existing?.containerNumber ?? '');
  const [vesselName, setVesselName] = useState(existing?.vesselName ?? '');
  const [blDate, setBlDate] = useState(existing?.blDate || '');
  const [portOfLoading, setPortOfLoading] = useState(
    existing?.portOfLoading || purchaseOrder.tracking.etdPort || '',
  );
  const [portOfDischarge, setPortOfDischarge] = useState(
    existing?.portOfDischarge || purchaseOrder.tracking.etaPort || DEFAULT_PORT_OF_DISCHARGE,
  );
  const [etd, setEtd] = useState(purchaseOrder.tracking.sailingDate || '');
  const [eta, setEta] = useState(purchaseOrder.tracking.arrivalDate || '');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [localPdfBytes, setLocalPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<PurchaseOrderBlSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShippingLine(existing?.shippingLine || DEFAULT_SHIPPING_LINE);
    setBlNumber(existing?.blNumber ?? '');
    setContainerNumber(existing?.containerNumber ?? '');
    setVesselName(existing?.vesselName ?? '');
    setBlDate(existing?.blDate || '');
    setPortOfLoading(existing?.portOfLoading || purchaseOrder.tracking.etdPort || '');
    setPortOfDischarge(
      existing?.portOfDischarge || purchaseOrder.tracking.etaPort || DEFAULT_PORT_OF_DISCHARGE,
    );
    setEtd(purchaseOrder.tracking.sailingDate || '');
    setEta(purchaseOrder.tracking.arrivalDate || '');
    setFile(null);
    setError('');
    setSaving(false);
    setSharing(false);
    setSourceSearch('');
    setSelectedSourceId(existing?.linkedFromPurchaseOrderId ?? null);
    setMode(existing?.linkedFromPurchaseOrderId ? 'link' : 'upload');
  }, [
    open,
    existing?.shippingLine,
    existing?.blNumber,
    existing?.containerNumber,
    existing?.vesselName,
    existing?.blDate,
    existing?.portOfLoading,
    existing?.portOfDischarge,
    existing?.storagePath,
    existing?.linkedFromPurchaseOrderId,
    purchaseOrder.tracking.sailingDate,
    purchaseOrder.tracking.arrivalDate,
    purchaseOrder.tracking.etdPort,
    purchaseOrder.tracking.etaPort,
  ]);

  useEffect(() => {
    if (!open || !canEdit || mode !== 'link') return;
    let cancelled = false;
    setSourcesLoading(true);
    void listPurchaseOrderBlSources({ excludePurchaseOrderId: purchaseOrder.id })
      .then(rows => {
        if (!cancelled) setSources(rows);
      })
      .catch(err => {
        if (!cancelled) {
          setSources([]);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, mode, purchaseOrder.id]);

  useEffect(() => {
    if (!open || file) {
      if (file) {
        setPreviewUrl(null);
        setPdfBytes(null);
        setLoadingPreview(false);
      }
      return;
    }

    const pathForPreview = mode === 'link' && selectedSourceId
      ? (sources.find(s => s.purchaseOrderId === selectedSourceId)?.bl.storagePath ?? null)
      : (existing?.storagePath ?? null);

    if (!pathForPreview) {
      setPreviewUrl(null);
      setPdfBytes(null);
      setLoadingPreview(false);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);
    void fetchPurchaseOrderBlPreview(pathForPreview)
      .then(preview => {
        if (cancelled) return;
        setPreviewUrl(preview.url);
        setPdfBytes(preview.bytes);
        setError('');
      })
      .catch(err => {
        if (cancelled) return;
        setPreviewUrl(null);
        setPdfBytes(null);
        setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, existing?.storagePath, mode, selectedSourceId, sources, file]);

  useEffect(() => {
    if (!file) {
      setLocalPreviewUrl(null);
      setLocalPdfBytes(null);
      return;
    }
    if (file.type.includes('pdf') || /\.pdf$/i.test(file.name)) {
      setLocalPreviewUrl(null);
      let cancelled = false;
      void file.arrayBuffer().then(buf => {
        if (!cancelled) setLocalPdfBytes(new Uint8Array(buf));
      });
      return () => {
        cancelled = true;
      };
    }
    setLocalPdfBytes(null);
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!open || !canEdit || mode !== 'upload') return;
    let cancelled = false;
    const run = async () => {
      const detected = await extractPurchaseOrderBlDate({
        file,
        fileName: file?.name || existing?.fileName,
        pdfBytes: file ? localPdfBytes : pdfBytes,
      });
      if (cancelled || !detected) return;
      setBlDate(prev => prev || detected);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    canEdit,
    mode,
    file,
    localPdfBytes,
    pdfBytes,
    existing?.fileName,
  ]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !sharing) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, saving, sharing]);

  const filteredSources = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter(row => {
      const hay = [
        row.purchaseOrderNumber,
        row.vendorName,
        row.bl.containerNumber,
        row.bl.blNumber,
        row.bl.shippingLine,
        row.bl.fileName,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [sources, sourceSearch]);

  const selectedSource = selectedSourceId
    ? sources.find(s => s.purchaseOrderId === selectedSourceId) ?? null
    : null;

  if (!open) return null;

  const activePdfBytes = file ? localPdfBytes : pdfBytes;
  const showPdf = Boolean(activePdfBytes);
  const showImage = Boolean(localPreviewUrl || (!file && previewUrl && !pdfBytes));
  const imageSrc = localPreviewUrl || previewUrl;
  const canShare = Boolean(file || activePdfBytes || previewUrl || existing?.storagePath);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError('');
    try {
      if (mode === 'link') {
        if (!selectedSourceId) {
          throw new Error('Select a purchase order that already has a BL for this container.');
        }
        const next = await linkPurchaseOrderBlFromSource({
          purchaseOrderId: purchaseOrder.id,
          sourcePurchaseOrderId: selectedSourceId,
        });
        setFile(null);
        onSaved(next);
        return;
      }
        const next = await savePurchaseOrderBl({
          purchaseOrderId: purchaseOrder.id,
          shippingLine,
          blNumber,
          containerNumber,
          vesselName,
          blDate,
          portOfLoading,
          portOfDischarge,
          etd,
          eta,
          file,
          existing,
        });
      setFile(null);
      onSaved(next);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const share = async () => {
    setSharing(true);
    setError('');
    try {
      const title = [
        purchaseOrder.purchaseOrderNumber,
        'BL',
        shippingLine.trim() || existing?.shippingLine,
        containerNumber.trim() || existing?.containerNumber,
        blNumber.trim() || existing?.blNumber,
      ].filter(Boolean).join(' · ');
      await shareBlFile({
        url: previewUrl,
        bytes: activePdfBytes,
        file,
        fileName: file?.name || existing?.fileName || 'bill-of-lading',
        title,
      });
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop courier-slip-view-dialog__backdrop"
      onClick={() => { if (!saving && !sharing) onClose(); }}
    >
      <div
        className="dealers-modal panel glass courier-slip-view-dialog po-bl-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-bl-dialog-title"
      >
        <div className="dealers-modal__header courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <h2 id="po-bl-dialog-title">
              Bill of lading
              <span className="text-muted"> · {purchaseOrder.purchaseOrderNumber}</span>
              {existing?.linkedFromPurchaseOrderNumber
                ? (
                  <span className="text-muted">
                    {' '}· linked from {existing.linkedFromPurchaseOrderNumber}
                  </span>
                )
                : null}
            </h2>
          </div>
          <button
            type="button"
            className="btn po-bl-dialog__close"
            onClick={onClose}
            disabled={saving || sharing}
          >
            Close
          </button>
        </div>

        <div className="dealers-modal__actions courier-slip-view-dialog__actions po-bl-dialog__actions">
          <div className="po-bl-dialog__actions-end">
            {canShare ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || sharing || loadingPreview}
                onClick={() => { void share(); }}
              >
                <Share2 size={14} strokeWidth={2.2} aria-hidden />
                {sharing ? 'Sharing…' : 'Share'}
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || sharing || (mode === 'link' && !selectedSourceId)}
                onClick={() => { void save(); }}
              >
                {saving
                  ? 'Saving…'
                  : mode === 'link'
                    ? 'Link BL'
                    : hasFile
                      ? 'Update BL'
                      : 'Save BL'}
              </button>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          <div className="po-bl-dialog__modes" role="tablist" aria-label="BL save mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'upload'}
              className={`po-bl-dialog__mode${mode === 'upload' ? ' is-active' : ''}`}
              disabled={saving || sharing}
              onClick={() => {
                setMode('upload');
                setError('');
              }}
            >
              <Upload size={14} strokeWidth={2.2} aria-hidden />
              Upload new
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'link'}
              className={`po-bl-dialog__mode${mode === 'link' ? ' is-active' : ''}`}
              disabled={saving || sharing}
              onClick={() => {
                setMode('link');
                setFile(null);
                setError('');
              }}
            >
              <Link2 size={14} strokeWidth={2.2} aria-hidden />
              Link same container
            </button>
          </div>
        ) : null}

        {error ? <p className="dealers-modal__error">{error}</p> : null}

        <div className="courier-slip-view-dialog__body po-bl-dialog__preview">
          {loadingPreview || (file && file.type.includes('pdf') && !localPdfBytes) ? (
            <FetchingLoader label="Loading bill of lading…" />
          ) : showPdf && activePdfBytes ? (
            <ZoomablePdfPreview data={activePdfBytes} />
          ) : showImage && imageSrc ? (
            <ZoomableImagePreview src={imageSrc} alt="Bill of lading" />
          ) : (
            <p className="text-muted text-sm courier-slip-view-dialog__status">
              {canEdit
                ? mode === 'link'
                  ? 'Select another PO’s BL below to preview and link.'
                  : 'Upload a PDF or JPG below, then enter shipping company, ports, BL date, ETD, and ETA.'
                : 'No bill of lading uploaded for this purchase order.'}
            </p>
          )}
        </div>

        {mode === 'upload' ? (
          <div className="po-bl-dialog__fields">
            {canEdit ? (
              <label className="dealers-modal__field">
                <span>{hasFile ? 'Replace PDF / JPG' : 'Upload PDF / JPG'}</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  disabled={saving || sharing}
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : null}
            <label className="dealers-modal__field">
              <span>Shipping company</span>
              {canEdit ? (
                <select
                  className="input-field"
                  value={shippingLine || DEFAULT_SHIPPING_LINE}
                  onChange={e => setShippingLine(e.target.value)}
                  disabled={saving || sharing}
                >
                  {!PURCHASE_ORDER_SHIPPING_LINES.includes(
                    shippingLine as (typeof PURCHASE_ORDER_SHIPPING_LINES)[number],
                  ) && shippingLine ? (
                    <option value={shippingLine}>{shippingLine}</option>
                  ) : null}
                  {PURCHASE_ORDER_SHIPPING_LINES.map(line => (
                    <option key={line} value={line}>{line}</option>
                  ))}
                </select>
              ) : (
                <strong>{existing?.shippingLine || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>B/L number</span>
              {canEdit ? (
                <input
                  type="text"
                  className="input-field"
                  value={blNumber}
                  onChange={e => setBlNumber(e.target.value)}
                  disabled={saving || sharing}
                  placeholder="e.g. WHLC0123456789"
                  autoComplete="off"
                />
              ) : (
                <strong>{existing?.blNumber || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>Container number</span>
              {canEdit ? (
                <input
                  type="text"
                  className="input-field"
                  value={containerNumber}
                  onChange={e => setContainerNumber(e.target.value)}
                  disabled={saving || sharing}
                  placeholder="e.g. TEMU1234567"
                  autoComplete="off"
                />
              ) : (
                <strong>{existing?.containerNumber || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>Vessel name / IMO / MMSI</span>
              {canEdit ? (
                <input
                  type="text"
                  className="input-field"
                  value={vesselName}
                  onChange={e => setVesselName(e.target.value)}
                  disabled={saving || sharing}
                  placeholder="e.g. WAN HAI 521 or IMO 9400186"
                  autoComplete="off"
                />
              ) : (
                <strong>{existing?.vesselName || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>Port of loading</span>
              {canEdit ? (
                <input
                  type="text"
                  className="input-field"
                  value={portOfLoading}
                  onChange={e => setPortOfLoading(e.target.value)}
                  disabled={saving || sharing}
                  placeholder="e.g. Ningbo Beilun"
                  autoComplete="off"
                />
              ) : (
                <strong>{existing?.portOfLoading || purchaseOrder.tracking.etdPort || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>Port of final discharge</span>
              {canEdit ? (
                <input
                  type="text"
                  className="input-field"
                  value={portOfDischarge}
                  onChange={e => setPortOfDischarge(e.target.value)}
                  disabled={saving || sharing}
                  placeholder="Cochin"
                  autoComplete="off"
                />
              ) : (
                <strong>
                  {existing?.portOfDischarge
                    || purchaseOrder.tracking.etaPort
                    || DEFAULT_PORT_OF_DISCHARGE}
                </strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>BL date</span>
              {canEdit ? (
                <input
                  type="date"
                  className="input-field"
                  value={blDate}
                  onChange={e => setBlDate(e.target.value)}
                  disabled={saving || sharing}
                />
              ) : (
                <strong>{existing?.blDate || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>ETD</span>
              {canEdit ? (
                <input
                  type="date"
                  className="input-field"
                  value={etd}
                  onChange={e => setEtd(e.target.value)}
                  disabled={saving || sharing}
                />
              ) : (
                <strong>{purchaseOrder.tracking.sailingDate || '—'}</strong>
              )}
            </label>
            <label className="dealers-modal__field">
              <span>ETA</span>
              {canEdit ? (
                <input
                  type="date"
                  className="input-field"
                  value={eta}
                  onChange={e => setEta(e.target.value)}
                  disabled={saving || sharing}
                />
              ) : (
                <strong>{purchaseOrder.tracking.arrivalDate || '—'}</strong>
              )}
            </label>
          </div>
        ) : (
          <div className="po-bl-dialog__fields po-bl-dialog__link">
            <p className="text-muted text-sm po-bl-dialog__link-hint">
              Ship together: reuse a BL already uploaded on another PO for the same container.
              Tracking fields (line, B/L, container, ports, ETD, ETA) copy from that PO
              and stay in sync when the master BL is updated.
            </p>
            <label className="dealers-modal__field">
              <span>Search PO / vendor / container / B/L</span>
              <input
                type="search"
                className="input-field"
                value={sourceSearch}
                onChange={e => setSourceSearch(e.target.value)}
                disabled={saving || sharing || sourcesLoading}
                placeholder="PO-00316, Wan Hai, or container…"
                autoComplete="off"
              />
            </label>
            <div className="po-bl-dialog__source-list" role="listbox" aria-label="Purchase orders with BL">
              {sourcesLoading ? (
                <FetchingLoader label="Loading BLs…" />
              ) : filteredSources.length === 0 ? (
                <p className="text-muted text-sm">
                  No other draft POs with a bill of lading found.
                </p>
              ) : (
                filteredSources.map(row => {
                  const active = selectedSourceId === row.purchaseOrderId;
                  return (
                    <button
                      key={row.purchaseOrderId}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`po-bl-dialog__source${active ? ' is-active' : ''}`}
                      disabled={saving || sharing}
                      onClick={() => setSelectedSourceId(row.purchaseOrderId)}
                    >
                      <span className="po-bl-dialog__source-main">
                        <strong>{row.purchaseOrderNumber}</strong>
                        <span>{row.vendorName || '—'}</span>
                      </span>
                      <span className="po-bl-dialog__source-meta">
                        <span>
                          {[row.bl.shippingLine, row.bl.containerNumber].filter(Boolean).join(' · ')
                            || 'No container'}
                        </span>
                        <span>{row.bl.blNumber || row.bl.fileName || 'BL file'}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedSource ? (
              <p className="po-bl-dialog__link-selected text-sm">
                Will link{' '}
                <strong>{selectedSource.bl.shippingLine || '—'}</strong>
                {' · container '}
                <strong>{selectedSource.bl.containerNumber || '—'}</strong>
                {selectedSource.bl.blNumber
                  ? <> · B/L <strong>{selectedSource.bl.blNumber}</strong></>
                  : null}
                {' '}from <strong>{selectedSource.purchaseOrderNumber}</strong>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
