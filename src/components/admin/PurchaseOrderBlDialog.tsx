import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Upload, X } from 'lucide-react';
import { ZoomableImagePreview } from '../logistics/ZoomableImagePreview';
import { ZoomablePdfPreview } from '../logistics/ZoomablePdfPreview';
import { FetchingLoader } from '../FetchingLoader';
import {
  fetchPurchaseOrderBlPreview,
  linkPurchaseOrderBlFromSource,
  listPurchaseOrderBlSources,
  purchaseOrderHasBl,
  savePurchaseOrderBl,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderBl,
  type PurchaseOrderBlSource,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (bl: PurchaseOrderBl) => void;
};

type Mode = 'upload' | 'link';

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
  const [containerNumber, setContainerNumber] = useState(existing?.containerNumber ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<PurchaseOrderBlSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setContainerNumber(existing?.containerNumber ?? '');
    setFile(null);
    setError('');
    setSaving(false);
    setSourceSearch('');
    setSelectedSourceId(existing?.linkedFromPurchaseOrderId ?? null);
    setMode(existing?.linkedFromPurchaseOrderId ? 'link' : 'upload');
  }, [
    open,
    existing?.containerNumber,
    existing?.storagePath,
    existing?.linkedFromPurchaseOrderId,
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
    if (!file || file.type.includes('pdf')) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, saving]);

  const filteredSources = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter(row => {
      const hay = [
        row.purchaseOrderNumber,
        row.vendorName,
        row.bl.containerNumber,
        row.bl.fileName,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [sources, sourceSearch]);

  const selectedSource = selectedSourceId
    ? sources.find(s => s.purchaseOrderId === selectedSourceId) ?? null
    : null;

  if (!open) return null;

  const showPdf = !file && Boolean(pdfBytes);
  const showImage = Boolean(localPreviewUrl || (!file && previewUrl && !pdfBytes));
  const imageSrc = localPreviewUrl || previewUrl;

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
        onSaved(next);
        return;
      }
      const next = await savePurchaseOrderBl({
        purchaseOrderId: purchaseOrder.id,
        containerNumber,
        file,
        existing,
      });
      onSaved(next);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop courier-slip-view-dialog__backdrop"
      onClick={() => { if (!saving) onClose(); }}
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
            <h2 id="po-bl-dialog-title">Bill of lading</h2>
            <p className="text-muted text-sm">
              {purchaseOrder.purchaseOrderNumber}
              {existing?.fileName ? ` · ${existing.fileName}` : ''}
              {existing?.linkedFromPurchaseOrderNumber
                ? ` · linked from ${existing.linkedFromPurchaseOrderNumber}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {canEdit ? (
          <div className="po-bl-dialog__modes" role="tablist" aria-label="BL save mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'upload'}
              className={`po-bl-dialog__mode${mode === 'upload' ? ' is-active' : ''}`}
              disabled={saving}
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
              disabled={saving}
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

        {mode === 'upload' ? (
          <div className="po-bl-dialog__fields">
            <label className="dealers-modal__field">
              <span>Container number</span>
              {canEdit ? (
                <input
                  type="text"
                  className="input-field"
                  value={containerNumber}
                  onChange={e => setContainerNumber(e.target.value)}
                  disabled={saving}
                  placeholder="e.g. TEMU1234567"
                  autoComplete="off"
                />
              ) : (
                <strong>{existing?.containerNumber || '—'}</strong>
              )}
            </label>
            {canEdit ? (
              <label className="dealers-modal__field">
                <span>{hasFile ? 'Replace PDF / JPG' : 'Upload PDF / JPG'}</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  disabled={saving}
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : null}
          </div>
        ) : (
          <div className="po-bl-dialog__fields po-bl-dialog__link">
            <p className="text-muted text-sm po-bl-dialog__link-hint">
              Ship together: reuse a BL already uploaded on another PO for the same container.
              This PO will count as Shipped without uploading again.
            </p>
            <label className="dealers-modal__field">
              <span>Search PO / vendor / container</span>
              <input
                type="search"
                className="input-field"
                value={sourceSearch}
                onChange={e => setSourceSearch(e.target.value)}
                disabled={saving || sourcesLoading}
                placeholder="PO-00316 or container…"
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
                      disabled={saving}
                      onClick={() => setSelectedSourceId(row.purchaseOrderId)}
                    >
                      <span className="po-bl-dialog__source-main">
                        <strong>{row.purchaseOrderNumber}</strong>
                        <span>{row.vendorName || '—'}</span>
                      </span>
                      <span className="po-bl-dialog__source-meta">
                        <span>{row.bl.containerNumber || 'No container'}</span>
                        <span>{row.bl.fileName || 'BL file'}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedSource ? (
              <p className="po-bl-dialog__link-selected text-sm">
                Will link container <strong>{selectedSource.bl.containerNumber || '—'}</strong>
                {' '}from <strong>{selectedSource.purchaseOrderNumber}</strong>
              </p>
            ) : null}
          </div>
        )}

        {error ? <p className="dealers-modal__error">{error}</p> : null}

        <div className="courier-slip-view-dialog__body po-bl-dialog__preview">
          {loadingPreview ? (
            <FetchingLoader label="Loading bill of lading…" />
          ) : showPdf && pdfBytes ? (
            <ZoomablePdfPreview data={pdfBytes} />
          ) : showImage && imageSrc ? (
            <ZoomableImagePreview src={imageSrc} alt="Bill of lading" />
          ) : file?.type === 'application/pdf' ? (
            <p className="text-muted text-sm courier-slip-view-dialog__status">
              {file.name} selected. Save to store it on this purchase order.
            </p>
          ) : (
            <p className="text-muted text-sm courier-slip-view-dialog__status">
              {canEdit
                ? mode === 'link'
                  ? 'Select another PO’s BL above to preview and link.'
                  : 'No bill of lading yet. Upload a PDF or JPG and enter the container number.'
                : 'No bill of lading uploaded for this purchase order.'}
            </p>
          )}
        </div>

        <div className="dealers-modal__actions courier-slip-view-dialog__actions">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
            Close
          </button>
          {canEdit ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || (mode === 'link' && !selectedSourceId)}
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
    </div>,
    document.body,
  );
};
