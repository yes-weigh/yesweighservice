import React, { useEffect, useState } from 'react';
import type { FreightLineSku } from '../../constants/freightLines';
import { fetchCatalog, formatCurrency } from '../../lib/catalog';
import { LOCAL_FREIGHT_SKU_OPTIONS } from '../../lib/invoiceLocalFreight';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import {
  formatFreightDiffLabel,
  paidFreightInrForInvoice,
  quoteActualFreightForInvoicePartner,
} from '../../lib/logisticsFreightCompare';
import { resolveInvoiceShipFromSiteOrDefault } from '../../lib/logisticsShipFrom';
import { partnerIdForFreightSku } from '../../lib/orderFreight';
import type { CatalogProduct } from '../../types/catalog';
import type { DealerInvoiceDetail } from '../../types/invoices';

type Estimate = {
  actualFreightInr: number | null;
  differenceInr: number | null;
  note: string | null;
};

type Props = {
  invoice: DealerInvoiceDetail;
  selectedSku: string | null;
  busy?: boolean;
  error?: string;
  onSelect: (sku: FreightLineSku) => void;
};

export const InvoiceLocalFreightEditor: React.FC<Props> = ({
  invoice,
  selectedSku,
  busy = false,
  error = '',
  onSelect,
}) => {
  const paidFreightInr = paidFreightInrForInvoice(invoice);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const partnerId = partnerIdForFreightSku(selectedSku);
    if (!partnerId) {
      setEstimate(null);
      return undefined;
    }

    setEstimating(true);
    void (async () => {
      try {
        const [rates, catalog, shipFrom] = await Promise.all([
          loadLogisticsCourierRates(),
          fetchCatalog(),
          resolveInvoiceShipFromSiteOrDefault(invoice),
        ]);
        if (cancelled) return;
        const productsById = new Map<string, CatalogProduct>(
          catalog.items.map(item => [item.id, item]),
        );
        const quoted = quoteActualFreightForInvoicePartner({
          invoice,
          partnerId,
          rates,
          productsById,
          shipFromSite: shipFrom.site,
        });
        const actual = quoted.totalInr;
        setEstimate({
          actualFreightInr: actual,
          differenceInr: actual != null ? actual - paidFreightInr : null,
          note: quoted.note,
        });
      } catch {
        if (!cancelled) {
          setEstimate({
            actualFreightInr: null,
            differenceInr: null,
            note: 'Could not estimate actual freight',
          });
        }
      } finally {
        if (!cancelled) setEstimating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice, paidFreightInr, selectedSku]);

  const actualHigher = (estimate?.differenceInr ?? 0) > 0;

  return (
    <div className="invoice-local-freight">
      <p className="invoice-local-freight__hint text-muted text-sm">
        Super admin only — switch courier in YesOne if the billed partner cannot serve this pin.
        Invoice amount stays the billed freight. This is not sent to Zoho (e-invoice cannot change).
        If the new partner costs more, logistics shows Paid vs Actual and the Diff.
      </p>
      <div
        className="freight-partner-picker__list"
        role="radiogroup"
        aria-label="Local logistics partner"
      >
        {LOCAL_FREIGHT_SKU_OPTIONS.map(option => {
          const selected = selectedSku === option.sku;
          return (
            <div
              key={option.sku}
              className={`freight-partner-picker__row${selected ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className="freight-partner-picker__main"
                disabled={busy}
                onClick={() => {
                  if (selected) return;
                  onSelect(option.sku);
                }}
              >
                <span
                  className={`freight-partner-picker__radio${selected ? ' is-on' : ''}`}
                  aria-hidden
                />
                <span className="freight-partner-picker__logo-wrap">
                  <img
                    src={option.image}
                    alt=""
                    className="freight-partner-picker__logo"
                    loading="lazy"
                    decoding="async"
                  />
                </span>
                <span className="freight-partner-picker__copy">
                  <strong>{option.label}</strong>
                  <span className="text-muted text-sm">{option.sku}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <dl className="invoice-local-freight__compare">
        <div>
          <dt>Paid</dt>
          <dd>{formatCurrency(paidFreightInr)}</dd>
        </div>
        <div>
          <dt>Actual</dt>
          <dd>
            {estimating
              ? '…'
              : (estimate?.actualFreightInr != null
                ? formatCurrency(estimate.actualFreightInr)
                : '—')}
          </dd>
        </div>
        <div
          className={[
            'invoice-local-freight__diff',
            estimate?.differenceInr == null
              ? ''
              : estimate.differenceInr > 0
                ? 'is-under'
                : estimate.differenceInr < 0
                  ? 'is-over'
                  : 'is-matched',
          ].filter(Boolean).join(' ')}
        >
          <dt>Diff</dt>
          <dd>
            {estimating
              ? '…'
              : (estimate?.differenceInr != null
                ? (
                  <>
                    {formatCurrency(estimate.differenceInr)}
                    <em>{formatFreightDiffLabel(estimate.differenceInr)}</em>
                  </>
                )
                : '—')}
          </dd>
        </div>
      </dl>
      {actualHigher ? (
        <p className="invoice-local-freight__diff-note text-muted text-sm">
          Invoice stays {formatCurrency(paidFreightInr)}. The extra shows as Diff on the logistics list after booking.
        </p>
      ) : null}
      {!estimating && estimate?.note && estimate.actualFreightInr == null ? (
        <p className="invoice-local-freight__diff-note text-muted text-sm">{estimate.note}</p>
      ) : null}
      {error ? (
        <p className="invoice-local-freight__error" role="alert">{error}</p>
      ) : null}
    </div>
  );
};
