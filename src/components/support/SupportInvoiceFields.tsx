import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { InvoiceDocumentBody } from '../invoices/InvoiceDocumentBody';
import { FetchingLoader } from '../FetchingLoader';
import {
  fetchDealerInvoiceDetailWithCache,
  fetchDealerInvoicesWithCache,
  findLineItemBySerialQuery,
  formatInvoiceDate,
  isFreightInvoiceLineItem,
  isServiceExcludedLineItem,
  normalizeInvoiceSearchNeedle,
} from '../../lib/invoices';
import type { DealerInvoice, DealerInvoiceDetail, DealerInvoiceLineItem } from '../../types/invoices';
import type { SupportProductDraft, SupportRequestType } from '../../types/dealer-support';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface SupportInvoicePick {
  invoiceId: string;
  invoiceNumber: string;
  salesOrderNumber: string | null;
  matchedSerialQuery?: string | null;
}

function invoicePickLooksLikeSerialSearch(pick: SupportInvoicePick, query: string): boolean {
  const needle = normalizeInvoiceSearchNeedle(query);
  if (!needle) return false;
  if (normalizeInvoiceSearchNeedle(pick.invoiceNumber) === needle) return false;
  if (pick.salesOrderNumber && normalizeInvoiceSearchNeedle(pick.salesOrderNumber) === needle) {
    return false;
  }
  return true;
}

function invoiceToPick(invoice: DealerInvoice): SupportInvoicePick {
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    salesOrderNumber: invoice.referenceNumber,
  };
}

function lineItemToDraft(
  invoice: SupportInvoicePick,
  item: DealerInvoiceLineItem,
): SupportProductDraft {
  return {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    salesOrderNumber: invoice.salesOrderNumber,
    lineItemId: item.id,
    itemId: item.itemId,
    itemName: item.name,
    itemSku: item.sku,
    quantity: item.quantity,
  };
}

interface InvoiceAutocompleteProps {
  cacheKey: string;
  customerId?: string;
  value: SupportInvoicePick | null;
  onChange: (pick: SupportInvoicePick | null) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  placeholder?: string;
}

