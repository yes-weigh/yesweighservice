import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Loader2, Package } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { FastRemoteImage } from '../media/FastRemoteImage';
import { applyCatalogMetaToLineItems, enrichInvoiceLineItemsCatalog, fetchCatalogMetaForItemIds } from '../../lib/invoiceLineItemImages';
import {
  fetchDealerInvoiceDetailWithCache,
  fetchDealerInvoicesWithCache,
  findLineItemBySerialQuery,
  formatInvoiceDate,
  isFreightInvoiceLineItem,
  isServiceExcludedLineItem,
  isSupportMainProductLineItem,
  normalizeInvoiceSearchNeedle,
  readCachedDealerInvoiceDetail,
  serialNumbersFromLineItem,
} from '../../lib/invoices';
import {
  invoiceGoodsReceivedAtIso,
  invoiceWithReceivingFields,
  isInvoiceEligibleForProductReplacement,
  productReplacementWindowLabel,
  calendarDateIst,
} from '../../lib/supportReplacementEligibility';
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
  invoiceDate?: string | null;
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
    invoiceDate: invoice.date,
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
    imageUrl: item.imageUrl,
    invoiceDate: invoice.invoiceDate ?? null,
    serialNumbers: serialNumbersFromLineItem(item),
  };
}

function formatSupportQty(qty: number): string {
  if (!Number.isFinite(qty)) return 'Qty —';
  const label = Number.isInteger(qty) ? String(qty) : String(parseFloat(qty.toFixed(3)));
  return `Qty ${label}`;
}

function isExcludedSupportLineItem(
  item: DealerInvoiceLineItem,
  requestType?: Extract<SupportRequestType, 'service' | 'return'>,
): boolean {
  if (!isSupportMainProductLineItem(item)) return true;
  if (requestType === 'service') return isServiceExcludedLineItem(item);
  return isFreightInvoiceLineItem(item);
}

function selectableInvoiceProducts(
  items: DealerInvoiceLineItem[] | undefined,
  requestType?: Extract<SupportRequestType, 'service' | 'return'>,
): DealerInvoiceLineItem[] | null {
  if (!Array.isArray(items)) return null;
  return items.filter(item => !isExcludedSupportLineItem(item, requestType));
}

const SUPPORT_PICKER_PAGE_SIZE = 10;
const SUPPORT_REPLACEMENT_LIST_LIMIT = 80;
const PRODUCT_WARRANTY_LISTING_DAYS = 365;

function supportPickerInvoiceParams(
  page: number,
  q: string,
  customerId: string | undefined,
  replacementMode: boolean,
) {
  return {
    customerId,
    q: q.trim() || undefined,
    page,
    limit: replacementMode ? SUPPORT_REPLACEMENT_LIST_LIMIT : SUPPORT_PICKER_PAGE_SIZE,
    sortField: 'date' as const,
    sortDir: 'desc' as const,
    includeLineItems: true,
    replacementWindow: replacementMode,
  };
}

function invoiceAgeDays(date: string | null | undefined, now = new Date()): number | null {
  const invoiceDay = calendarDateIst(date ?? '');
  const today = calendarDateIst(now);
  if (!invoiceDay || !today) return null;
  const [invoiceYear, invoiceMonth, invoiceDayNum] = invoiceDay.split('-').map(Number);
  const [todayYear, todayMonth, todayDayNum] = today.split('-').map(Number);
  return Math.round(
    (Date.UTC(todayYear, todayMonth - 1, todayDayNum) - Date.UTC(invoiceYear, invoiceMonth - 1, invoiceDayNum))
    / 86_400_000,
  );
}

function isInvoiceWithinWarrantyListing(date: string | null | undefined, now = new Date()): boolean {
  const age = invoiceAgeDays(date, now);
  return age == null || age <= PRODUCT_WARRANTY_LISTING_DAYS;
}

type SupportPickerProductRow = {
  invoice: DealerInvoice;
  item: DealerInvoiceLineItem;
  note?: string | null;
};

