import { INDIA_STATE_PATHS } from '../data/indiaStatePaths';

const CANONICAL = new Map(INDIA_STATE_PATHS.map(s => [normKey(s.name), s.name]));

const ALIASES: Record<string, string> = {
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

export const UNSPECIFIED_STATE = 'Unspecified';

export function normKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function canonicalIndiaState(raw: string | null | undefined): string {
  const key = normKey(String(raw ?? ''));
  if (!key) return UNSPECIFIED_STATE;
  return ALIASES[key] ?? CANONICAL.get(key) ?? UNSPECIFIED_STATE;
}
