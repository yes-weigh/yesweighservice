import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import {
  packageTypeLabel,
  shipmentModeLabel,
} from './logisticsBooking';

const DOC_STYLES = `
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
  body { margin: 0; padding: 16px; background: #fff; color: #111; }
  .doc { border: 2px solid #111; border-radius: 8px; padding: 16px; max-width: 420px; margin: 0 auto; }
  .doc__partner { font-size: 20px; font-weight: 800; text-transform: uppercase; }
  .doc__title { font-size: 11px; letter-spacing: 2px; color: #555; margin-bottom: 12px; }
  .doc__track { border: 1px dashed #111; border-radius: 6px; padding: 10px; text-align: center; margin-bottom: 12px; }
  .doc__track span { font-size: 10px; letter-spacing: 1px; color: #555; display: block; }
  .doc__track strong { font-size: 18px; letter-spacing: 1px; }
  .doc__bars { height: 46px; margin: 8px 0 4px; background: repeating-linear-gradient(90deg, #111 0, #111 2px, #fff 2px, #fff 4px, #111 4px, #111 7px, #fff 7px, #fff 9px); }
  .doc__num { font-size: 14px; letter-spacing: 3px; }
  .doc__to { border-top: 1px solid #ddd; padding-top: 10px; margin-bottom: 12px; font-size: 12px; }
  .doc__to span { font-size: 10px; letter-spacing: 1px; color: #555; display: block; }
  .doc__to strong { font-size: 14px; display: block; margin-bottom: 2px; }
  .doc__meta { width: 100%; border-collapse: collapse; font-size: 12px; }
  .doc__meta td { border-top: 1px solid #eee; padding: 4px 0; vertical-align: top; }
  .doc__meta td:first-child { color: #555; width: 42%; }
  .doc__items { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  .doc__items th { text-align: left; border-bottom: 1px solid #111; padding: 4px 0; font-size: 10px; letter-spacing: 1px; color: #555; }
  .doc__items td { border-bottom: 1px solid #eee; padding: 5px 0; }
  .doc__items td:last-child, .doc__items th:last-child { text-align: right; }
  @media print { body { padding: 0; } }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function metaRows(rows: Array<[string, string]>): string {
  return rows
    .filter(([, value]) => value !== '' && value != null)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('');
}

function openDocWindow(title: string, bodyHtml: string, autoPrint: boolean): void {
  const win = window.open('', '_blank', 'width=460,height=760');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>${DOC_STYLES}</style></head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
  if (autoPrint) {
    win.setTimeout(() => win.print(), 300);
  }
}

function packageMetaRows(booking: LogisticsBooking): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Shipment type', shipmentModeLabel(booking.shipmentMode)],
  ];
  if (booking.shipmentMode === 'box') {
    rows.push(
      ['Boxes', String(booking.numberOfBoxes)],
      ['Weight', `${booking.actualWeightKg.toFixed(2)} kg`],
      [
        'Dimensions',
        booking.lengthCm && booking.widthCm && booking.heightCm
          ? `${booking.lengthCm} × ${booking.widthCm} × ${booking.heightCm} cm`
          : '',
      ],
      ['Package', packageTypeLabel(booking.packageType)],
    );
  }
  return rows;
}

export function shippingLabelHtml(booking: LogisticsBooking): string {
  const rows: Array<[string, string]> = [
    ['Service', booking.serviceType],
    ['Branch', booking.branch],
    ...packageMetaRows(booking),
    ['Date', booking.bookingDate],
  ];
  return `
    <div class="doc">
      <div class="doc__partner">${escapeHtml(logisticsPartnerLabel(booking.partnerId))}</div>
      <div class="doc__title">SHIPPING LABEL</div>
      <div class="doc__track">
        <span>CONSIGNMENT NO.</span>
        <strong>${escapeHtml(booking.consignmentNo)}</strong>
        <div class="doc__bars"></div>
        <div class="doc__num">${escapeHtml(booking.consignmentNo)}</div>
      </div>
      <div class="doc__to">
        <span>DELIVER TO</span>
        <strong>${escapeHtml(booking.dealer.name)} (${escapeHtml(booking.dealer.code)})</strong>
        <div>${escapeHtml(booking.dealer.contactPerson)} · ${escapeHtml(booking.dealer.mobile)}</div>
        <div>${escapeHtml(booking.deliveryAddress)}</div>
      </div>
      <table class="doc__meta">${metaRows(rows)}</table>
    </div>`;
}

export function courierSlipHtml(booking: LogisticsBooking): string {
  const rows: Array<[string, string]> = [
    ['Order ref', booking.orderRef],
    ['Consignment', booking.consignmentNo],
    ['Service', booking.serviceType],
    ['Branch', booking.branch],
    ...packageMetaRows(booking),
    ['Ship from', booking.shipFromAddress || ''],
    ['Date', booking.bookingDate],
  ];
  const itemsRows = booking.shipmentItems
    .map(item => `<tr><td>${escapeHtml(item.name)}${item.sku ? ` <small>(${escapeHtml(item.sku)})</small>` : ''}</td><td>${item.quantity}</td></tr>`)
    .join('');
  return `
    <div class="doc">
      <div class="doc__partner">${escapeHtml(logisticsPartnerLabel(booking.partnerId))}</div>
      <div class="doc__title">COURIER SLIP</div>
      <div class="doc__to">
        <span>CONSIGN TO</span>
        <strong>${escapeHtml(booking.dealer.name)} (${escapeHtml(booking.dealer.code)})</strong>
        <div>${escapeHtml(booking.dealer.contactPerson)} · ${escapeHtml(booking.dealer.mobile)}</div>
        <div>${escapeHtml(booking.deliveryAddress)}</div>
      </div>
      <table class="doc__meta">${metaRows(rows)}</table>
      <table class="doc__items">
        <thead><tr><th>Item</th><th>Qty</th></tr></thead>
        <tbody>${itemsRows || '<tr><td colspan="2">No items listed</td></tr>'}</tbody>
      </table>
    </div>`;
}

export function openShippingLabelWindow(booking: LogisticsBooking, autoPrint: boolean): void {
  openDocWindow(`Shipping Label ${booking.consignmentNo}`, shippingLabelHtml(booking), autoPrint);
}

export function openCourierSlipWindow(booking: LogisticsBooking, autoPrint: boolean): void {
  openDocWindow(`Courier Slip ${booking.orderRef}`, courierSlipHtml(booking), autoPrint);
}
