import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, X } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import {
  fetchPurchaseOrderQcImageUrl,
  savePurchaseOrderTrackingUpload,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderQcImage,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  onClose: () => void;
  onSaved: (next: {
    trackingScreenshots: PurchaseOrderQcImage[];
    tracking: AdminPurchaseOrderDetail['tracking'];
    activityLogs: AdminPurchaseOrderDetail['activityLogs'];
  }) => void;
};

export function PurchaseOrderTrackingUploadDialog({
  open,
  purchaseOrder,
  onClose,
  onSaved,
}: Props) {
  const [etd, setEtd] = useState('');
  const [eta, setEta] = useState('');
  const [etdPort, setEtdPort] = useState('');
  const [etaPort, setEtaPort] = useState('Cochin');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [existingUrls, setExistingUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const existing = purchaseOrder.trackingScreenshots ?? [];

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setError('');
      setSaving(false);
      return;
    }
    setEtd(purchaseOrder.tracking.sailingDate || '');
    setEta(purchaseOrder.tracking.arrivalDate || '');
    setEtdPort(purchaseOrder.tracking.etdPort || '');
    setEtaPort(purchaseOrder.tracking.etaPort || 'Cochin');
    setFiles([]);
    setError('');
  }, [open, purchaseOrder.id, purchaseOrder.tracking.sailingDate, purchaseOrder.tracking.arrivalDate]);

  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [files]);

  useEffect(() => {
    if (!open || !existing.length) {
      setExistingUrls([]);
      return;
    }
    let cancelled = false;
    void Promise.all(existing.map(shot => fetchPurchaseOrderQcImageUrl(shot.storagePath)))
      .then(urls => {
        if (!cancelled) setExistingUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setExistingUrls([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, existing]);

  if (!open) return null;

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const saved = await savePurchaseOrderTrackingUpload({
        purchaseOrderId: purchaseOrder.id,
        files,
        existing,
        tracking: {
          ...purchaseOrder.tracking,
          sailingDate: etd.trim() || purchaseOrder.tracking.sailingDate,
          arrivalDate: eta.trim() || purchaseOrder.tracking.arrivalDate,
          etdPort: etdPort.trim() || purchaseOrder.tracking.etdPort,
          etaPort: etaPort.trim() || 'Cochin',
        },
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="dealers-modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <div
        className="dealers-modal panel glass po-tracking-upload-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-tracking-upload-title"
      >
        <div className="dealers-modal__header">
          <div>
            <h2 id="po-tracking-upload-title">Upload tracking</h2>
            <p className="text-muted text-sm">
              Screenshot from the carrier. Set ETD and ETA from the image.
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

        <div className="po-tracking-upload-dialog__fields">
          <label className="dealers-modal__field">
            <span>Screenshot</span>
            <label className="btn btn-secondary po-tracking-upload-dialog__pick">
              <ImagePlus size={16} strokeWidth={2.2} aria-hidden />
              {files.length ? `${files.length} selected` : 'Choose photo'}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={saving}
                onChange={event => {
                  setFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>
          </label>

          {previews.length || existingUrls.length ? (
            <div className="po-tracking-upload-dialog__thumbs">
              {previews.map(src => (
                <img key={src} src={src} alt="New tracking screenshot" />
              ))}
              {existingUrls.map(src => (
                <img key={src} src={src} alt="Saved tracking screenshot" />
              ))}
            </div>
          ) : null}

          <label className="dealers-modal__field">
            <span>ETD</span>
            <input
              type="date"
              className="input-field"
              value={etd}
              onChange={e => setEtd(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="dealers-modal__field">
            <span>ETD port</span>
            <input
              type="text"
              className="input-field"
              value={etdPort}
              onChange={e => setEtdPort(e.target.value)}
              disabled={saving}
              placeholder="e.g. Port Klang"
              autoComplete="off"
            />
          </label>
          <label className="dealers-modal__field">
            <span>ETA</span>
            <input
              type="date"
              className="input-field"
              value={eta}
              onChange={e => setEta(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="dealers-modal__field">
            <span>ETA port</span>
            <input
              type="text"
              className="input-field"
              value={etaPort}
              onChange={e => setEtaPort(e.target.value)}
              disabled={saving}
              placeholder="Cochin"
              autoComplete="off"
            />
          </label>
        </div>

        {error ? <p className="dealers-modal__error">{error}</p> : null}
        {saving ? <FetchingLoader label="Saving tracking…" /> : null}

        <div className="dealers-modal__actions">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
