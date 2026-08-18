import React, { useEffect, useMemo, useState } from 'react';
import { fetchCatalog, formatCurrency } from '../../lib/catalog';
import {
  invoiceLocalFreightListOptions,
  isLocalFreightPickupSku,
  type LocalFreightSelectSku,
} from '../../lib/invoiceLocalFreight';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import { partnerUsesLiveDelhiveryQuote } from '../../lib/delhiveryCartFreight';
import {
  formatFreightDiffLabel,
  paidFreightInrForInvoice,
  quoteActualFreightForInvoicePartner,
  quoteLiveDelhiveryFreightForInvoice,
} from '../../lib/logisticsFreightCompare';
import { resolveInvoiceShipFromSiteOrDefault } from '../../lib/logisticsShipFrom';
import { isPickupPartner } from '../../lib/orderFreight';
import type { CatalogProduct } from '../../types/catalog';
import type { DealerInvoiceDetail } from '../../types/invoices';
import type { LogisticsDeliveryRulesMatrix } from '../../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../../types/logistics-partner-status';
import type { StaffLogisticsSite } from '../../types/staff-logistics';

type PartnerQuote = {
  actualFreightInr: number | null;
  differenceInr: number | null;
  note: string | null;
};

type Props = {
  invoice: DealerInvoiceDetail;
  selectedSku: string | null;
  busy?: boolean;
  error?: string;
  onSelect: (sku: LocalFreightSelectSku) => void;
};

