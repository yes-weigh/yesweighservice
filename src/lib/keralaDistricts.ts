import { KERALA_DISTRICT_PATHS } from '../data/keralaDistrictPaths';
import { normKey } from './indiaStates';

const CANONICAL = new Map(KERALA_DISTRICT_PATHS.map(d => [normKey(d.name), d.name]));

const ALIASES: Record<string, string> = {
  trivandrum: 'Thiruvananthapuram',
  thiruvananthapuram: 'Thiruvananthapuram',
  tvm: 'Thiruvananthapuram',
  calicut: 'Kozhikode',
  kozhikode: 'Kozhikode',
  clt: 'Kozhikode',
  cochin: 'Ernakulam',
  kochi: 'Ernakulam',
  ernakulam: 'Ernakulam',
  ekm: 'Ernakulam',
  quilon: 'Kollam',
  kollam: 'Kollam',
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
  malapuram: 'Malappuram',
  malappuram: 'Malappuram',
  idukki: 'Idukki',
  kottayam: 'Kottayam',
};

export const UNSPECIFIED_DISTRICT = 'Unspecified';
export const KERALA_STATE = 'Kerala';

export const KERALA_DISTRICT_NAMES = KERALA_DISTRICT_PATHS.map(d => d.name);

export function canonicalKeralaDistrict(raw: string | null | undefined): string {
  const key = normKey(String(raw ?? ''));
  if (!key) return UNSPECIFIED_DISTRICT;
  return ALIASES[key] ?? CANONICAL.get(key) ?? UNSPECIFIED_DISTRICT;
}
