/**
 * Canonical dealer RC roster (Settings → RC OV).
 * Firestore collection: yesgatcRcOffices / {code}
 */
export const YESGATC_RC_OFFICES = 'yesgatcRcOffices';

export const YESGATC_DEALER_RC_OFFICES = [
  { code: 'ATL', name: 'ACCURATE TRADE LINKS', place: 'Dehradun', kind: 'dealer', active: true, sortOrder: 1 },
  { code: 'MZN', name: 'Meezan electronic scales pvt ltd', place: 'Malappuram', kind: 'dealer', active: true, sortOrder: 2 },
  { code: 'DYI', name: 'Dynamic Enterprise', place: 'Thrissur', kind: 'dealer', active: true, sortOrder: 3 },
  { code: 'ACE', name: 'ACE ELECTRONICS', place: 'Kozhikode', kind: 'dealer', active: true, sortOrder: 4 },
  { code: 'KNR', name: 'ROYAL SCALES', place: 'Kannur', kind: 'dealer', active: true, sortOrder: 5 },
  { code: 'KTM', name: 'VICTORY SCALES', place: 'Kottayam', kind: 'dealer', active: true, sortOrder: 6 },
  { code: 'KSR', name: 'Kraus Instruments', place: 'Thrissur', kind: 'dealer', active: true, sortOrder: 7 },
  { code: 'KLM', name: 'TAKYON SYSTEMS', place: 'Kollam', kind: 'dealer', active: true, sortOrder: 8 },
];

function str(value) {
  return value == null ? '' : String(value).trim();
}

export function normalizeYesGatcRcCode(value) {
  return str(value).toUpperCase();
}

export function isYesGatcDealerRcCode(code) {
  const wanted = normalizeYesGatcRcCode(code);
  return Boolean(wanted) && YESGATC_DEALER_RC_OFFICES.some(row => row.code === wanted);
}

export function dealerRcOfficeFallback(code) {
  const wanted = normalizeYesGatcRcCode(code);
  return YESGATC_DEALER_RC_OFFICES.find(row => row.code === wanted) || null;
}

/**
 * Official dealer RC for a code or webhook RC document id.
 * IWP / company offices are never returned.
 */
export async function loadDealerRcOffice(db, { rcId, rcCode } = {}) {
  const code = normalizeYesGatcRcCode(rcCode);
  if (code) {
    const snap = await db.collection(YESGATC_RC_OFFICES).doc(code).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.kind !== 'company' && data.active !== false) {
        return {
          code: normalizeYesGatcRcCode(data.code) || snap.id,
          name: str(data.name) || dealerRcOfficeFallback(snap.id)?.name || snap.id,
          place: str(data.place) || null,
          sourceRcId: str(data.sourceRcId) || null,
          dealerId: str(data.dealerId) || null,
          dealerName: str(data.dealerName) || null,
        };
      }
    }
    const fallback = dealerRcOfficeFallback(code);
    if (fallback) {
      return {
        code: fallback.code,
        name: fallback.name,
        place: fallback.place,
        sourceRcId: null,
        dealerId: null,
        dealerName: null,
      };
    }
  }

  const sid = str(rcId);
  if (!sid) return null;
  const bySource = await db.collection(YESGATC_RC_OFFICES)
    .where('sourceRcId', '==', sid)
    .limit(1)
    .get();
  if (bySource.empty) return null;
  const row = bySource.docs[0];
  const data = row.data() || {};
  if (data.kind === 'company' || data.active === false) return null;
  return {
    code: normalizeYesGatcRcCode(data.code) || row.id,
    name: str(data.name) || row.id,
    place: str(data.place) || null,
    sourceRcId: str(data.sourceRcId) || sid,
    dealerId: str(data.dealerId) || null,
    dealerName: str(data.dealerName) || null,
  };
}