function flattenSupportPickerRows(
  invoices: DealerInvoice[],
  detailsById: Record<string, DealerInvoiceDetail>,
  requestType?: Extract<SupportRequestType, 'service' | 'return'>,
): SupportPickerProductRow[] {
  const rows: SupportPickerProductRow[] = [];
  for (const invoice of invoices) {
    let note: string | null = null;
    if (requestType === 'service' && !isInvoiceWithinWarrantyListing(invoice.date)) continue;
    if (requestType === 'return') {
      const receiving = invoiceWithReceivingFields(invoice, detailsById[invoice.id]);
      if (!isInvoiceEligibleForProductReplacement(receiving)) continue;
      note = productReplacementWindowLabel(invoiceGoodsReceivedAtIso(receiving));
    }
    const products = selectableInvoiceProducts(
      invoice.lineItems ?? detailsById[invoice.id]?.lineItems,
      requestType,
    );
    if (!products) continue;
    for (const item of products) {
      rows.push({ invoice, item, note });
    }
  }
  return rows;
}

async function withCatalogMetaOnInvoices(invoices: DealerInvoice[]): Promise<DealerInvoice[]> {
  const ids = invoices.flatMap(invoice => (
    invoice.lineItems ?? []
  ).map(item => item.itemId).filter((id): id is string => Boolean(id)));
  if (!ids.length) return invoices;
  const meta = await fetchCatalogMetaForItemIds(ids);
  return invoices.map(invoice => ({
    ...invoice,
    lineItems: Array.isArray(invoice.lineItems)
      ? applyCatalogMetaToLineItems(invoice.lineItems, meta)
      : invoice.lineItems,
  }));
}

function supportProductLineKey(item: DealerInvoiceLineItem): string {
  return [
    item.itemId || '',
    (item.sku || '').trim().toLowerCase(),
    item.name.trim().toLowerCase(),
  ].join('|');
}

/** Qty > 1 or more than one line of the same product — dealer must attach serial/MAC. */
function hasAmbiguousSupportUnits(
  picked: DealerInvoiceLineItem,
  siblings: DealerInvoiceLineItem[],
): boolean {
  if (picked.quantity > 1) return true;
  const key = supportProductLineKey(picked);
  return siblings.filter(item => supportProductLineKey(item) === key).length > 1;
}

