/**
 * Spot-check Blue Dart quote math against tariff sheets (no Firestore).
 * Usage: node scripts/validate-bluedart-quotes.mjs
 */

import {
  defaultBlueDartConfig,
  quoteBlueDartParcels,
} from '../functions/lib/blue-dart-quote.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const config = defaultBlueDartConfig();
// Ops often leave GST out of “compare to sheet before tax” — zero for sheet checks.
config.shared.gstPercent = 0;
config.shared.edlFlatFallbackInr = 550;

const dims10kg = { lengthCm: 10, widthCm: 10, heightCm: 10 }; // vol tiny → actual wins

// Surface Zone 1 (SOUTH→SOUTH), 10 kg Band 13: base 8*10=80 → min freight 160
{
  const q = quoteBlueDartParcels({
    config,
    service: 'surface',
    destState: 'Tamil Nadu',
    pin: { sfcService: 'Yes', dpZone: 'A' },
    parcels: [{ actualKg: 10, dims: dims10kg }],
    invoiceValueInr: 0,
  });
  // FOV min 90 always applied in our stack
  assert(!q.notServiceable && !q.rateMissing, 'Surface TN should quote');
  assert(q.chargeableKg === 10, `Surface chargeable expected 10 got ${q.chargeableKg}`);
  console.log('Surface TN 10kg total (incl FOV/docket/FS/CAF):', q.totalInr);
  assert(q.totalInr > 160, 'Surface total should exceed min freight');
}

// Air Zone 1 Kerala 10kg — base 32*10=320
{
  const q = quoteBlueDartParcels({
    config,
    service: 'air',
    destState: 'Kerala',
    pin: { apxService: 'Yes' },
    parcels: [{ actualKg: 10, dims: dims10kg }],
    invoiceValueInr: 0,
  });
  assert(!q.notServiceable, 'Air Kerala should quote');
  console.log('Air Kerala 10kg total:', q.totalInr);
  assert(q.totalInr > 320, 'Air total should exceed base freight');
}

// DP A1 Kerala first 500g — base 28
{
  const q = quoteBlueDartParcels({
    config,
    service: 'domestic_priority',
    destState: 'Kerala',
    pin: { dpService: 'Yes', dpZone: 'B' },
    parcels: [{ actualKg: 0.5, dims: dims10kg }],
  });
  assert(!q.notServiceable, 'DP Kerala should quote A1');
  console.log('DP Kerala 0.5kg total:', q.totalInr);
  assert(q.totalInr > 28, 'DP total should exceed base 28');
}

// NE EDL special floor 3000
{
  const q = quoteBlueDartParcels({
    config,
    service: 'surface',
    destState: 'Assam',
    pin: { sfcService: 'EDL' },
    parcels: [{ actualKg: 10, dims: dims10kg }],
    invoiceValueInr: 0,
  });
  assert(!q.notServiceable, 'Assam EDL should quote');
  console.log('Surface Assam EDL 10kg total:', q.totalInr);
  assert(q.totalInr >= 3000, 'NE EDL floor should apply');
}

// TEM hidden
{
  const q = quoteBlueDartParcels({
    config,
    service: 'surface',
    destState: 'Kerala',
    pin: { sfcService: 'TEM' },
    parcels: [{ actualKg: 10, dims: dims10kg }],
  });
  assert(q.notServiceable, 'TEM should be not serviceable');
  console.log('TEM pin correctly blocked');
}

// Zone matrix SOUTH→EAST = Zone 4
{
  const q = quoteBlueDartParcels({
    config,
    service: 'air',
    destState: 'West Bengal',
    pin: { apxService: 'Yes' },
    parcels: [{ actualKg: 10, dims: dims10kg }],
  });
  assert(!q.rateMissing, 'Air WB should have Zone 4 rate');
  console.log('Air West Bengal 10kg total:', q.totalInr);
}

console.log('\nAll Blue Dart spot-checks passed.');
