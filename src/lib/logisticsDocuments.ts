import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import { STAFF_LOGISTICS_SITE_LABELS } from '../types/staff-logistics';
import {
  boxChargeableWeight,
  boxDimensionsLabel,
  chargeableWeight,
  shipmentModeLabel,
} from './logisticsBooking';
import {
  buildShippingLabelViewModel,
  formatShippingBookingTime,
  shippingLabelBarcodeBars,
  type ShippingLabelViewModel,
} from './shippingLabel';

const DOC_STYLES = `
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
  @page { margin: 0; size: 100mm 150mm; }
  html, body { margin: 0; padding: 0; }
  body { background: #fff; color: #111; }
  .sheet {
    width: 100mm;
    height: 150mm;
    border: 2px solid #111;
    padding: 4.5mm 4mm;
    margin: 0;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
  }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
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
  .sheet__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 2px solid #111;
  }
  .sheet__logo { height: 22px; width: auto; object-fit: contain; }
  .sheet__product-line {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .sheet__parties {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 6px;
  }
  .sheet__party-label {
    display: block;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .sheet__party-name {
    display: block;
    font-size: 11px;
    font-weight: 800;
    margin-bottom: 2px;
  }
  .sheet__party-address {
    margin: 0;
    font-size: 9px;
    line-height: 1.3;
    white-space: pre-line;
  }
  .sheet__box-meta,
  .sheet__weights {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 6px;
    padding: 5px 0;
    border-top: 1px solid #111;
    border-bottom: 1px solid #111;
  }
  .sheet__weights { border-top: none; }
  .sheet__box-meta span,
  .sheet__weights span,
  .sheet__dest span,
  .sheet__booking span {
    display: block;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 1px;
  }
  .sheet__box-meta strong,
  .sheet__weights strong,
  .sheet__dest strong,
  .sheet__booking strong {
    display: block;
    font-size: 12px;
    font-weight: 800;
  }
  .sheet__carrier {
    display: grid;
    grid-template-columns: 0.9fr 1.1fr;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
    min-height: 48px;
  }
  .sheet__carrier-logo img {
    max-width: 100%;
    max-height: 36px;
    object-fit: contain;
  }
  .sheet__carrier-logo strong { font-size: 12px; font-weight: 800; }
  .sheet__barcode-block { text-align: center; }
  .sheet__barcode-block code {
    display: block;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }
  .sheet__barcode {
    display: flex;
    justify-content: center;
    gap: 1px;
    height: 34px;
  }
  .sheet__barcode i {
    display: block;
    width: 2px;
    background: #111;
    height: 100%;
  }
  .sheet__barcode i:nth-child(3n) { width: 1px; }
  .sheet__barcode i:nth-child(5n) { width: 3px; }
  .sheet__footer {
    display: grid;
    grid-template-columns: 1fr 1.1fr;
    gap: 8px;
    margin-top: auto;
    padding-top: 6px;
    border-top: 2px solid #111;
  }
  .sheet__booking { display: grid; gap: 4px; }
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

function shippingLabelSheetHtml(label: ShippingLabelViewModel): string {
  const bars = shippingLabelBarcodeBars(label.consignmentNo)
    .map(w => `<i style="width:${w}px"></i>`)
    .join('');
  const boxLabel = label.shipmentMode === 'envelope'
    ? '1/1'
    : `${label.boxIndex}/${label.boxTotal}`;
  const boxCount = label.shipmentMode === 'envelope' ? 'Envelope' : String(label.numberOfBoxes);
  const carrier = label.partnerImage
    ? `<img src="${escapeHtml(label.partnerImage)}" alt="${escapeHtml(label.partnerLabel)}" />`
    : `<strong>${escapeHtml(label.partnerLabel)}</strong>`;

  return `
    <div class="sheet sheet--shipping">
      <header class="sheet__header">
        <img class="sheet__logo" src="/logo.png" alt="YESWEIGH" />
        <strong class="sheet__product-line">GENUINE SPARE PART</strong>
      </header>
      <div class="sheet__parties">
        <div class="sheet__party">
          <span class="sheet__party-label">From (shipper)</span>
          <strong class="sheet__party-name">${escapeHtml(label.fromName)}</strong>
          <p class="sheet__party-address">${escapeHtml(label.fromAddress)}</p>
        </div>
        <div class="sheet__party">
          <span class="sheet__party-label">To (consignee)</span>
          <strong class="sheet__party-name">${escapeHtml(label.toName)}</strong>
          <p class="sheet__party-address">${escapeHtml(label.toAddress)}</p>
        </div>
      </div>
      <div class="sheet__box-meta">
        <div><span>Number of boxes</span><strong>${escapeHtml(boxCount)}</strong></div>
        <div><span>Box number</span><strong>${escapeHtml(boxLabel)}</strong></div>
      </div>
      <div class="sheet__weights">
        <div><span>Gross weight</span><strong>${label.grossWeightKg.toFixed(2)} kg</strong></div>
        <div><span>Chargeable weight</span><strong>${label.chargeableWeightKg.toFixed(2)} kg</strong></div>
      </div>
      <div class="sheet__carrier">
        <div class="sheet__carrier-logo">${carrier}</div>
        <div class="sheet__barcode-block">
          <code>${escapeHtml(label.consignmentNo)}</code>
          <div class="sheet__barcode" aria-hidden="true">${bars}</div>
        </div>
      </div>
      <footer class="sheet__footer">
        <div class="sheet__dest">
          <span>Destination city</span>
          <strong>${escapeHtml(label.destinationCity)}</strong>
        </div>
        <div class="sheet__booking">
          <div><span>Booking branch</span><strong>${escapeHtml(label.bookingBranch)}</strong></div>
          <div><span>Booking date</span><strong>${escapeHtml(label.bookingDate)}</strong></div>
          <div><span>Booking time</span><strong>${escapeHtml(label.bookingTime)}</strong></div>
          <div><span>Booked by</span><strong>${escapeHtml(label.bookedBy)}</strong></div>
        </div>
      </footer>
    </div>`;
}

export function shippingLabelHtml(booking: LogisticsBooking): string {
  const count = booking.shipmentMode === 'envelope'
    ? 1
    : Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1);
  const bookingTime = booking.createdAt
    ? formatShippingBookingTime(new Date(booking.createdAt))
    : formatShippingBookingTime();
  const chargeable = chargeableWeight(booking);

  return Array.from({ length: count }, (_, index) => {
    const label = buildShippingLabelViewModel({
      fromName: STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || 'YESWEIGH',
      fromAddress: booking.shipFromAddress || '—',
      dealer: booking.dealer,
      deliveryAddress: booking.deliveryAddress,
      numberOfBoxes: count,
      boxIndex: index + 1,
      grossWeightKg: booking.actualWeightKg,
      chargeableWeightKg: chargeable,
      partnerId: booking.partnerId,
      consignmentNo: booking.consignmentNo,
      bookingBranch: booking.branch,
      bookingDate: booking.bookingDate,
      bookingTime,
      bookedBy: 'YESWEIGH',
      shipmentMode: booking.shipmentMode,
    });
    return shippingLabelSheetHtml(label);
  }).join('');
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
