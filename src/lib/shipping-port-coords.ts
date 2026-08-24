/** Named ocean ports used to frame the live ship map (POL → POD). */

type PortCoord = { lat: number; lon: number; keys: string[] };

const SHIPPING_PORT_COORDS: PortCoord[] = [
  { keys: ['cochin', 'kochi', 'ernakulam', 'willingdon'], lat: 9.966, lon: 76.267 },
  { keys: ['ningbo', 'nigbo', 'beilun'], lat: 29.932, lon: 121.838 },
  { keys: ['port klang', 'port kelang', 'pelabuhan klang', 'klang north', 'klang'], lat: 2.999, lon: 101.392 },
  { keys: ['nhava sheva', 'jnpt', 'nhavasheva', 'navi mumbai', 'jawaharlal nehru', 'nehru port'], lat: 18.95, lon: 72.95 },
  { keys: ['mumbai', 'bombay'], lat: 18.938, lon: 72.845 },
  { keys: ['chennai', 'madras'], lat: 13.082, lon: 80.292 },
  { keys: ['tuticorin', 'thoothukudi'], lat: 8.764, lon: 78.135 },
  { keys: ['mundra'], lat: 22.74, lon: 69.71 },
  { keys: ['colombo'], lat: 6.952, lon: 79.855 },
  { keys: ['singapore', 'psa singapore'], lat: 1.264, lon: 103.82 },
  { keys: ['shanghai', 'yangshan'], lat: 31.23, lon: 121.50 },
  { keys: ['shekou', 'yantian', 'shenzhen'], lat: 22.48, lon: 113.88 },
  { keys: ['qingdao'], lat: 36.07, lon: 120.32 },
  { keys: ['tianjin', 'xingang'], lat: 38.98, lon: 117.73 },
  { keys: ['busan', 'pusan'], lat: 35.10, lon: 129.04 },
  { keys: ['kaohsiung'], lat: 22.61, lon: 120.28 },
  { keys: ['hong kong', 'hongkong'], lat: 22.32, lon: 114.13 },
];

function normalizePortKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function lookupShippingPortCoords(
  name: string | null | undefined,
): { lat: number; lon: number } | null {
  const key = normalizePortKey(String(name ?? ''));
  if (!key) return null;
  for (const port of SHIPPING_PORT_COORDS) {
    if (port.keys.some(alias => key.includes(alias) || alias.includes(key))) {
      return { lat: port.lat, lon: port.lon };
    }
  }
  return null;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  return Math.log(Math.tan((Math.PI / 4) + (clamped * Math.PI) / 360));
}

/** Zoom 3–7 so POL and POD both fit a phone-sized map. */
export function voyageMapViewForPorts(
  portOfLoading?: string | null,
  portOfDischarge?: string | null,
): { lat: number; lon: number; zoom: number } | null {
  const load = lookupShippingPortCoords(portOfLoading);
  const discharge = lookupShippingPortCoords(portOfDischarge);
  if (load && discharge) {
    const pad = 1.4;
    const lonSpan = Math.max(0.5, Math.abs(load.lon - discharge.lon) * pad);
    const latSpanMerc = Math.max(0.08, Math.abs(mercatorY(load.lat) - mercatorY(discharge.lat)) * pad);
    // Phone map ~320×520 CSS px (full-view dialog).
    const zLon = Math.log2((360 * 320) / (256 * lonSpan));
    const zLat = Math.log2((2 * Math.PI * 520) / (256 * latSpanMerc));
    const zoom = Math.max(3, Math.min(7, Math.floor(Math.min(zLon, zLat))));
    return {
      lat: (load.lat + discharge.lat) / 2,
      lon: (load.lon + discharge.lon) / 2,
      zoom,
    };
  }
  const one = load || discharge;
  if (!one) return null;
  return { lat: one.lat, lon: one.lon, zoom: 6 };
}