export const InvoiceLocalFreightEditor: React.FC<Props> = ({
  invoice,
  selectedSku,
  busy = false,
  error = '',
  onSelect,
}) => {
  const paidFreightInr = paidFreightInrForInvoice(invoice);
  const [quotes, setQuotes] = useState<Partial<Record<string, PartnerQuote>>>({});
  const [estimating, setEstimating] = useState(false);
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [partnerStatuses, setPartnerStatuses] = useState<LogisticsPartnerStatuses | null>(null);
  const [shipFromSite, setShipFromSite] = useState<StaffLogisticsSite | null>(null);
  const [originAddress, setOriginAddress] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadLogisticsSettings(),
      resolveInvoiceShipFromSiteOrDefault(invoice),
    ]).then(([settings, shipFrom]) => {
      if (cancelled) return;
      setDeliveryRules(settings.deliveryRules);
      setPartnerStatuses(settings.partnerStatuses);
      setShipFromSite(shipFrom.site);
      setOriginAddress(settings.fromAddresses[shipFrom.site] || '');
    }).catch(() => {
      if (!cancelled) {
        setDeliveryRules(null);
        setPartnerStatuses(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const options = useMemo(() => {
    if (!deliveryRules || !partnerStatuses || !shipFromSite) return [];
    return invoiceLocalFreightListOptions({
      invoice,
      deliveryRules,
      partnerStatuses,
      shipFromSite,
    });
  }, [deliveryRules, invoice, partnerStatuses, shipFromSite]);

  useEffect(() => {
    let cancelled = false;
    if (!options.length || !shipFromSite) {
      setQuotes({});
      return undefined;
    }
    setEstimating(true);
    void (async () => {
      try {
        const [rates, catalog] = await Promise.all([
          loadLogisticsCourierRates(),
          fetchCatalog(),
        ]);
        if (cancelled) return;
        const productsById = new Map<string, CatalogProduct>(
          catalog.items.map(item => [item.id, item]),
        );
        const next: Partial<Record<string, PartnerQuote>> = {};
        const delhiverySkus: string[] = [];
        for (const option of options) {
          if (isPickupPartner(option.partnerId) || isLocalFreightPickupSku(option.sku)) {
            next[option.sku] = {
              actualFreightInr: 0,
              differenceInr: 0 - paidFreightInr,
              note: null,
            };
            continue;
          }
          if (partnerUsesLiveDelhiveryQuote(option.partnerId)) {
            delhiverySkus.push(option.sku);
            continue;
          }
          const quoted = quoteActualFreightForInvoicePartner({
            invoice,
            partnerId: option.partnerId,
            rates,
            productsById,
            shipFromSite,
          });
          const actual = quoted.totalInr;
          next[option.sku] = {
            actualFreightInr: actual,
            differenceInr: actual != null ? actual - paidFreightInr : null,
            note: quoted.note,
          };
        }
        if (!cancelled) setQuotes(next);
        if (delhiverySkus.length) {
          const live = await quoteLiveDelhiveryFreightForInvoice({
            invoice,
            productsById,
            originAddress,
          });
          if (cancelled) return;
          const actual = live.totalInr;
          for (const sku of delhiverySkus) {
            next[sku] = {
              actualFreightInr: actual,
              differenceInr: actual != null ? actual - paidFreightInr : null,
              note: live.note,
            };
          }
          setQuotes({ ...next });
        }
      } catch {
        if (!cancelled) setQuotes({});
      } finally {
        if (!cancelled) setEstimating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice, options, originAddress, paidFreightInr, shipFromSite]);

  const selectedQuote = selectedSku ? quotes[selectedSku] ?? null : null;
  const selectedIsPickup = isLocalFreightPickupSku(selectedSku);
  const selectedIsLive = Boolean(
    selectedSku
    && partnerUsesLiveDelhiveryQuote(
      options.find(option => option.sku === selectedSku)?.partnerId,
    ),
  );
  const actualHigher = !selectedIsPickup && (selectedQuote?.differenceInr ?? 0) > 0;
  const selectedNote = useMemo(
    () => (!estimating && selectedQuote?.note && selectedQuote.actualFreightInr == null
      ? selectedQuote.note
      : null),
    [estimating, selectedQuote],
  );

  return (
    <div className="invoice-local-freight">
      <div
        className="freight-partner-picker__list"
        role="radiogroup"
        aria-label="Serviceable logistics partners"
      >
        {options.map(option => {
          const selected = selectedSku === option.sku;
          const quote = quotes[option.sku];
          const pickup = isLocalFreightPickupSku(option.sku);
          const liveApi = partnerUsesLiveDelhiveryQuote(option.partnerId);
          const diff = pickup || liveApi ? null : (quote?.differenceInr ?? null);
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
                  <span className="text-muted text-sm">
                    {pickup ? 'Customer collect' : option.sku}
                  </span>
                </span>
                <span
                  className={[
                    'invoice-local-freight__est',
                    liveApi
                      ? 'is-live'
                      : diff == null
                        ? ''
                        : diff > 0
                          ? 'is-under'
                          : diff < 0
                            ? 'is-over'
                            : 'is-matched',
                  ].filter(Boolean).join(' ')}
                >
                  <strong>
                    {quote?.actualFreightInr != null
                      ? formatCurrency(quote.actualFreightInr)
                      : (estimating ? '…' : '—')}
                  </strong>
                  <em>{pickup ? 'No freight' : (liveApi ? 'API' : 'Est.')}</em>
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
        <div className={selectedIsLive ? 'invoice-local-freight__actual is-live' : undefined}>
          <dt>Actual</dt>
          <dd>
            {estimating
              ? '…'
              : (selectedQuote?.actualFreightInr != null
                ? formatCurrency(selectedQuote.actualFreightInr)
                : '—')}
          </dd>
        </div>
        <div
          className={[
            'invoice-local-freight__diff',
            selectedQuote?.differenceInr == null
              ? ''
              : selectedQuote.differenceInr > 0
                ? 'is-under'
                : selectedQuote.differenceInr < 0
                  ? 'is-over'
                  : 'is-matched',
          ].filter(Boolean).join(' ')}
        >
          <dt>Diff</dt>
          <dd>
            {estimating
              ? '…'
              : (selectedQuote?.differenceInr != null
                ? (
                  <>
                    {formatCurrency(selectedQuote.differenceInr)}
                    <em>{formatFreightDiffLabel(selectedQuote.differenceInr)}</em>
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
      {selectedNote ? (
        <p className="invoice-local-freight__diff-note text-muted text-sm">{selectedNote}</p>
      ) : null}
      {error ? (
        <p className="invoice-local-freight__error" role="alert">{error}</p>
      ) : null}
    </div>
  );
};
