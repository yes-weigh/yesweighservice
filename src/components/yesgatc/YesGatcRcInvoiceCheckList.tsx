import { AlertTriangle } from 'lucide-react';
import {
  isYesGatcRcWeighingScaleLine,
  type YesGatcRcInvoiceReportLine,
  type YesGatcRcInvoiceReportRow,
} from '../../lib/yesgatcRecords';
import { formatInvoiceDateTime } from '../../lib/invoices';
import { FastRemoteImage } from '../media/FastRemoteImage';

function reportLines(row: YesGatcRcInvoiceReportRow): YesGatcRcInvoiceReportLine[] {
  const lines = row.lines?.length
    ? row.lines.filter(line => line.id !== 'allocated' && line.name !== 'Serials')
    : [{
      id: 'serials',
      itemId: null,
      name: row.customerName || 'Invoice',
      sku: null,
      description: '',
      imageUrl: null,
      quantity: row.serialNumbers.length,
      serialNumbers: row.serialNumbers,
      max: '',
      e: '',
      certificateNumbers: [],
    }];
  return lines.filter(line => isYesGatcRcWeighingScaleLine(line));
}

function invoiceName(row: YesGatcRcInvoiceReportRow): string {
  return (row.customerName || '').trim()
    || (row.rcName || '').trim()
    || (row.rcCode || '').trim()
    || 'Invoice';
}

function sortedSerials(serials: readonly string[]): string[] {
  return [...serials].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

function lineQty(line: YesGatcRcInvoiceReportLine): number {
  return Math.max(0, Math.round(Number(line.quantity) || 0));
}

function serialRangeLabel(serials: readonly string[]): string {
  if (!serials.length) return '—';
  if (serials.length === 1) return serials[0];
  return `${serials[0]} – ${serials[serials.length - 1]}`;
}

function serialsForQty(serials: readonly string[], qty: number): string[] {
  const sorted = sortedSerials(serials);
  if (qty > 0 && sorted.length > qty) return sorted.slice(0, qty);
  return sorted;
}

export function YesGatcRcInvoiceCheckList({
  rows,
  onOpen,
}: {
  rows: readonly YesGatcRcInvoiceReportRow[];
  onOpen: (row: YesGatcRcInvoiceReportRow) => void;
}) {
  const visible = rows.filter(row => reportLines(row).length > 0);
  if (!visible.length) {
    return <p className="settings-locations__empty">No YesGATC invoices for this RC.</p>;
  }

  return (
    <div className="yesgatc-rc-check-list">
      {visible.map(row => (
        <article key={`${row.customerId}-${row.id}`} className="yesgatc-rc-check">
          <button
            type="button"
            className="yesgatc-rc-check__head"
            onClick={() => onOpen(row)}
          >
            <strong className="yesgatc-rc-check__invoice">
              {row.invoiceNumber || row.id}
              <span className="yesgatc-rc-check__when">
                {formatInvoiceDateTime(row.invoiceDate, row.createdTime) || row.invoiceDate || '—'}
              </span>
            </strong>
            <span className="yesgatc-rc-check__name">{invoiceName(row)}</span>
            {row.pushedBy ? (
              <span className="yesgatc-rc-check__pushed">Pushed by {row.pushedBy}</span>
            ) : null}
          </button>
          <ul className="yesgatc-rc-check__lines">
            {reportLines(row).map(line => {
              const qty = lineQty(line);
              const serials = serialsForQty(line.serialNumbers, qty);
              const mismatch = serials.length < qty;
              return (
                <li
                  key={`${row.id}-${line.id || line.name}`}
                  className={[
                    'yesgatc-rc-check__line',
                    line.imageUrl ? '' : 'yesgatc-rc-check__line--text',
                  ].filter(Boolean).join(' ')}
                >
                  {line.imageUrl ? (
                    <FastRemoteImage
                      src={line.imageUrl}
                      alt=""
                      className="yesgatc-rc-check__image"
                    />
                  ) : null}
                  <div className="yesgatc-rc-check__body">
                    <p className="yesgatc-rc-check__product">{line.name}</p>
                    <p className="yesgatc-rc-check__range">
                      <span className="yesgatc-rc-check__serials">{serialRangeLabel(serials)}</span>
                      <span className="yesgatc-rc-check__qty">Qty {qty}</span>
                    </p>
                    {mismatch ? (
                      <p className="yesgatc-rc-check__warn" role="status">
                        <AlertTriangle size={14} aria-hidden />
                        Qty {qty} needs {qty} serials — {serials.length} allotted
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
      ))}
    </div>
  );
}
