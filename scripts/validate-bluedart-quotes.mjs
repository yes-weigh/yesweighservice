/**
 * Spot-check Blue Dart quote math (no Firestore) after tariff/code changes.
 * Usage: npm run validate:bluedart
 * Surface 100kg sample asserts match bddata/Surface rates.xlsx (right-hand calc).
 */

import {
  defaultBlueDartConfig,
  quoteBlueDartParcels,
} from '../functions/lib/blue-dart-quote.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const config = defaultBlueDartConfig();
config.shared.gstPercent = 0;
config.shared.edlFlatFallbackInr = 550;

const dimsTiny = { lengthCm: 10, widthCm: 10, heightCm: 10 };

/** Off-peak surface config so Sep–Dec festival 3% does not alter the sheet sample. */
const sheetSurface = clone(config);
sheetSurface.surface.festivalSurchargePercent = 0;

// Surface rates.xlsx — Rate Calculation for 100KG
// Sheet core = Basic + Docket + FOV + FS(27%) + EFSS(7%). Our stack then adds OS/OW ₹300.
{
  const cases = [
    { state: 'Karnataka', core: 1345.311 },
    { state: 'Maharashtra', core: 1481.201 },
    { state: 'Delhi', core: 1752.981 },
    { state: 'West Bengal', core: 1888.871 },
    { state: 'Assam', core: 2840.101 },
  ];
  for (const s of cases) {
    const q = quoteBlueDartParcels({
      config: sheetSurface,
      service: 'surface',
      destState: s.state,
      pin: { sfcService: 'Yes', dpZone: 'A' },
      parcels: [{ actualKg: 100, dims: dimsTiny }],
      invoiceValueInr: 0,
    });
    assert(!q.notServiceable && !q.rateMissing, `Surface ${s.state} should quote`);
    assert(q.chargeableKg === 100, `Surface ${s.state} chargeable 100 got ${q.chargeableKg}`);
    const expectedTotal = Math.ceil(s.core + 300);
    assert(
      q.totalInr === expectedTotal,
      `Surface ${s.state} total ${q.totalInr} != ${expectedTotal} (sheet ${s.core} + OS 300)`,
    );
    console.log(`Surface 100kg ${s.state}: total ${q.totalInr} (sheet ${s.core} + OS 300)`);
  }
}

// Surface Zone 1, 10 kg — min freight 160; OS Nil; FS on 350 @ 27%
{
  const q = quoteBlueDartParcels({
    config: sheetSurface,
    service: 'surface',
    destState: 'Tamil Nadu',
    pin: { sfcService: 'Yes', dpZone: 'A' },
    parcels: [{ actualKg: 10, dims: dimsTiny }],
    invoiceValueInr: 0,
  });
  assert(!q.notServiceable && !q.rateMissing, 'Surface TN should quote');
  assert(q.chargeableKg === 10, `Surface chargeable expected 10 got ${q.chargeableKg}`);
  // 160+100+90=350; FS 94.5; after 444.5; EFSS 31.115; total 475.615 → 476
  assert(q.totalInr === 476, `Surface TN 10kg expected 476 got ${q.totalInr}`);
  console.log('Surface TN 10kg total:', q.totalInr);
}

// Air Zone 1 Kerala 10kg — base 32*10=320
{
  const q = quoteBlueDartParcels({
    config,
    service: 'air',
    destState: 'Kerala',
    pin: { apxService: 'Yes' },
    parcels: [{ actualKg: 10, dims: dimsTiny }],
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
    parcels: [{ actualKg: 0.5, dims: dimsTiny }],
  });
  assert(!q.notServiceable, 'DP Kerala should quote A1');
  console.log('DP Kerala 0.5kg total:', q.totalInr);
  assert(q.totalInr > 28, 'DP total should exceed base 28');
}

// NE EDL special floor 3000
{
  const q = quoteBlueDartParcels({
    config: sheetSurface,
    service: 'surface',
    destState: 'Assam',
    pin: { sfcService: 'EDL' },
    parcels: [{ actualKg: 10, dims: dimsTiny }],
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
    parcels: [{ actualKg: 10, dims: dimsTiny }],
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
    parcels: [{ actualKg: 10, dims: dimsTiny }],
  });
  assert(!q.rateMissing, 'Air WB should have Zone 4 rate');
  console.log('Air West Bengal 10kg total:', q.totalInr);
}

console.log('\nAll Blue Dart spot-checks passed.');
