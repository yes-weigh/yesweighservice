import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ZoomablePdfPreview } from '../logistics/ZoomablePdfPreview';
import { FetchingLoader } from '../FetchingLoader';
import {
  fetchPurchaseOrderVendorPiPreview,
  purchaseOrderHasVendorPi,
  purchaseOrderVendorPiIsPdf,
  savePurchaseOrderVendorPi,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderVendorPi,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (vendorPi: PurchaseOrderVendorPi) => void;
};

export const PurchaseOrderPiDialog: React.FC<Props> = ({
  open,
  purchaseOrder,
  canEdit,
  onClose,
  onSaved,
}) => {
  const existing = purchaseOrder.vendorPi;
  const hasFile = purchaseOrderHasVendorPi(existing);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError('');
    setSaving(false);
  }, [open, existing?.storagePath]);

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
    void fetchPurchaseOrderVendorPiPreview(existing.storagePath)
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

  const pendingIsPdf = Boolean(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
  const pendingIsExcel = Boolean(file && !pendingIsPdf);
  const showPdf = !file && Boolean(pdfBytes);
  const showExcel = !file && Boolean(previewUrl) && !purchaseOrderVendorPiIsPdf(existing);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError('');
    try {
      const next = await savePurchaseOrderVendorPi({
        purchaseOrderId: purchaseOrder.id,
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
        aria-labelledby="po-pi-dialog-title"
      >
        <div className="dealers-modal__header courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <h2 id="po-pi-dialog-title">Vendor PI</h2>
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
          {canEdit ? (
            <label className="dealers-modal__field">
              <span>{hasFile ? 'Replace Excel / PDF' : 'Upload Excel / PDF'}</span>
              <input
                type="file"
                accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={saving}
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}
        </div>

        {error ? <p className="dealers-modal__error">{error}</p> : null}

        <div className="courier-slip-view-dialog__body po-bl-dialog__preview">
          {loadingPreview ? (
            <FetchingLoader label="Loading vendor PI…" />
          ) : showPdf && pdfBytes ? (
            <ZoomablePdfPreview data={pdfBytes} />
          ) : showExcel && previewUrl ? (
            <div className="po-pi-dialog__excel">
              <p className="text-muted text-sm mb-0">
                {existing?.fileName || 'Vendor PI spreadsheet'}
              </p>
              <a
                className="btn btn-secondary btn-sm"
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Download size={16} aria-hidden />
                Download Excel
              </a>
            </div>
          ) : pendingIsPdf || pendingIsExcel ? (
            <p className="text-muted text-sm courier-slip-view-dialog__status">
              {file?.name} selected. Save to store it on this purchase order.
            </p>
          ) : (
            <p className="text-muted text-sm courier-slip-view-dialog__status">
              {canEdit
                ? 'No vendor PI yet. Upload an Excel or PDF copy from the vendor.'
                : 'No vendor PI uploaded for this purchase order.'}
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
              disabled={saving || !file}
              onClick={() => { void save(); }}
            >
              {saving ? 'Saving…' : hasFile ? 'Update PI' : 'Save PI'}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};
