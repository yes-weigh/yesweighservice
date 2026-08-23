/** Canonical India state/UT names — keep in sync with src/lib/indiaStates.ts picker. */

const INDIA_STATE_NAMES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli',
  'Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

const ALLOWED = new Set(INDIA_STATE_NAMES);

const UNSPECIFIED_STATE = 'Unspecified';

const ALIASES = {
  orissa: 'Odisha',
  uttaranchal: 'Uttarakhand',
  uttarakhand: 'Uttarakhand',
  pondicherry: 'Puducherry',
  puducherry: 'Puducherry',
  delhi: 'Delhi',
  'nct of delhi': 'Delhi',
  'nct delhi': 'Delhi',
  'new delhi': 'Delhi',
  'jammu kashmir': 'Jammu and Kashmir',
  'jammu and kashmir': 'Jammu and Kashmir',
  jk: 'Jammu and Kashmir',
  ladakh: 'Jammu and Kashmir',
  'andaman nicobar': 'Andaman and Nicobar Islands',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'andaman and nicobar islands': 'Andaman and Nicobar Islands',
  'dadra nagar haveli': 'Dadra and Nagar Haveli',
  'dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli',
  dnhdd: 'Dadra and Nagar Haveli',
  dnh: 'Dadra and Nagar Haveli',
  'daman diu': 'Daman and Diu',
  tamilnadu: 'Tamil Nadu',
  'tamil nadu': 'Tamil Nadu',
  tn: 'Tamil Nadu',
  kerala: 'Kerala',
  kl: 'Kerala',
  karnataka: 'Karnataka',
  ka: 'Karnataka',
  maharashtra: 'Maharashtra',
  mh: 'Maharashtra',
  'west bengal': 'West Bengal',
  wb: 'West Bengal',
  'uttar pradesh': 'Uttar Pradesh',
  up: 'Uttar Pradesh',
  'madhya pradesh': 'Madhya Pradesh',
  mp: 'Madhya Pradesh',
  'andhra pradesh': 'Andhra Pradesh',
  ap: 'Andhra Pradesh',
  telangana: 'Telangana',
  ts: 'Telangana',
  tg: 'Telangana',
  gujarat: 'Gujarat',
  gj: 'Gujarat',
  rajasthan: 'Rajasthan',
  rj: 'Rajasthan',
  bihar: 'Bihar',
  br: 'Bihar',
  odisha: 'Odisha',
  od: 'Odisha',
  punjab: 'Punjab',
  pb: 'Punjab',
  haryana: 'Haryana',
  hr: 'Haryana',
  assam: 'Assam',
  as: 'Assam',
  chhattisgarh: 'Chhattisgarh',
  cg: 'Chhattisgarh',
  jharkhand: 'Jharkhand',
  jh: 'Jharkhand',
  goa: 'Goa',
  ga: 'Goa',
};

function normKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CANONICAL = new Map(INDIA_STATE_NAMES.map(name => [normKey(name), name]));

export { INDIA_STATE_NAMES, UNSPECIFIED_STATE };

export function canonicalIndiaState(raw) {
  const key = normKey(raw);
  if (!key) return UNSPECIFIED_STATE;
  return ALIASES[key] ?? CANONICAL.get(key) ?? UNSPECIFIED_STATE;
}

export function sanitizeRestrictedSalesStates(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = canonicalIndiaState(item);
    if (name === UNSPECIFIED_STATE || !ALLOWED.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
