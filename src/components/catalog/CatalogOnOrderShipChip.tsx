import { useEffect, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Ship, X } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { formatStockQuantity } from '../../lib/catalog';
import {
  resolvePurchaseOrderVesselMap,
  type PurchaseOrderVesselMapTarget,
} from '../../lib/admin-purchase-orders';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import {
  catalogShipmentHasTracking,
  loadOnOrderShipmentsForItem,
  type CatalogOnOrderShipment,
} from '../../lib/raisedPoQty';
import {
  prettyPortName,
} from '../../lib/sea-voyage-route';
import { VoyageSeaMap } from './VoyageSeaMap';
import { useCanViewShipmentTracking } from '../../hooks/useCanViewShipmentTracking';

type ChipProps = {
  productId: string;
  quantity: number;
  unit?: string | null;
};

function pickShipment(rows: CatalogOnOrderShipment[]): CatalogOnOrderShipment | null {
  const tracked = rows.filter(catalogShipmentHasTracking);
  if (!tracked.length) return null;
  return tracked.find(row => row.vesselName) || tracked[0];
}

export function CatalogOnOrderShipChip({
  productId,
  quantity,
  unit,
}: ChipProps) {
  const allowed = useCanViewShipmentTracking();
  const [open, setOpen] = useState(false);

  const openDialog = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!allowed) return;
    setOpen(true);
  };

  if (!allowed) return null;

  return (
    <>
      <span
        className="catalog-product-card__on-order"
        role="button"
        tabIndex={0}
        title="Shipment ETA and live map"
        aria-label="Open shipment ETA and live map"
        onClick={openDialog}
        onPointerDown={event => event.stopPropagation()}
        onPointerUp={event => event.stopPropagation()}
        onTouchStart={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') openDialog(event);
        }}
      >
        <Ship size={12} strokeWidth={2.5} aria-hidden />
        <span>{formatStockQuantity(quantity, unit ?? undefined)}</span>
      </span>
      <CatalogOnOrderShipDialog
        open={open}
        productId={productId}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function CatalogOnOrderShipDialog({
  open,
  productId,
  onClose,
}: {
  open: boolean;
  productId: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CatalogOnOrderShipment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<PurchaseOrderVesselMapTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tracked = rows.filter(catalogShipmentHasTracking);
  const selected = tracked.find(row => row.purchaseOrderId === selectedId) ?? pickShipment(tracked);

  useEffect(() => {
    if (!open) {
      setRows([]);
      setSelectedId(null);
      setTarget(null);
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadOnOrderShipmentsForItem(productId)
      .then(next => {
        if (cancelled) return;
        setRows(next);
        setSelectedId(pickShipment(next)?.purchaseOrderId ?? null);
      })
      .catch(err => {
        if (!cancelled) {
          setRows([]);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, productId]);

  useEffect(() => {
    if (!open || !selected?.bl) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    void resolvePurchaseOrderVesselMap(selected.bl, {
      portOfLoading: selected.etdPort || selected.bl.portOfLoading,
      portOfDischarge: selected.etaPort || selected.bl.portOfDischarge || 'Cochin',
    })
      .then(next => {
        if (!cancelled) setTarget(next);
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected?.purchaseOrderId, selected?.bl, selected?.etdPort, selected?.etaPort]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const etaPort = selected?.etaPort || selected?.bl?.portOfDischarge || 'Cochin';
  const etaDate = selected?.eta ? formatInvoiceDate(selected.eta) : 'Not set';
  const etdPort = selected?.etdPort || selected?.bl?.portOfLoading || 'Port of loading';
  const etdDate = selected?.etd ? formatInvoiceDate(selected.etd) : 'Not set';
  const departed = Boolean(selected);

  return createPortal(
    <div className="dealers-modal-backdrop catalog-on-order-dialog__backdrop" onClick={onClose}>
      <div
        className="dealers-modal panel glass catalog-on-order-dialog"
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-on-order-title"
      >
        <div className="dealers-modal__header catalog-on-order-dialog__header">
          <span className="catalog-on-order-dialog__header-ship" aria-hidden>
            <Ship size={16} strokeWidth={2.4} />
          </span>
          <div className="catalog-on-order-dialog__titles">
            {departed ? (
              <>
                <h2 id="catalog-on-order-title">
                  ETA {prettyPortName(etaPort)} {etaDate}
                </h2>
                <p className="catalog-on-order-dialog__etd">
                  <CalendarDays size={14} strokeWidth={2.4} aria-hidden />
                  ETD {prettyPortName(etdPort)} {etdDate}
                </p>
              </>
            ) : (
              <h2 id="catalog-on-order-title">Shipment</h2>
            )}
          </div>
          <button
            type="button"
            className="dealers-modal__close catalog-on-order-dialog__x"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={22} strokeWidth={2.4} />
          </button>
        </div>

        {loading ? <FetchingLoader label="Loading shipment…" /> : null}
        {error ? <p className="dealers-modal__error">{error}</p> : null}

        {!loading && !rows.length && !error ? (
          <p className="text-muted text-sm">No open purchase order found for this item.</p>
        ) : null}

        {tracked.length > 1 ? (
          <div className="catalog-on-order-dialog__list" role="list">
            {tracked.map(row => (
              <button
                key={row.purchaseOrderId}
                type="button"
                className={`catalog-on-order-dialog__row${
                  row.purchaseOrderId === selected?.purchaseOrderId ? ' is-active' : ''
                }`}
                onClick={() => setSelectedId(row.purchaseOrderId)}
              >
                <strong>{row.purchaseOrderNumber}</strong>
                <span>{row.eta ? formatInvoiceDate(row.eta) : formatInvoiceDate(row.etd)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="catalog-on-order-dialog__map" aria-label="Ship voyage map">
          {selected ? (
            <VoyageSeaMap
              portOfLoading={selected.etdPort || selected.bl?.portOfLoading || ''}
              portOfDischarge={etaPort}
              vesselName={selected.vesselName || target?.name}
              imo={target?.imo}
              etd={selected.etd}
              eta={selected.eta}
            />
          ) : !loading && rows.length && !error ? (
            <div className="catalog-on-order-dialog__not-departed">
              <Ship size={36} strokeWidth={1.8} aria-hidden />
              <p>Ship have not departed</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
