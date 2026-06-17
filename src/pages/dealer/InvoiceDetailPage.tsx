import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Download, FileText, Package } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';
import {
  downloadDealerInvoiceDocument,
  fetchDealerInvoiceDetail,
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceStatusLabel,
  saveInvoiceDocumentFile,
} from '../../lib/invoices';
import type { DealerInvoiceDetail, InvoiceDocumentType } from '../../types/invoices';

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
    setLoading(true);
    setError('');

    fetchDealerInvoiceDetail(invoiceId)
      .then(data => {
        if (!cancelled) setInvoice(data);
      })
      .catch(err => {
        if (!cancelled) {
          setInvoice(null);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

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

  if (!invoiceId) return null;

  return (
    <div className="page-content fade-in invoice-detail-page">
      {error && (
        <div className="products-inline-error panel glass invoice-detail-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
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
            <h3 className="invoice-detail-items__title">Items</h3>
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
                  </li>
                ))}
              </ul>
            ) : (
              <p className="invoice-detail-items__empty text-muted text-sm">No line items on this invoice.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
};
