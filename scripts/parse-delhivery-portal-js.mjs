import { readFileSync } from 'node:fs';

const s = readFileSync('scripts/_delhivery-portal.js', 'utf8');
const keys = [
  'shipment-cancellation',
  'shipment_cancellation',
  'shipment cancellation',
  '/cancel',
  'lrn/cancel',
  'cancellation',
  'Cancel Shipment',
  'ltl-clients',
  'btob.api',
  'manifest',
];

for (const k of keys) {
  let idx = 0;
  let n = 0;
  while ((idx = s.indexOf(k, idx)) !== -1 && n < 6) {
    console.log(`\n=== ${k} @ ${idx} ===`);
    console.log(s.slice(Math.max(0, idx - 160), idx + 280));
    idx += k.length;
    n += 1;
  }
}

const found = new Set();
for (const m of s.matchAll(/["'`](\/[A-Za-z0-9_\-/{}]*cancel[A-Za-z0-9_\-/{}]*)["'`]/gi)) {
  found.add(m[1]);
}
console.log('\nPATHS', [...found].slice(0, 80));

const urls = new Set();
for (const m of s.matchAll(/["'`](https?:\/\/[^"'`]*(?:ltl|btob|cancel|manifest)[^"'`]*)["'`]/gi)) {
  urls.add(m[1]);
}
console.log('\nURLS', [...urls].slice(0, 100));

// Document content fetch patterns
for (const k of ['/document/', 'detail/', 'getDocument', 'api/docs', 'openapi', 'swagger']) {
  let idx = s.indexOf(k);
  if (idx >= 0) {
    console.log(`\n~~ ${k} ~~`);
    console.log(s.slice(Math.max(0, idx - 100), idx + 200));
  }
}
