import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Download, ExternalLink, Loader2 } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  downloadSalesOrderDocument,
} from '../../lib/admin-sales-orders';
import { shareDocumentPdfViaWhatsApp } from '../../lib/documentWhatsAppShare';
import {
  invoiceDocumentToBlob,
  invoiceErrorMessage,
  openInvoiceDocument,
  saveInvoiceDocumentFile,
} from '../../lib/invoices';
import { base64ToUint8Array, prefersNativePdfViewer } from '../../lib/pdfViewer';
import type { InvoiceDocumentDownload } from '../../types/invoices';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

const InvoicePdfCanvas = lazy(() =>
  import('../../components/invoices/InvoicePdfCanvas').then(m => ({ default: m.InvoicePdfCanvas })),
);

function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export const AdminSalesOrderPdfViewerPage: React.FC = () => {
  const { salesOrder, salesOrderId } = useOutletContext<AdminSalesOrderDetailOutletContext>();
  const useNativeViewer = useMemo(() => prefersNativePdfViewer(), []);

  const [document, setDocument] = useState<InvoiceDocumentDownload | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    if (!salesOrderId) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError('');
    setShareError('');
    setDocument(null);
    setPdfUrl(null);
    setPdfBytes(null);

    void downloadSalesOrderDocument(salesOrderId)
      .then(doc => {
        if (cancelled) return;

        setDocument(doc);
        const bytes = base64ToUint8Array(doc.contentBase64);

        if (useNativeViewer) {
          const blob = invoiceDocumentToBlob(doc);
          objectUrl = URL.createObjectURL(blob);
          setPdfUrl(objectUrl);
        } else {
          setPdfBytes(bytes);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [salesOrderId, useNativeViewer]);

  const shareOnWhatsApp = async () => {
    if (!document || sharing) return;
    setSharing(true);
    setShareError('');
    const soLabel = salesOrder?.salesOrderNumber?.trim() || salesOrderId;
    try {
      await shareDocumentPdfViaWhatsApp(document, {
        title: soLabel,
        text: `Sales order ${soLabel}`,
      });
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Could not share PDF on WhatsApp.');
    } finally {
      setSharing(false);
    }
  };

  if (!salesOrder) return null;

  return (
    <section className="invoice-detail-pdf invoice-detail-pdf--fullscreen panel glass">
      {document && !loading && !error ? (
        <div className="invoice-detail-pdf__toolbar">
          {!useNativeViewer ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm invoice-detail-pdf__toolbar-btn"
                onClick={() => openInvoiceDocument(document)}
              >
                <ExternalLink size={16} aria-hidden />
                Open PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm invoice-detail-pdf__toolbar-btn"
                onClick={() => saveInvoiceDocumentFile(document)}
              >
                <Download size={16} aria-hidden />
                Download
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm invoice-detail-pdf__toolbar-btn invoice-detail-pdf__toolbar-btn--whatsapp"
            onClick={() => void shareOnWhatsApp()}
            disabled={sharing}
            aria-label="Share sales order PDF on WhatsApp"
          >
            {sharing ? <Loader2 size={16} className="spin-icon" aria-hidden /> : <WhatsAppIcon size={16} />}
            WhatsApp
          </button>
        </div>
      ) : null}

      {shareError ? (
        <div className="invoice-detail-pdf__error invoice-detail-pdf__error--inline" role="alert">
          <AlertCircle size={18} />
          <p>{shareError}</p>
        </div>
      ) : null}

      {loading ? (
        <FetchingLoader label="Loading Sales order PDF…" />
      ) : error ? (
        <div className="invoice-detail-pdf__error">
          <AlertCircle size={20} />
          <p>{error}</p>
          <p className="invoice-detail-pdf__error-hint text-muted text-sm">
            Use the back button for the order details. This screen is only the Zoho PDF.
          </p>
        </div>
      ) : useNativeViewer && pdfUrl ? (
        <iframe
          title={`Sales order ${salesOrder.salesOrderNumber}`}
          src={pdfUrl}
          className="invoice-detail-pdf__frame"
        />
      ) : pdfBytes ? (
        <Suspense fallback={<FetchingLoader label="Preparing PDF viewer…" />}>
          <InvoicePdfCanvas data={pdfBytes} />
        </Suspense>
      ) : null}
    </section>
  );
};