export function SupportProductLineCard({
  invoiceNumber,
  invoiceDate,
  name,
  sku,
  quantity,
  imageUrl,
  serials = [],
  note,
  selected = false,
  staticCard = false,
  showNext = false,
  onNext,
  onClick,
}: {
  invoiceNumber: string;
  invoiceDate?: string | null;
  name: string;
  sku?: string | null;
  quantity: number;
  imageUrl?: string | null;
  serials?: string[];
  note?: string | null;
  selected?: boolean;
  staticCard?: boolean;
  showNext?: boolean;
  onNext?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={[
        'support-product-line',
        selected ? 'is-selected' : '',
        staticCard ? 'is-static' : '',
      ].filter(Boolean).join(' ')}
      role={staticCard ? undefined : 'button'}
      tabIndex={staticCard ? undefined : 0}
      onClick={staticCard ? undefined : onClick}
      onKeyDown={staticCard ? undefined : e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="support-product-line__doc">
        <strong>{invoiceNumber}</strong>
        <span className="text-muted text-sm">{formatInvoiceDate(invoiceDate)}</span>
      </div>
      <div className="support-product-line__row">
        <span className="support-product-line__thumb">
          {imageUrl ? (
            <FastRemoteImage
              src={imageUrl}
              alt=""
              className="support-product-line__image"
              size="thumb"
            />
          ) : (
            <span className="support-product-line__placeholder" aria-hidden>
              <Package size={22} />
            </span>
          )}
        </span>
        <span className="support-product-line__body">
          <strong className="support-product-line__name">{name}</strong>
          <span className="support-product-line__sku">{sku ? `SKU ${sku}` : 'SKU —'}</span>
          <span className="support-product-line__qty">{formatSupportQty(quantity)}</span>
          {note ? (
            <span className="support-product-line__note">{note}</span>
          ) : null}
          {serials.length > 0 && (
            <span className="support-product-line__serials">
              Serial / MAC {serials.join(' · ')}
            </span>
          )}
          {quantity > 1 && serials.length === 0 && (
            <span className="support-product-line__hint">
              Add serial / MAC ID next — this invoice has more than one of this item.
            </span>
          )}
        </span>
        {staticCard ? null : showNext && onNext ? (
          <button
            type="button"
            className="btn btn-primary btn-sm support-product-line__next"
            onClick={e => {
              e.stopPropagation();
              onNext();
            }}
          >
            Next
            <ArrowRight size={16} />
          </button>
        ) : (
          <ChevronRight size={20} className="support-product-line__chevron" aria-hidden />
        )}
      </div>
    </div>
  );
}

interface InvoiceAutocompleteProps {
  cacheKey: string;
  customerId?: string;
  value: SupportInvoicePick | null;
  selectedLineItemId?: string | null;
  onChange: (
    pick: SupportInvoicePick | null,
    product?: DealerInvoiceLineItem | null,
    siblings?: DealerInvoiceLineItem[],
  ) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  placeholder?: string;
  requestType?: Extract<SupportRequestType, 'service' | 'return'>;
}

export const SupportInvoiceAutocomplete: React.FC<InvoiceAutocompleteProps> = ({
  cacheKey,
  customerId,
  value,
  selectedLineItemId,
  onChange,
  required = false,
  disabled = false,
  id = 'support-invoice',
  label = 'Invoice number',
  placeholder = 'Start typing invoice number…',
  requestType,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const fillingRef = useRef(false);
  const [query, setQuery] = useState(value?.invoiceNumber ?? '');
  const replacementMode = requestType === 'return';
  const warrantyListingMode = requestType === 'service';
  const screenList = replacementMode || warrantyListingMode;
  const [open, setOpen] = useState(screenList);
  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [detailsById, setDetailsById] = useState<Record<string, DealerInvoiceDetail>>({});
  const [page, setPage] = useState(1);
  const [loadedInvoicePage, setLoadedInvoicePage] = useState(0);
  const [invoiceTotalPages, setInvoiceTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadError, setLoadError] = useState('');
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    setQuery(value?.matchedSerialQuery ?? value?.invoiceNumber ?? '');
  }, [value?.invoiceId, value?.invoiceNumber, value?.matchedSerialQuery]);

  useEffect(() => {
    if (!open || disabled) return;

    let cancelled = false;
    setPage(1);
    setInvoices([]);
    setLoadedInvoicePage(0);
    setInvoiceTotalPages(1);
    setLoadError('');
    setLoading(true);

    const load = async () => {
      try {
        const res = await fetchDealerInvoicesWithCache(
          cacheKey,
          supportPickerInvoiceParams(1, debouncedQuery, customerId, replacementMode),
        );
        const next = await withCatalogMetaOnInvoices(res.data);
        if (!cancelled) {
          setInvoices(next);
          setLoadedInvoicePage(1);
          setInvoiceTotalPages(Math.max(1, res.pagination?.totalPages ?? 1));
        }
      } catch (err) {
        if (!cancelled) {
          setInvoices([]);
          setLoadError(err instanceof Error ? err.message : 'Could not load invoices.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, customerId, debouncedQuery, disabled, open, replacementMode]);

  useEffect(() => {
    if (!open || disabled || invoices.length === 0) return;

    const missing = invoices.filter(invoice => (
      (!Array.isArray(invoice.lineItems) || invoice.lineItems.length === 0)
      && !detailsById[invoice.id]
    ));
    if (!missing.length) return;

    let cancelled = false;

    const cachedMissing = missing.filter(invoice => readCachedDealerInvoiceDetail(cacheKey, invoice.id));
    const toFetch = missing.filter(invoice => !readCachedDealerInvoiceDetail(cacheKey, invoice.id));

    setLoadingDetails(true);
    void Promise.all([
      ...cachedMissing.map(async invoice => {
        const cached = readCachedDealerInvoiceDetail(cacheKey, invoice.id);
        if (!cached) return [invoice.id, null] as const;
        const lineItems = await enrichInvoiceLineItemsCatalog(cached.lineItems);
        return [invoice.id, { ...cached, lineItems }] as const;
      }),
      ...toFetch.map(async invoice => {
        try {
          const detail = await fetchDealerInvoiceDetailWithCache(cacheKey, invoice.id, { customerId });
          const lineItems = await enrichInvoiceLineItemsCatalog(detail.lineItems);
          return [invoice.id, { ...detail, lineItems }] as const;
        } catch {
          return [invoice.id, null] as const;
        }
      }),
    ]).then(rows => {
      if (cancelled) return;
      setDetailsById(prev => {
        const next = { ...prev };
        for (const [id, detail] of rows) {
          if (detail) next[id] = detail;
        }
        return next;
      });
    }).finally(() => {
      if (!cancelled) setLoadingDetails(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, customerId, detailsById, disabled, open, invoices]);

  const pendingDetails = invoices.some(
    invoice => (
      (!Array.isArray(invoice.lineItems) || invoice.lineItems.length === 0)
      && !detailsById[invoice.id]
    ),
  );
  const maxInvoicePages = invoiceTotalPages;
  const pastWarrantyWindow = warrantyListingMode
    && invoices.length > 0
    && !isInvoiceWithinWarrantyListing(invoices[invoices.length - 1]?.date);
  const warrantyOverSearch = warrantyListingMode
    && Boolean(debouncedQuery.trim())
    && invoices.length > 0
    && invoices.every(invoice => !isInvoiceWithinWarrantyListing(invoice.date));

  const productRows = useMemo(
    () => {
      const rows = flattenSupportPickerRows(
        invoices,
        detailsById,
        requestType,
      );
      if (requestType !== 'return') return rows;
      return [...rows].sort((a, b) => {
        const left = invoiceGoodsReceivedAtIso(a.invoice) ?? a.invoice.date ?? '';
        const right = invoiceGoodsReceivedAtIso(b.invoice) ?? b.invoice.date ?? '';
        return String(right).localeCompare(String(left));
      });
    },
    [detailsById, invoices, requestType],
  );

  useEffect(() => {
    if (replacementMode) return;
    if (!open || disabled || loading || pendingDetails) return;
    const needed = page * SUPPORT_PICKER_PAGE_SIZE;
    if (productRows.length >= needed) return;
    if (loadedInvoicePage >= maxInvoicePages) return;
    if (pastWarrantyWindow) return;
    if (fillingRef.current) return;

    let cancelled = false;
    fillingRef.current = true;
    setLoadingMore(true);

    const fill = async () => {
      try {
        const nextInvoicePage = loadedInvoicePage + 1;
        const res = await fetchDealerInvoicesWithCache(
          cacheKey,
          supportPickerInvoiceParams(
            nextInvoicePage,
            debouncedQuery,
            customerId,
            replacementMode,
          ),
        );
        const extra = await withCatalogMetaOnInvoices(res.data);
        if (cancelled) return;
        setInvoices(prev => {
          const seen = new Set(prev.map(invoice => invoice.id));
          return [...prev, ...extra.filter(invoice => !seen.has(invoice.id))];
        });
        setLoadedInvoicePage(nextInvoicePage);
        setInvoiceTotalPages(Math.max(1, res.pagination?.totalPages ?? 1));
      } catch {
        if (!cancelled) setInvoiceTotalPages(loadedInvoicePage);
      } finally {
        fillingRef.current = false;
        if (!cancelled) setLoadingMore(false);
      }
    };

    void fill();
    return () => {
      cancelled = true;
    };
  }, [
    cacheKey,
    customerId,
    debouncedQuery,
    disabled,
    loadedInvoicePage,
    loading,
    maxInvoicePages,
    open,
    page,
    pendingDetails,
    pastWarrantyWindow,
    productRows.length,
    replacementMode,
  ]);

  useEffect(() => {
    if (screenList) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [screenList]);

  const closeWithPick = (
    invoice: DealerInvoice,
    product?: DealerInvoiceLineItem | null,
    siblings?: DealerInvoiceLineItem[],
  ) => {
    const pick = invoiceToPick(invoice);
    const search = debouncedQuery.trim();
    const matchedSerialQuery = invoicePickLooksLikeSerialSearch(pick, search) ? search : null;
    setQuery(matchedSerialQuery ?? pick.invoiceNumber);
    onChange({ ...pick, matchedSerialQuery }, product ?? null, siblings);
    if (!screenList) setOpen(false);
  };

  const pageRows = replacementMode
    ? productRows
    : productRows.slice(
      (page - 1) * SUPPORT_PICKER_PAGE_SIZE,
      page * SUPPORT_PICKER_PAGE_SIZE,
    );
  const hasNextPage = !replacementMode && (
    productRows.length > page * SUPPORT_PICKER_PAGE_SIZE
    || (!pastWarrantyWindow && loadedInvoicePage < maxInvoicePages)
    || pendingDetails
    || loadingMore
  );
  const waitingForProducts = loading || loadingDetails || (!replacementMode && (loadingMore || pendingDetails));
  const loadedProductPages = Math.max(1, Math.ceil(productRows.length / SUPPORT_PICKER_PAGE_SIZE) || 1);
  const productsFullyLoaded = replacementMode
    ? !loading
    : !loading
      && !pendingDetails
      && !loadingMore
      && (pastWarrantyWindow || loadedInvoicePage >= maxInvoicePages);
  const minProductPages = Math.max(
    page,
    loadedProductPages,
    hasNextPage ? page + 1 : 1,
  );
  const pageLabel = productsFullyLoaded
    ? `Page ${page} of ${loadedProductPages}`
    : `Page ${page} of ${minProductPages}+`;
  const replacementEmptyCopy = debouncedQuery.trim()
    ? 'No matching products are still inside the 7-day replacement window from the receiving date.'
    : 'Only new goods received in the last 7 days can be replaced here. The window starts on courier delivery or pickup, not the invoice date.';
  const emptyCopy = warrantyOverSearch
    ? 'Warranty over.'
    : replacementMode
      ? replacementEmptyCopy
      : warrantyListingMode
        ? (debouncedQuery.trim()
          ? 'No matching products invoiced in the last 365 days.'
          : 'No products invoiced in the last 365 days.')
        : 'No main products on these invoices';

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    menuRef.current?.scrollTo({ top: 0 });
  };

  const pickProduct = (invoice: DealerInvoice, item: DealerInvoiceLineItem) => {
    closeWithPick(
      invoice,
      item,
      selectableInvoiceProducts(
        invoice.lineItems ?? detailsById[invoice.id]?.lineItems,
        requestType,
      ) ?? [item],
    );
  };

  const handleInputChange = (next: string) => {
    setQuery(next);
    setOpen(true);
    if (value && next.trim() !== (value.matchedSerialQuery ?? value.invoiceNumber)) {
      onChange(null);
    }
  };

  const hintCopy = replacementMode
    ? 'Only products received in the last 7 days are listed. The clock starts on delivery or pickup, not the invoice date.'
    : warrantyListingMode
      ? 'Products invoiced in the last 365 days are listed.'
      : 'Pick an invoice or product from the suggestions — free text is not accepted.';

  return (
    <div
      className={[
        'form-group support-invoice-field',
        screenList ? 'support-invoice-field--screen-list' : '',
        !label.trim() ? 'support-invoice-field--no-label' : '',
      ].filter(Boolean).join(' ')}
      ref={rootRef}
    >
      {label.trim() ? (
        <label htmlFor={id}>
          {label}
          {required && <span className="form-label__required" aria-hidden> *</span>}
        </label>
      ) : (
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
      )}
      <div
        className={[
          'support-invoice-field__input-wrap',
          loading ? 'is-busy' : '',
        ].filter(Boolean).join(' ')}
      >
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
      {required && !value && (
        <p
          className={[
            'support-invoice-field__hint text-sm',
            warrantyListingMode || replacementMode
              ? 'support-invoice-field__hint--accent'
              : 'text-muted',
          ].join(' ')}
        >
          {hintCopy}
        </p>
      )}
      {open && !disabled && (
        <ul
          id={`${id}-listbox`}
          ref={menuRef}
          className="support-invoice-field__menu"
          role="listbox"
        >
          {invoices.length === 0 && !loading ? (
            <li className="support-invoice-field__empty text-muted text-sm">
              {loadError
                ? loadError
                : screenList
                  ? emptyCopy
                  : (debouncedQuery.trim() ? 'No matching invoices' : 'Type to search your invoices')}
            </li>
          ) : pageRows.length === 0 && !waitingForProducts ? (
            <li className="support-invoice-field__empty text-muted text-sm">
              {loadError || emptyCopy}
            </li>
          ) : (
            <>
              {pageRows.map(({ invoice, item, note }) => {
                const invoiceSelected = value?.invoiceId === invoice.id;
                const invoiceLabel = invoice.invoiceNumber || invoice.id;
                return (
                  <li
                    key={`${invoice.id}:${item.id}`}
                    className="support-invoice-field__group"
                    role="presentation"
                  >
                    <SupportProductLineCard
                      invoiceNumber={invoiceLabel}
                      invoiceDate={invoice.date}
                      name={item.name}
                      sku={item.sku}
                      quantity={item.quantity}
                      imageUrl={item.imageUrl}
                      serials={serialNumbersFromLineItem(item)}
                      note={note}
                      selected={invoiceSelected && selectedLineItemId === item.id}
                      onClick={() => pickProduct(invoice, item)}
                    />
                  </li>
                );
              })}
              {waitingForProducts && pageRows.length === 0 && (
                <li className="support-invoice-field__empty text-muted text-sm">
                  {replacementMode ? 'Loading products received in the last 7 days…' : 'Loading products…'}
                </li>
              )}
              {!replacementMode && (page > 1 || (hasNextPage && pageRows.length > 0)) && (
                <li className="support-invoice-field__pager" role="presentation">
                  {page > 1 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm support-invoice-field__pager-btn"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => goToPage(page - 1)}
                    >
                      Prev
                    </button>
                  )}
                  <span className="support-invoice-field__page-label text-sm">
                    {pageLabel}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm support-invoice-field__pager-btn"
                    disabled={!hasNextPage || loadingMore}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => goToPage(page + 1)}
                  >
                    {loadingMore ? 'Loading…' : 'Next'}
                    {!loadingMore && <ArrowRight size={16} />}
                  </button>
                </li>
              )}
            </>
          )}
        </ul>
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
          invoiceDate: value.invoiceDate,
        }
      : null,
  );
  const [invoiceDetail, setInvoiceDetail] = useState<DealerInvoiceDetail | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [replacementNote, setReplacementNote] = useState<string | null>(null);
  const replacementMode = requestType === 'return';
  const warrantyListingMode = requestType === 'service';

  useEffect(() => {
    if (!invoice) {
      setInvoiceDetail(null);
      setItemsError('');
      setReplacementNote(null);
      return;
    }

    let cancelled = false;
    setLoadingItems(true);
    setItemsError('');
    setReplacementNote(null);

    void fetchDealerInvoiceDetailWithCache(cacheKey, invoice.invoiceId, { customerId })
      .then(async detail => {
        const lineItems = await enrichInvoiceLineItemsCatalog(detail.lineItems);
        if (cancelled) return;
        const next = { ...detail, lineItems };
        if (replacementMode) {
          const receivedAt = invoiceGoodsReceivedAtIso(next);
          if (!isInvoiceEligibleForProductReplacement(next)) {
            setInvoiceDetail(null);
            setReplacementNote(null);
            setItemsError(
              'This invoice is outside the 7-day replacement window. The window starts on the receiving date (courier delivery or pickup), not the invoice date.',
            );
            return;
          }
          setReplacementNote(productReplacementWindowLabel(receivedAt));
        }
        setInvoiceDetail(next);
        if (!next.lineItems.some(item => !isExcludedSupportLineItem(item, requestType))) {
          setItemsError('This invoice has no main products.');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setInvoiceDetail(null);
        setReplacementNote(null);
        setItemsError(err instanceof Error ? err.message : 'Could not load invoice items.');
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, customerId, invoice, replacementMode, requestType]);

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
    const peers = selectableInvoiceProducts(invoiceDetail.lineItems, requestType) ?? [match.item];
    if (!hasAmbiguousSupportUnits(match.item, peers)) {
      onNext?.();
    }
  }, [
    invoice,
    invoiceDetail,
    loadingItems,
    onChange,
    onMatchedSerial,
    onNext,
    requestType,
    value?.lineItemId,
  ]);

  const handleInvoiceChange = (
    pick: SupportInvoicePick | null,
    product?: DealerInvoiceLineItem | null,
    siblings?: DealerInvoiceLineItem[],
  ) => {
    setInvoice(pick);
    if (pick && product && !isExcludedSupportLineItem(product, requestType)) {
      onChange(lineItemToDraft(pick, product));
      const peers = siblings?.length ? siblings : [product];
      if (!hasAmbiguousSupportUnits(product, peers)) {
        onNext?.();
      }
      return;
    }
    onChange(null);
  };

  const handleProductPick = (item: DealerInvoiceLineItem) => {
    if (!invoice || isExcludedSupportLineItem(item, requestType)) return;
    onChange(lineItemToDraft(invoice, item));
    const peers = selectableInvoiceProducts(invoiceDetail?.lineItems, requestType) ?? [item];
    if (!hasAmbiguousSupportUnits(item, peers)) {
      onNext?.();
    }
  };

  const visibleProducts = selectableInvoiceProducts(invoiceDetail?.lineItems, requestType) ?? [];

  return (
    <div className="support-wizard__fields">
      <SupportInvoiceAutocomplete
        cacheKey={cacheKey}
        customerId={customerId}
        value={invoice}
        selectedLineItemId={value?.lineItemId}
        onChange={handleInvoiceChange}
        required={invoiceRequired}
        disabled={disabled}
        id="support-invoice"
        label={
          replacementMode
            ? 'Eligible product'
            : warrantyListingMode
              ? ''
              : 'Invoice number'
        }
        placeholder={
          replacementMode
            ? 'Search a product received in the last 7 days…'
            : 'Search by serial number or invoice number'
        }
        requestType={requestType}
      />

      {invoice && loadingItems && !warrantyListingMode && !replacementMode && (
        <FetchingLoader label="Loading invoice…" />
      )}

      {itemsError && (warrantyListingMode || replacementMode) && (
        <p className="support-invoice-field__hint support-invoice-field__hint--error text-sm">
          {itemsError}
        </p>
      )}

      {invoiceDetail && !loadingItems && !warrantyListingMode && !replacementMode && (
        <div className="support-invoice-detail">
          {visibleProducts.map(item => {
            const selected = value?.lineItemId === item.id;
            const ambiguous = hasAmbiguousSupportUnits(item, visibleProducts);
            return (
              <SupportProductLineCard
                key={item.id}
                invoiceNumber={invoiceDetail.invoiceNumber || invoice?.invoiceNumber || ''}
                invoiceDate={invoiceDetail.date}
                name={item.name}
                sku={item.sku}
                quantity={item.quantity}
                imageUrl={item.imageUrl}
                serials={serialNumbersFromLineItem(item)}
                note={replacementNote}
                selected={selected}
                showNext={Boolean(selected && onNext && ambiguous)}
                onNext={onNext}
                onClick={() => handleProductPick(item)}
              />
            );
          })}
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
