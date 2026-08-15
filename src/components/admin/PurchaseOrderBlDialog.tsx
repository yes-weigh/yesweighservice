import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ZoomableImagePreview } from '../logistics/ZoomableImagePreview';
import { ZoomablePdfPreview } from '../logistics/ZoomablePdfPreview';
import { FetchingLoader } from '../FetchingLoader';
import {
  fetchPurchaseOrderBlPreview,
  purchaseOrderHasBl,
  savePurchaseOrderBl,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderBl,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (bl: PurchaseOrderBl) => void;
};

export const PurchaseOrderBlDialog: React.FC<Props> = ({
  open,
  purchaseOrder,
  canEdit,
  onClose,
  onSaved,
}) => {
  const existing = purchaseOrder.bl;
  const hasFile = purchaseOrderHasBl(existing);
  const [containerNumber, setContainerNumber] = useState(existing?.containerNumber ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setContainerNumber(existing?.containerNumber ?? '');
    setFile(null);
    setError('');
    setSaving(false);
  }, [open, existing?.containerNumber, existing?.storagePath]);

  useEffect(() => {
    if (!open || !existing?.storagePath) {
      setPreviewUrl(null);
      setPdfBytes(null);
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setError('');
    void fetchPurchaseOrderBlPreview(existing.storagePath)
      .then(preview => {
        if (cancelled) return;
        setPreviewUrl(preview.url);
        setPdfBytes(preview.bytes);
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
  }, [open, existing?.storagePath]);

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

  if (!open) return null;

  const showPdf = !file && Boolean(pdfBytes);
  const showImage = Boolean(localPreviewUrl || (!file && previewUrl && !pdfBytes));
  const imageSrc = localPreviewUrl || previewUrl;

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError('');
    try {
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
                ? 'No bill of lading yet. Upload a PDF or JPG and enter the container number.'
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
              disabled={saving}
              onClick={() => { void save(); }}
            >
              {saving ? 'Saving…' : hasFile ? 'Update BL' : 'Save BL'}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};
