import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import {
  boxChargeableWeight,
  boxDimensionsLabel,
  chargeableWeight,
  shipmentModeLabel,
} from './logisticsBooking';
import { SHIPPING_LABEL_SHEET_STYLES } from './logisticsLabelPrint';
import {
  buildShippingLabelsFromBooking,
  formatShippingAddressLines,
  shippingLabelBarcodeBars,
  shippingLabelMetricRows,
  type ShippingLabelViewModel,
} from './shippingLabel';
import { shippingLabelHeaderHtml } from './shippingLabelHeader';

const DOC_STYLES = `
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
  @page { margin: 0; size: 100mm 150mm; }
  html, body { margin: 0; padding: 0; }
  body { background: #fff; color: #111; }
  ${SHIPPING_LABEL_SHEET_STYLES}
  .doc {
    width: 100mm;
    height: 150mm;
    border: 2px solid #111;
    padding: 6mm 5mm;
    margin: 0;
    overflow: hidden;
    page-break-after: always;
  }
  .doc:last-child { page-break-after: auto; }
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
  const win = window.open('', '_blank', 'width=420,height=620');
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
      ['Actual weight', `${booking.actualWeightKg.toFixed(2)} kg`],
      ['Volumetric weight', `${booking.volumetricWeightKg.toFixed(2)} kg`],
      ['Chargeable weight', `${chargeableWeight(booking).toFixed(2)} kg`],
    );
  }
  return rows;
}

function iconSvg(paths: string): string {
  return `<svg class="sheet__glyph" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const DOC_ICONS = {
  boxes: iconSvg('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  boxNumber: iconSvg('<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><rect x="4" y="11" width="16" height="10" rx="2"/>'),
  dimensions: iconSvg('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>'),
  contents: iconSvg('<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>'),
  weight: iconSvg('<circle cx="12" cy="5" r="3"/><path d="M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z"/>'),
  transport: iconSvg('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'),
  payment: iconSvg('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>'),
  time: iconSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  bookedBy: iconSvg('<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>'),
} as const;

function metricCellHtml(title: string, value: string, icon: keyof typeof DOC_ICONS): string {
  return `<div class="sheet__metric"><div class="sheet__metric-head">${DOC_ICONS[icon]}<span class="sheet__metric-title">${escapeHtml(title)}</span></div><strong class="sheet__metric-value">${escapeHtml(value)}</strong></div>`;
}

function infoCellHtml(
  title: string,
  value: string,
  icon: 'time' | 'bookedBy',
): string {
  return `<div class="sheet__info-cell"><div class="sheet__info-head">${DOC_ICONS[icon]}<span class="sheet__label">${escapeHtml(title)}</span></div><strong>${escapeHtml(value)}</strong></div>`;
}

function shippingLabelSheetHtml(label: ShippingLabelViewModel): string {
  const bars = shippingLabelBarcodeBars(label.consignmentNo)
    .map((w, i) => (
      `<i style="flex:${w} ${w} 0;background:${i % 2 === 0 ? '#111' : 'transparent'}"></i>`
    ))
    .join('');
  const metricsHtml = shippingLabelMetricRows(label)
    .map(row => (
      `<div class="sheet__metrics-row sheet__metrics-row--${row.length}">`
      + row.map(cell => metricCellHtml(cell.title, cell.value, cell.icon)).join('')
      + '</div>'
    ))
    .join('');
  const carrierInner = label.partnerImage
    ? `<img src="${escapeHtml(label.partnerImage)}" alt="${escapeHtml(label.partnerLabel)}" />`
    : `<strong class="sheet__carrier-name">${escapeHtml(label.partnerLabel)}</strong>`;

  return `
    <div class="sheet sheet--shipping">
      <div class="sheet__frame">
        ${shippingLabelHeaderHtml(label.firmName)}
        <div class="sheet__parties">
          <div class="sheet__party">
            <span class="sheet__label">FROM (SHIPPER)</span>
            <strong class="sheet__party-name">${escapeHtml(label.fromName)}</strong>
            <p class="sheet__party-address">${escapeHtml(formatShippingAddressLines(label.fromAddress, 6))}</p>
          </div>
          <div class="sheet__party">
            <span class="sheet__label">TO (CONSIGNEE)</span>
            <strong class="sheet__party-name">${escapeHtml(label.toName)}</strong>
            <p class="sheet__party-address">${escapeHtml(formatShippingAddressLines(label.toAddress, 6))}</p>
            ${label.toPhone ? `<strong class="sheet__party-phone">Ph: ${escapeHtml(label.toPhone)}</strong>` : ''}
          </div>
        </div>
        <div class="sheet__panel sheet__metrics">
          ${metricsHtml}
        </div>
        <div class="sheet__panel sheet__courier">
          <div class="sheet__courier-side sheet__courier-side--logo">
            <div class="sheet__carrier-logo">${carrierInner}</div>
          </div>
          <div class="sheet__courier-side sheet__courier-side--track">
            <span class="sheet__label">AWB / TRACKING</span>
            <code class="sheet__awb">${escapeHtml(label.consignmentNo)}</code>
            <div class="sheet__barcode" aria-hidden="true">${bars}</div>
          </div>
        </div>
        <div class="sheet__panel sheet__info">
          ${infoCellHtml('BOOKING TIME', label.bookingTime, 'time')}
          ${infoCellHtml('BOOKED BY', label.bookedBy, 'bookedBy')}
        </div>
      </div>
    </div>`;
}

export function shippingLabelHtml(booking: LogisticsBooking): string {
  return buildShippingLabelsFromBooking(booking)
    .map(label => shippingLabelSheetHtml(label))
    .join('');
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
  const boxRows = booking.boxes
    .map((box, index) => {
      const dims = boxDimensionsLabel(box);
      const weight = booking.shipmentMode === 'box'
        ? `${boxChargeableWeight(box).toFixed(2)} kg`
        : '—';
      return `<tr><td>Box ${index + 1}${dims !== '—' ? ` <small>(${escapeHtml(dims)})</small>` : ''}</td><td>${escapeHtml(weight)}</td></tr>`;
    })
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
        <thead><tr><th>Package</th><th>Chargeable</th></tr></thead>
        <tbody>${boxRows || '<tr><td colspan="2">No boxes listed</td></tr>'}</tbody>
      </table>
    </div>`;
}

export function openShippingLabelWindow(booking: LogisticsBooking, autoPrint: boolean): void {
  openDocWindow(`Shipping Label ${booking.consignmentNo}`, shippingLabelHtml(booking), autoPrint);
}

export function openCourierSlipWindow(booking: LogisticsBooking, autoPrint: boolean): void {
  openDocWindow(`Courier Slip ${booking.orderRef}`, courierSlipHtml(booking), autoPrint);
}
