import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Download, ExternalLink } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  downloadPurchaseOrderDocument,
} from '../../lib/admin-purchase-orders';
import {
  invoiceDocumentToBlob,
  invoiceErrorMessage,
  openInvoiceDocument,
  saveInvoiceDocumentFile,
} from '../../lib/invoices';
import { base64ToUint8Array, prefersNativePdfViewer } from '../../lib/pdfViewer';
import type { InvoiceDocumentDownload } from '../../types/invoices';
import type { AdminPurchaseOrderDetailOutletContext } from './adminPurchaseOrderDetailContext';

const InvoicePdfCanvas = lazy(() =>
  import('../../components/invoices/InvoicePdfCanvas').then(m => ({ default: m.InvoicePdfCanvas })),
);

export const AdminPurchaseOrderPdfViewerPage: React.FC = () => {
  const { purchaseOrder, purchaseOrderId } = useOutletContext<AdminPurchaseOrderDetailOutletContext>();
  const useNativeViewer = useMemo(() => prefersNativePdfViewer(), []);

  const [document, setDocument] = useState<InvoiceDocumentDownload | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!purchaseOrderId) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError('');
    setDocument(null);
    setPdfUrl(null);
    setPdfBytes(null);

    void downloadPurchaseOrderDocument(purchaseOrderId)
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
  }, [purchaseOrderId, useNativeViewer]);

  if (!purchaseOrder) return null;

  return (
    <section className="invoice-detail-pdf invoice-detail-pdf--fullscreen panel glass">
      {!useNativeViewer && document && !loading && !error && (
        <div className="invoice-detail-pdf__toolbar">
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
        </div>
      )}

      {loading ? (
        <FetchingLoader label="Loading purchase order PDF…" />
      ) : error ? (
        <div className="invoice-detail-pdf__error">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      ) : useNativeViewer && pdfUrl ? (
        <iframe
          title={`Purchase order ${purchaseOrder.purchaseOrderNumber}`}
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
