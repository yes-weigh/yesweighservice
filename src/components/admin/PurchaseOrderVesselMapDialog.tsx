import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import {
  resolvePurchaseOrderVesselMap,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderVesselMapTarget,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';
import { VoyageSeaMap } from '../catalog/VoyageSeaMap';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  onClose: () => void;
};

export function PurchaseOrderVesselMapDialog({ open, purchaseOrder, onClose }: Props) {
  const [target, setTarget] = useState<PurchaseOrderVesselMapTarget | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setTarget(null);
      setError('');
      return;
    }
    let cancelled = false;
    setError('');
    void (async () => {
      try {
        const next = await resolvePurchaseOrderVesselMap(purchaseOrder.bl, {
          portOfLoading: purchaseOrder.bl?.portOfLoading || purchaseOrder.tracking.etdPort,
          portOfDischarge: purchaseOrder.bl?.portOfDischarge || purchaseOrder.tracking.etaPort || 'Cochin',
        });
        if (cancelled) return;
        setTarget(next);
      } catch (err) {
        if (!cancelled) setError(invoiceErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, purchaseOrder.bl, purchaseOrder.tracking.etdPort, purchaseOrder.tracking.etaPort]);

  if (!open) return null;

  const title = target?.name || purchaseOrder.bl?.vesselName || 'Live map';
  const mapUrl = target?.embedUrl || target?.searchUrl || null;

  return createPortal(
    <div
      className="dealers-modal-backdrop courier-slip-view-dialog__backdrop"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel glass courier-slip-view-dialog po-vessel-map-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-vessel-map-title"
      >
        <div className="dealers-modal__header courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <h2 id="po-vessel-map-title">{title}</h2>
            <p className="text-muted text-sm">Sea route · ports marked</p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="courier-slip-view-dialog__body po-vessel-map-dialog__body">
          {error && !purchaseOrder.bl ? <p className="dealers-modal__error">{error}</p> : null}
          <div className="po-vessel-map-dialog__frame-wrap">
            <VoyageSeaMap
              portOfLoading={
                purchaseOrder.bl?.portOfLoading
                || purchaseOrder.tracking.etdPort
                || ''
              }
              portOfDischarge={
                purchaseOrder.bl?.portOfDischarge
                || purchaseOrder.tracking.etaPort
                || 'Cochin'
              }
              vesselName={title}
              imo={target?.imo}
              etd={purchaseOrder.tracking.sailingDate}
              eta={purchaseOrder.tracking.arrivalDate}
            />
          </div>
        </div>

        {target?.embedUrl || (error && mapUrl) ? (
          <div className="dealers-modal__actions courier-slip-view-dialog__actions po-vessel-map-dialog__actions">
            {error && mapUrl ? <p className="text-muted text-sm">{error}</p> : null}
            {target?.embedUrl ? (
              <a
                className="btn btn-secondary"
                href={target.embedUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} strokeWidth={2.2} aria-hidden />
                Full screen
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
