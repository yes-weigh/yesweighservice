import React from 'react';
import { formatCurrency } from '../../lib/catalog';
import { ewayBillRequiredLabel } from '../../constants/ewayBill';

export type EwayBillGeneratePreview = {
  invoiceNumber: string;
  invoiceTotalInr: number;
  consigneeName: string;
  partnerLabel: string;
  transporterName: string | null;
  lrNumber: string | null;
  transportMode: string;
  supplyType: string;
  transactionType: string;
  documentDate: string;
  invoiceCount?: number;
};

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="logistics-eway-generate__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function isEwayTransporterMissing(preview: EwayBillGeneratePreview): boolean {
  return !preview.transporterName?.trim();
}

type BodyProps = {
  preview: EwayBillGeneratePreview;
  error?: string;
  intro?: string;
};

export const EwayBillGeneratePreviewBody: React.FC<BodyProps> = ({
  preview,
  error = '',
  intro,
}) => {
  const transporterMissing = isEwayTransporterMissing(preview);

  return (
    <>
      {intro ? (
        <p className="book-courier__hint text-muted text-sm">{intro}</p>
      ) : (
        <p className="book-courier__hint text-muted text-sm">
          {ewayBillRequiredLabel(preview.invoiceTotalInr)}
          {' '}
          Confirm to create the e-way bill in Zoho for this invoice.
        </p>
      )}
      <dl className="logistics-eway-generate__preview">
        <PreviewRow
          label={(preview.invoiceCount ?? 1) > 1 ? 'Invoices' : 'Invoice'}
          value={preview.invoiceNumber || '—'}
        />
        <PreviewRow
          label={(preview.invoiceCount ?? 1) > 1 ? 'Clubbed total (incl. GST)' : 'Invoice total (incl. GST)'}
          value={formatCurrency(preview.invoiceTotalInr)}
        />
        <PreviewRow label="Consignee" value={preview.consigneeName || '—'} />
        <PreviewRow label="Delivery partner" value={preview.partnerLabel} />
        <PreviewRow
          label="Zoho transporter"
          value={(
            preview.transporterName?.trim()
              ? preview.transporterName
              : (
                <span className="logistics-eway-generate__warn">
                  Not linked — set under Settings → Logistics → Delivery Partners
                </span>
              )
          )}
        />
        <PreviewRow
          label="LR / consignment no."
          value={preview.lrNumber?.trim() || '—'}
        />
        <PreviewRow label="Transport mode" value={preview.transportMode} />
        <PreviewRow label="Supply type" value={preview.supplyType} />
        <PreviewRow label="Transaction type" value={preview.transactionType} />
        <PreviewRow label="Transporter document date" value={preview.documentDate} />
      </dl>
      {transporterMissing ? (
        <p className="logistics-eway-generate__note text-muted text-sm" role="note">
          Link a Zoho transporter for {preview.partnerLabel} before generating.
        </p>
      ) : null}
      {error ? (
        <p className="logistics-booking__docs-error" role="alert">{error}</p>
      ) : null}
    </>
  );
};

export function ewayBillDocumentDateLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
