import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { invoiceErrorMessage, loadInvoiceDocumentObjectUrl } from '../../lib/invoices';
import type { InvoiceDetailOutletContext } from './invoiceDetailContext';

export const InvoicePdfViewerPage: React.FC = () => {
  const { invoice, invoiceId } = useOutletContext<InvoiceDetailOutletContext>();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState('');

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    setPdfLoading(true);
    setPdfError('');

    void loadInvoiceDocumentObjectUrl(invoiceId)
      .then(url => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPdfUrl(url);
      })
      .catch(err => {
        if (!cancelled) {
          setPdfError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoiceId]);

  if (!invoice) return null;

  return (
    <section className="invoice-detail-pdf invoice-detail-pdf--fullscreen panel glass">
      {pdfLoading ? (
        <FetchingLoader label="Loading invoice PDF…" />
      ) : pdfError ? (
        <div className="invoice-detail-pdf__error">
          <AlertCircle size={20} />
          <p>{pdfError}</p>
        </div>
      ) : pdfUrl ? (
        <iframe
          title={`Invoice ${invoice.invoiceNumber}`}
          src={pdfUrl}
          className="invoice-detail-pdf__frame"
        />
      ) : null}
    </section>
  );
};
