import { randomBytes, randomInt } from 'crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { linkDealerPortalUser } from './dealers-api.js';

const AUTH_EMAIL_DOMAIN = 'yesweigh.auth';
const OTP_TTL_MS = 5 * 60 * 1000;
const SETUP_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const WATI_TEMPLATE = 'yesgatcauth';

export function normalizePhone10(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

export function phoneLast10(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function dealerDisplayName(dealer) {
  return String(
    dealer.companyName || dealer.contactName || dealer.firstName || 'Dealer',
  ).trim();
}

function dealerMatchesPhone(data, phone10) {
  const candidates = [data.phone, data.mobile, data.whatsappNumber];
  return candidates.some(value => phoneLast10(value) === phone10);
}

export async function findDealersByPhone(phone10) {
  const db = getFirestore();
  const snap = await db.collection('zohoCustomers').get();
  return snap.docs
    .filter(doc => dealerMatchesPhone(doc.data(), phone10))
    .map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getDealerById(dealerId) {
  const db = getFirestore();
  const snap = await db.collection('zohoCustomers').doc(dealerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function findDealerForLogin(phone10, dealerId) {
  const matches = await findDealersByPhone(phone10);
  if (!dealerId) {
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error('Select which dealer account to use.');
    }
    return matches[0];
  }

  const dealer = matches.find(match => match.id === dealerId);
  if (!dealer) {
    throw new Error('Selected dealer was not found for this phone number.');
  }
  return dealer;
}

function mapDealerLookupOption(dealer) {
  return {
    dealerId: dealer.id,
    displayName: dealerDisplayName(dealer),
    hasPortalAccount: Boolean(dealer.portalUserId),
    companyName: dealer.companyName ? String(dealer.companyName) : null,
    district: dealer.district ? String(dealer.district) : null,
    billingState: dealer.billingState ? String(dealer.billingState) : null,
  };
}

export async function lookupDealerForLogin(phone10) {
  const matches = await findDealersByPhone(phone10);
  if (matches.length === 0) {
    return { found: false };
  }

  const dealers = matches.map(mapDealerLookupOption);
  if (matches.length === 1) {
    const dealer = dealers[0];
    return {
      found: true,
      multiple: false,
      dealerId: dealer.dealerId,
      displayName: dealer.displayName,
      hasPortalAccount: dealer.hasPortalAccount,
    };
  }

  return {
    found: true,
    multiple: true,
    dealers,
  };
}

async function sendWatiOtp(phone10, code, watiToken, watiEndpoint) {
  const whatsappNumber = `91${phone10}`;
  const base = String(watiEndpoint).replace(/\/$/, '');
  const url = `${base}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(whatsappNumber)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: watiToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      template_name: WATI_TEMPLATE,
      broadcast_name: 'Dealer_Login_OTP',
      parameters: [{ name: '1', value: code }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`WhatsApp OTP dispatch failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
}

export async function sendDealerLoginOtp(phone10, dealerId, watiToken, watiEndpoint) {
  const dealer = await findDealerForLogin(phone10, dealerId);
  if (!dealer) {
    throw new Error('No dealer found for this phone number.');
  }
  if (dealer.portalUserId) {
    throw new Error('This dealer already has a portal account. Sign in with your phone and password.');
  }

  const db = getFirestore();
  const sessionRef = db.collection('dealer_otp_sessions').doc(phone10);
  const existing = await sessionRef.get();
  if (existing.exists) {
    const lastSentAt = Number(existing.data()?.lastSentAt ?? 0);
    if (Date.now() - lastSentAt < RESEND_COOLDOWN_MS) {
      throw new Error('Please wait a minute before requesting another OTP.');
    }
  }

  const code = String(randomInt(100000, 999999));
  await sendWatiOtp(phone10, code, watiToken, watiEndpoint);

  await sessionRef.set({
    code,
    dealerId: dealer.id,
    displayName: dealer.companyName || dealer.contactName || dealer.firstName || 'Dealer',
    expiresAt: Date.now() + OTP_TTL_MS,
    lastSentAt: Date.now(),
    verified: false,
    setupToken: null,
    setupExpiresAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    sent: true,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
  };
}

export async function verifyDealerLoginOtp(phone10, code) {
  const db = getFirestore();
  const sessionRef = db.collection('dealer_otp_sessions').doc(phone10);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new Error('OTP expired or not requested. Send a new code.');
  }

  const session = sessionSnap.data();
  if (Date.now() > Number(session.expiresAt ?? 0)) {
    await sessionRef.delete().catch(() => undefined);
    throw new Error('OTP expired. Send a new code.');
  }
  if (String(session.code) !== String(code).trim()) {
    throw new Error('Invalid OTP.');
  }

  const dealer = await getDealerById(session.dealerId);
  if (!dealer || dealer.portalUserId) {
    throw new Error('This dealer account is no longer eligible for OTP signup.');
  }
  if (!dealerMatchesPhone(dealer, phone10)) {
    throw new Error('Selected dealer was not found for this phone number.');
  }

  const setupToken = randomBytes(32).toString('hex');
  await sessionRef.set({
    verified: true,
    setupToken,
    setupExpiresAt: Date.now() + SETUP_TTL_MS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    verified: true,
    setupToken,
    displayName: String(session.displayName ?? dealerDisplayName(dealer)),
  };
}

function loginIndexDocId(phone10) {
  return `p_${phone10}`;
}

export async function completeDealerSignup(phone10, setupToken, password) {
  const trimmedPassword = String(password ?? '').trim();
  if (trimmedPassword.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const db = getFirestore();
  const sessionRef = db.collection('dealer_otp_sessions').doc(phone10);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new Error('Verification session expired. Start again with your phone number.');
  }

  const session = sessionSnap.data();
  if (!session.verified || session.setupToken !== setupToken) {
    throw new Error('Invalid verification session.');
  }
  if (Date.now() > Number(session.setupExpiresAt ?? 0)) {
    await sessionRef.delete().catch(() => undefined);
    throw new Error('Verification session expired. Start again with your phone number.');
  }

  const dealer = await getDealerById(session.dealerId);
  if (!dealer) {
    throw new Error('Dealer record not found.');
  }
  if (!dealerMatchesPhone(dealer, phone10)) {
    throw new Error('Selected dealer was not found for this phone number.');
  }
  if (dealer.portalUserId) {
    throw new Error('Portal account already exists. Sign in with your phone and password.');
  }

  const loginIndexRef = db.collection('loginIndex').doc(loginIndexDocId(phone10));
  const loginIndexSnap = await loginIndexRef.get();
  if (loginIndexSnap.exists) {
    throw new Error('This phone number is already registered for login.');
  }

  const displayName = String(
    session.displayName || dealer.companyName || dealer.contactName || 'Dealer',
  ).trim();
  const authEmail = `p${phone10}@${AUTH_EMAIL_DOMAIN}`;
  const auth = getAuth();

  const userRecord = await auth.createUser({
    email: authEmail,
    password: trimmedPassword,
    displayName,
  });

  try {
    await db.collection('users').doc(userRecord.uid).set({
      loginId: phone10,
      loginIdType: 'phone',
      displayName,
      role: 'dealer',
      phone: phone10,
      zohoCustomerId: dealer.id,
      active: true,
      createdAt: new Date().toISOString(),
      createdByUid: 'dealer_otp_signup',
      clearTextPassword: trimmedPassword,
    });

    await loginIndexRef.set({
      uid: userRecord.uid,
      role: 'dealer',
      loginIdType: 'phone',
      createdAt: new Date().toISOString(),
    });

    await linkDealerPortalUser(dealer.id, userRecord.uid);
    await sessionRef.delete().catch(() => undefined);

    return {
      uid: userRecord.uid,
      displayName,
    };
  } catch (err) {
    await auth.deleteUser(userRecord.uid).catch(() => undefined);
    throw err;
  }
}
