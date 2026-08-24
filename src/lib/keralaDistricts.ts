import { KERALA_DISTRICT_PATHS } from '../data/keralaDistrictPaths';
import { canonicalIndiaState, normKey } from './indiaStates';

/** Official Kerala districts, north → south. */
export const KERALA_DISTRICTS = [
  'Kasaragod',
  'Kannur',
  'Wayanad',
  'Kozhikode',
  'Malappuram',
  'Palakkad',
  'Thrissur',
  'Ernakulam',
  'Idukki',
  'Kottayam',
  'Alappuzha',
  'Pathanamthitta',
  'Kollam',
  'Thiruvananthapuram',
] as const;

export type KeralaDistrict = (typeof KERALA_DISTRICTS)[number];

const CANONICAL = new Map(KERALA_DISTRICTS.map(name => [normKey(name), name]));
for (const path of KERALA_DISTRICT_PATHS) {
  CANONICAL.set(normKey(path.name), path.name as KeralaDistrict);
}

const ALIASES: Record<string, string> = {
  trivandrum: 'Thiruvananthapuram',
  thiruvananthapuram: 'Thiruvananthapuram',
  tvm: 'Thiruvananthapuram',
  calicut: 'Kozhikode',
  kozhikode: 'Kozhikode',
  koozhikode: 'Kozhikode',
  clt: 'Kozhikode',
  cochin: 'Ernakulam',
  kochi: 'Ernakulam',
  ernakulam: 'Ernakulam',
  ekm: 'Ernakulam',
  quilon: 'Kollam',
  kollam: 'Kollam',
  kottarakkara: 'Kollam',
  kottarakara: 'Kollam',
  cannanore: 'Kannur',
  kannur: 'Kannur',
  palghat: 'Palakkad',
  palakkad: 'Palakkad',
  trichur: 'Thrissur',
  thrissur: 'Thrissur',
  allepey: 'Alappuzha',
  alleppey: 'Alappuzha',
  alappuzha: 'Alappuzha',
  wynad: 'Wayanad',
  wayanad: 'Wayanad',
  kasargod: 'Kasaragod',
  kasaragod: 'Kasaragod',
  pathanamthitta: 'Pathanamthitta',
  pta: 'Pathanamthitta',
  thiruvalla: 'Pathanamthitta',
  malapuram: 'Malappuram',
  malappuram: 'Malappuram',
  idukki: 'Idukki',
  thodupuzha: 'Idukki',
  kottayam: 'Kottayam',
};

export const UNSPECIFIED_DISTRICT = 'Unspecified';
export const KERALA_STATE = 'Kerala';

export const KERALA_DISTRICT_NAMES = [...KERALA_DISTRICTS];

export function isKeralaBillingState(state: string | null | undefined): boolean {
  return canonicalIndiaState(state) === KERALA_STATE;
}

export function canonicalKeralaDistrict(raw: string | null | undefined): string {
  const stripped = String(raw ?? '')
    .replace(/^[\s\u00a0\u2060]*\d+[\s\u00a0\u2060]*[.)][\s\u00a0\u2060]*/u, '')
    .trim();
  const key = normKey(stripped);
  if (!key) return UNSPECIFIED_DISTRICT;
  return ALIASES[key] ?? CANONICAL.get(key) ?? UNSPECIFIED_DISTRICT;
}
