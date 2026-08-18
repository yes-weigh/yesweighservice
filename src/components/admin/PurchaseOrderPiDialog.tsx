import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ZoomableExcelPreview } from './ZoomableExcelPreview';
import { ZoomablePdfPreview } from '../logistics/ZoomablePdfPreview';
import { FetchingLoader } from '../FetchingLoader';
import {
  fetchPurchaseOrderVendorPiPreview,
  persistPurchaseOrderVendorPiTotal,
  purchaseOrderHasVendorPi,
  savePurchaseOrderVendorPi,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderVendorPi,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';
import type { VendorPiExcelTotal } from '../../lib/vendorPiExcel';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (vendorPi: PurchaseOrderVendorPi) => void;
  onPiUpdated?: (vendorPi: PurchaseOrderVendorPi) => void;
};

export const PurchaseOrderPiDialog: React.FC<Props> = ({
  open,
  purchaseOrder,
  canEdit,
  onClose,
  onSaved,
  onPiUpdated,
}) => {
  const existing = purchaseOrder.vendorPi;
  const hasFile = purchaseOrderHasVendorPi(existing);
  const [file, setFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [excelBytes, setExcelBytes] = useState<Uint8Array | null>(null);
  const [pendingExcelBytes, setPendingExcelBytes] = useState<Uint8Array | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPendingExcelBytes(null);
    setError('');
    setSaving(false);
  }, [open, existing?.storagePath]);

  useEffect(() => {
    if (!open || !existing?.storagePath) {
      setPdfBytes(null);
      setExcelBytes(null);
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setError('');
    void fetchPurchaseOrderVendorPiPreview(existing.storagePath)
      .then(preview => {
        if (cancelled) return;
        if (preview.isPdf) {
          setPdfBytes(preview.bytes);
          setExcelBytes(null);
        } else {
          setPdfBytes(null);
          setExcelBytes(preview.bytes);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setPdfBytes(null);
        setExcelBytes(null);
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
    if (!open || !file) {
      setPendingExcelBytes(null);
      return;
    }
    const pendingIsPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (pendingIsPdf) {
      setPendingExcelBytes(null);
      return;
    }
    let cancelled = false;
    void file.arrayBuffer().then(buffer => {
      if (!cancelled) setPendingExcelBytes(new Uint8Array(buffer));
    });
    return () => {
      cancelled = true;
    };
  }, [open, file]);

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

  const handleTotalDetected = useCallback((total: VendorPiExcelTotal) => {
    if (!existing || file) return;
    const next = {
      ...existing,
      totalAmount: total.amount >= 1000 ? total.amount : existing.totalAmount,
      currencyCode: total.currencyCode || existing.currencyCode,
      piDate: total.piDate || existing.piDate,
    };
    if (
      next.totalAmount !== existing.totalAmount
      || next.currencyCode !== existing.currencyCode
      || next.piDate !== existing.piDate
    ) {
      onPiUpdated?.(next);
    }
    if (!canEdit) return;
    void persistPurchaseOrderVendorPiTotal({
      purchaseOrderId: purchaseOrder.id,
      existing,
      totalAmount: next.totalAmount,
      currencyCode: next.currencyCode,
      piDate: next.piDate,
    }).catch(() => undefined);
  }, [canEdit, existing, file, onPiUpdated, purchaseOrder.id]);

  if (!open) return null;

  const pendingIsPdf = Boolean(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
  const pendingIsExcel = Boolean(file && !pendingIsPdf);
  const showPdf = !file && Boolean(pdfBytes);
  const showExcel = Boolean(pendingExcelBytes) || (!file && Boolean(excelBytes));
  const excelPreviewBytes = pendingExcelBytes || excelBytes;

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
        className="dealers-modal panel glass courier-slip-view-dialog po-bl-dialog po-pi-dialog"
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
          ) : showExcel && excelPreviewBytes ? (
            <ZoomableExcelPreview
              data={excelPreviewBytes}
              onTotalDetected={handleTotalDetected}
            />
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
