import { Capacitor } from '@capacitor/core';
import { WhatsAppShare } from 'whatsapp-share';
import type { InvoiceDocumentDownload } from '../types/invoices';
import { invoiceDocumentToBlob, saveInvoiceDocumentFile } from './invoices';
import { openWhatsAppWithText } from './whatsappShareCard';

function safePdfFileName(filename: string | null | undefined, fallback: string): string {
  const raw = String(filename ?? '').trim() || fallback;
  const cleaned = raw.replace(/[^\w.\-]+/g, '_').slice(0, 80) || fallback;
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

/**
 * System share sheet for a Zoho PDF (invoice / sales order).
 * Native APK and supporting browsers attach the file; otherwise the PDF downloads.
 */
export async function shareDocumentPdf(
  doc: InvoiceDocumentDownload,
  options?: { title?: string; text?: string },
): Promise<void> {
  const fileName = safePdfFileName(doc.filename, 'document.pdf');
  const mimeType = String(doc.mimeType || 'application/pdf').trim() || 'application/pdf';
  const title = String(options?.title ?? fileName).trim() || fileName;
  const text = String(options?.text ?? title).trim() || title;

  if (Capacitor.isNativePlatform()) {
    await WhatsAppShare.shareImage({
      dataBase64: doc.contentBase64,
      fileName,
      mimeType,
    });
    return;
  }

  const blob = invoiceDocumentToBlob(doc);
  const file = new File([blob], fileName, { type: mimeType });
  const shareData: ShareData = {
    files: [file],
    title,
    text,
  };

  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  saveInvoiceDocumentFile(doc);
}

/**
 * Share a Zoho PDF (sales order / invoice) via WhatsApp or the system share sheet.
 * Native APK uses the share sheet (pick WhatsApp → any contact).
 * Mobile browsers use Web Share with the PDF file when supported.
 * Fallback downloads the PDF and opens WhatsApp with a text caption.
 */
export async function shareDocumentPdfViaWhatsApp(
  doc: InvoiceDocumentDownload,
  options?: { title?: string; text?: string },
): Promise<void> {
  const fileName = safePdfFileName(doc.filename, 'document.pdf');
  const mimeType = String(doc.mimeType || 'application/pdf').trim() || 'application/pdf';
  const title = String(options?.title ?? fileName).trim() || fileName;
  const text = String(options?.text ?? title).trim() || title;

  if (Capacitor.isNativePlatform()) {
    await WhatsAppShare.shareImage({
      dataBase64: doc.contentBase64,
      fileName,
      mimeType,
    });
    return;
  }

  const blob = invoiceDocumentToBlob(doc);
  const file = new File([blob], fileName, { type: mimeType });
  const shareData: ShareData = {
    files: [file],
    title,
    text,
  };

  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  // Browser can't attach PDF to WhatsApp — download then open chat with caption.
  saveInvoiceDocumentFile(doc);
  openWhatsAppWithText(
    `${text}\n\nPDF downloaded — attach “${fileName}” from your Downloads folder.`,
  );
}