export const SupportInvoiceAutocomplete: React.FC<InvoiceAutocompleteProps> = ({
  cacheKey,
  customerId,
  value,
  onChange,
  required = false,
  disabled = false,
  id = 'support-invoice',
  label = 'Invoice number',
  placeholder = 'Start typing invoice number…',
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value?.invoiceNumber ?? '');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<DealerInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    setQuery(value?.matchedSerialQuery ?? value?.invoiceNumber ?? '');
  }, [value?.invoiceId, value?.invoiceNumber, value?.matchedSerialQuery]);

  useEffect(() => {
    if (!open || disabled) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await fetchDealerInvoicesWithCache(cacheKey, {
          customerId,
          q: debouncedQuery.trim() || undefined,
          limit: 12,
          sortField: 'date',
          sortDir: 'desc',
        });
        if (!cancelled) setSuggestions(res.data);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, customerId, debouncedQuery, disabled, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pickInvoice = (invoice: DealerInvoice) => {
    const pick = invoiceToPick(invoice);
    const query = debouncedQuery.trim();
    const matchedSerialQuery = invoicePickLooksLikeSerialSearch(pick, query) ? query : null;
    setQuery(matchedSerialQuery ?? pick.invoiceNumber);
    onChange({ ...pick, matchedSerialQuery });
    setOpen(false);
  };

  const handleInputChange = (next: string) => {
    setQuery(next);
    setOpen(true);
    if (value && next.trim() !== (value.matchedSerialQuery ?? value.invoiceNumber)) {
      onChange(null);
    }
  };

  return (
    <div className="form-group support-invoice-field" ref={rootRef}>
      <label htmlFor={id}>
        {label}
        {required && <span className="form-label__required" aria-hidden> *</span>}
      </label>
      <div className="support-invoice-field__input-wrap">
        <input
          id={id}
          type="text"
          className="catalog-select"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          required={required}
        />
        <span className="support-invoice-field__spinner" aria-hidden>
          {loading ? <Loader2 size={16} className="spin-icon" /> : null}
        </span>
      </div>
      {open && !disabled && (
        <ul
          id={`${id}-listbox`}
          className="support-invoice-field__menu"
          role="listbox"
        >
          {suggestions.length === 0 && !loading ? (
            <li className="support-invoice-field__empty text-muted text-sm">
              {debouncedQuery.trim() ? 'No matching invoices' : 'Type to search your invoices'}
            </li>
          ) : (
            suggestions.map(invoice => (
              <li key={invoice.id} role="presentation">
                <button
                  type="button"
                  className={`support-invoice-field__option${value?.invoiceId === invoice.id ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={value?.invoiceId === invoice.id}
                  onClick={() => pickInvoice(invoice)}
                >
                  <span className="support-invoice-field__option-main">
                    <strong>{invoice.invoiceNumber || invoice.id}</strong>
                    {invoice.referenceNumber && (
                      <span className="text-muted text-sm">Order {invoice.referenceNumber}</span>
                    )}
                  </span>
                  <span className="support-invoice-field__option-meta text-muted text-sm">
                    {formatInvoiceDate(invoice.date)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {required && !value && (
        <p className="support-invoice-field__hint text-muted text-sm">
          Pick an invoice from the suggestions — free text is not accepted.
        </p>
      )}
    </div>
  );
};

interface SupportInvoiceProductPickerProps {
  cacheKey: string;
  customerId?: string;
  value: SupportProductDraft | null;
  onChange: (draft: SupportProductDraft | null) => void;
  onNext?: () => void;
  onMatchedSerial?: (serial: string) => void;
  disabled?: boolean;
  /** When false, invoice selection is optional (e.g. out-of-warranty / no invoice). */
  invoiceRequired?: boolean;
  requestType?: Extract<SupportRequestType, 'service' | 'return'>;
}

function isExcludedSupportLineItem(
  item: DealerInvoiceLineItem,
  requestType?: Extract<SupportRequestType, 'service' | 'return'>,
): boolean {
  if (requestType === 'service') return isServiceExcludedLineItem(item);
  return isFreightInvoiceLineItem(item);
}

export const SupportInvoiceProductPicker: React.FC<SupportInvoiceProductPickerProps> = ({
  cacheKey,
  customerId,
  value,
  onChange,
  onNext,
  onMatchedSerial,
  disabled = false,
  invoiceRequired = true,
  requestType,
}) => {
  const [invoice, setInvoice] = useState<SupportInvoicePick | null>(
    value
      ? {
          invoiceId: value.invoiceId,
          invoiceNumber: value.invoiceNumber,
          salesOrderNumber: value.salesOrderNumber,
        }
      : null,
  );
  const [invoiceDetail, setInvoiceDetail] = useState<DealerInvoiceDetail | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState('');

  useEffect(() => {
    if (!invoice) {
      setInvoiceDetail(null);
      setItemsError('');
      return;
    }

    let cancelled = false;
    setLoadingItems(true);
    setItemsError('');

    void fetchDealerInvoiceDetailWithCache(cacheKey, invoice.invoiceId, { customerId })
      .then(detail => {
        if (cancelled) return;
        setInvoiceDetail(detail);
        if (!detail.lineItems.some(item => !isExcludedSupportLineItem(item, requestType))) {
          setItemsError('This invoice has no selectable products.');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setInvoiceDetail(null);
        setItemsError(err instanceof Error ? err.message : 'Could not load invoice items.');
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, customerId, invoice, requestType]);

  useEffect(() => {
    const query = invoice?.matchedSerialQuery?.trim();
    if (!invoiceDetail || !invoice || !query || loadingItems) return;

    const match = findLineItemBySerialQuery(
      invoiceDetail.lineItems,
      query,
      item => isExcludedSupportLineItem(item, requestType),
    );
    if (!match) return;
    if (value?.lineItemId === match.item.id) return;

    onChange(lineItemToDraft(invoice, match.item));
    onMatchedSerial?.(match.serial);
  }, [
    invoice,
    invoiceDetail,
    loadingItems,
    onChange,
    onMatchedSerial,
    requestType,
    value?.lineItemId,
  ]);

  const handleInvoiceChange = (pick: SupportInvoicePick | null) => {
    setInvoice(pick);
    onChange(null);
  };

  const handleProductPick = (item: DealerInvoiceLineItem) => {
    if (!invoice || isExcludedSupportLineItem(item, requestType)) return;
    onChange(lineItemToDraft(invoice, item));
  };

  return (
    <div className="support-wizard__fields">
      <SupportInvoiceAutocomplete
        cacheKey={cacheKey}
        customerId={customerId}
        value={invoice}
        onChange={handleInvoiceChange}
        required={invoiceRequired}
        disabled={disabled}
        id="support-invoice"
        label="Invoice number"
        placeholder="Search invoice, serial number, or MAC ID…"
      />

      {invoice && loadingItems && (
        <FetchingLoader label="Loading invoice…" />
      )}

      {invoiceDetail && !loadingItems && (
        <div className="support-invoice-detail">
          <InvoiceDocumentBody
            invoice={invoiceDetail}
            selectedLineItemId={value?.lineItemId}
            onSelectLineItem={handleProductPick}
            onConfirmLineItem={value?.lineItemId && onNext ? onNext : undefined}
            hideLineItem={
              requestType === 'service' ? isServiceExcludedLineItem : undefined
            }
            hideTotals={requestType === 'service'}
          />
          {itemsError && (
            <p className="support-invoice-field__hint support-invoice-field__hint--error text-sm">
              {itemsError}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
