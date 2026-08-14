import { readFileSync } from 'node:fs';

const s = readFileSync('scripts/_delhivery-portal.js', 'utf8');
const keys = [
  'ewaybill',
  'e-way',
  'eway_bill',
  'invoice-updat',
  'update-invoice',
  'update_invoice',
  'edit-invoice',
  'lrn/invoice',
  'shipment-updat',
];
for (const k of keys) {
  let idx = 0;
  let n = 0;
  const lower = s.toLowerCase();
  while ((idx = lower.indexOf(k, idx)) !== -1 && n < 4) {
    console.log(`\n=== ${k} @ ${idx} ===`);
    console.log(s.slice(Math.max(0, idx - 120), idx + 220).replace(/\s+/g, ' '));
    idx += k.length;
    n += 1;
  }
}

const slugs = new Set();
for (const m of s.matchAll(/b2b\/detail\/([a-zA-Z0-9_-]+)/g)) slugs.add(m[1]);
for (const m of s.matchAll(/["']([a-z0-9_-]*(?:invoice|eway|manifest|shipment|lrn|cancel)[a-z0-9_-]*)["']/gi)) {
  slugs.add(m[1]);
}
console.log('\nSLUGS', [...slugs].slice(0, 120));
