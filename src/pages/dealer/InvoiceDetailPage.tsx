import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Download, FileText, Headphones, Package } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';
import {
  downloadDealerInvoiceDocument,
  fetchDealerInvoiceDetailWithCache,
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceStatusLabel,
  readCachedDealerInvoiceDetail,
  saveInvoiceDocumentFile,
} from '../../lib/invoices';
import { supportBasePath } from '../../lib/dealerSupport';
import type { DealerInvoiceDetail, DealerInvoiceLineItem, InvoiceDocumentType } from '../../types/invoices';
import type { SupportProductDraft } from '../../types/dealer-support';

function statusClass(status: string): string {
  const key = status.toLowerCase();
  if (key === 'paid') return 'invoices-status--paid';
  if (key === 'overdue' || key === 'unpaid') return 'invoices-status--due';
  if (key === 'partially_paid') return 'invoices-status--partial';
  if (key === 'void') return 'invoices-status--void';
  return 'invoices-status--default';
}

export const InvoiceDetailPage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = user ? homePathForRole(user.role) : '/dealer';
  const invoicesPath = `${base}/invoices`;

  const [invoice, setInvoice] = useState<DealerInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<InvoiceDocumentType | null>(null);

  const handleBack = useCallback(() => navigate(invoicesPath), [navigate, invoicesPath]);

  useCatalogPageHeader({
    title: invoice?.invoiceNumber ?? 'Invoice',
    showBack: true,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    const uid = user?.uid;
    let usedCache = false;

    if (uid) {
      const cached = readCachedDealerInvoiceDetail(uid, invoiceId);
      if (cached) {
        setInvoice(cached);
        setLoading(false);
        usedCache = true;
      } else {
        setLoading(true);
      }
    } else {
      setLoading(true);
    }

    if (!usedCache) setError('');

    fetchDealerInvoiceDetailWithCache(uid, invoiceId)
      .then(data => {
        if (!cancelled) {
          setInvoice(data);
          setError('');
        }
      })
      .catch(err => {
        if (cancelled) return;
        if (!usedCache) {
          setInvoice(null);
          setError(invoiceErrorMessage(err));
        } else {
          setError('Could not refresh. Showing saved invoice.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [invoiceId, user?.uid]);

  const handleDownload = async (documentType: InvoiceDocumentType) => {
    if (!invoiceId || downloading) return;
    setDownloading(documentType);
    setError('');
    try {
      const doc = await downloadDealerInvoiceDocument(invoiceId, documentType);
      saveInvoiceDocumentFile(doc);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  const handleServiceRequest = (item: DealerInvoiceLineItem) => {
    if (!invoice || !invoiceId || !user) return;
    const draft: SupportProductDraft = {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      salesOrderNumber: invoice.salesOrderNumber,
      lineItemId: item.id,
      itemId: item.itemId,
      itemName: item.name,
      itemSku: item.sku,
      quantity: item.quantity,
    };
    navigate(supportBasePath(user.role), { state: { draft, intent: 'service' as const } });
  };

  if (!invoiceId) return null;

  return (
    <div className="page-content fade-in invoice-detail-page">
      {error && (
        <div className="products-inline-error panel glass invoice-detail-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && !invoice ? (
        <FetchingLoader label="Loading invoice…" />
      ) : !invoice ? (
        <div className="invoices-empty panel glass">
          <FileText size={36} aria-hidden />
          <h2>Invoice not found</h2>
          <p className="text-muted text-sm">This invoice may have been removed or you do not have access.</p>
        </div>
      ) : (
        <>
          <section className="invoice-detail-hero panel glass">
            <div className="invoice-detail-hero__head">
              <div>
                <h2 className="invoice-detail-hero__title">{invoice.invoiceNumber || '—'}</h2>
                <p className="invoice-detail-hero__meta">
                  {formatInvoiceDate(invoice.date)}
                  {invoice.salesOrderNumber && (
                    <span className="invoice-detail-hero__so">{invoice.salesOrderNumber}</span>
                  )}
                </p>
              </div>
              <span className={`invoices-status ${statusClass(invoice.status)}`}>
                {invoiceStatusLabel(invoice.status)}
              </span>
            </div>

            <div className="invoice-detail-hero__totals">
              <div>
                <span className="invoice-detail-hero__label">Total</span>
                <strong>{formatCurrency(invoice.total)}</strong>
              </div>
              {invoice.balance > 0 && (
                <div>
                  <span className="invoice-detail-hero__label">Balance</span>
                  <strong className="invoice-detail-hero__balance">{formatCurrency(invoice.balance)}</strong>
                </div>
              )}
            </div>

            <div className="invoice-detail-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={downloading !== null}
                onClick={() => void handleDownload('invoice')}
              >
                <Download size={16} />
                {downloading === 'invoice' ? 'Downloading…' : 'Download invoice'}
              </button>
              {invoice.salesOrderId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={downloading !== null}
                  onClick={() => void handleDownload('salesorder')}
                >
                  <Download size={16} />
                  {downloading === 'salesorder' ? 'Downloading…' : 'Download SO'}
                </button>
              )}
            </div>
          </section>

          <section className="invoice-detail-items panel glass">
            <h3 className="invoice-detail-items__title">
              Items{invoice.lineItems.length ? ` (${invoice.lineItems.length})` : ''}
            </h3>
            {invoice.lineItems.length ? (
              <ul className="invoice-detail-item-list">
                {invoice.lineItems.map(item => (
                  <li key={item.id} className="invoice-detail-item">
                    <div className="invoice-detail-item__image-wrap">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className="invoice-detail-item__image" />
                      ) : (
                        <span className="invoice-detail-item__placeholder" aria-hidden>
                          <Package size={22} />
                        </span>
                      )}
                    </div>
                    <div className="invoice-detail-item__body">
                      <strong className="invoice-detail-item__name">{item.name}</strong>
                      {item.sku && <span className="invoice-detail-item__sku">{item.sku}</span>}
                      {item.description && (
                        <p className="invoice-detail-item__desc">{item.description}</p>
                      )}
                      <div className="invoice-detail-item__pricing">
                        <span>{formatCurrency(item.rate)} × {item.quantity}</span>
                        <strong>{formatCurrency(item.total)}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="invoice-detail-item__service"
                      aria-label={`Request service for ${item.name}`}
                      onClick={() => handleServiceRequest(item)}
                    >
                      <Headphones size={18} aria-hidden />
                      <span>Service</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="invoice-detail-items__empty text-muted text-sm">No line items on this invoice.</p>
            )}

            {invoice.lineItems.length > 0 && (
              <div className="invoice-detail-summary">
                <div className="invoice-detail-summary__row">
                  <span>Sub Total</span>
                  <span>{formatCurrency(invoice.subtotal)}</span>
                </div>
                {invoice.taxTotal > 0 && (
                  <div className="invoice-detail-summary__row">
                    <span>Tax</span>
                    <span>{formatCurrency(invoice.taxTotal)}</span>
                  </div>
                )}
                <div className="invoice-detail-summary__row invoice-detail-summary__row--total">
                  <span>Grand Total</span>
                  <strong>{formatCurrency(invoice.total)}</strong>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
