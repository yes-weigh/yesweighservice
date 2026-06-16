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

export async function findDealerByPhone(phone10) {
  const db = getFirestore();
  const snap = await db.collection('zohoCustomers').get();
  const matches = snap.docs.filter(doc => {
    const data = doc.data();
    const candidates = [data.phone, data.mobile, data.whatsappNumber];
    return candidates.some(value => phoneLast10(value) === phone10);
  });

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error('Multiple dealers are registered with this phone number. Contact YesWeigh support.');
  }

  const doc = matches[0];
  return { id: doc.id, ...doc.data() };
}

export async function lookupDealerForLogin(phone10) {
  const dealer = await findDealerByPhone(phone10);
  if (!dealer) {
    return { found: false };
  }

  const displayName = String(
    dealer.companyName || dealer.contactName || dealer.firstName || 'Dealer',
  ).trim();

  return {
    found: true,
    dealerId: dealer.id,
    displayName,
    hasPortalAccount: Boolean(dealer.portalUserId),
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

export async function sendDealerLoginOtp(phone10, watiToken, watiEndpoint) {
  const dealer = await findDealerByPhone(phone10);
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

  const dealer = await findDealerByPhone(phone10);
  if (!dealer || dealer.portalUserId) {
    throw new Error('This dealer account is no longer eligible for OTP signup.');
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
    displayName: String(session.displayName ?? dealer.companyName ?? dealer.contactName ?? 'Dealer'),
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

  const dealer = await findDealerByPhone(phone10);
  if (!dealer) {
    throw new Error('Dealer record not found.');
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

    const customToken = await auth.createCustomToken(userRecord.uid, { role: 'dealer' });
    return {
      customToken,
      uid: userRecord.uid,
      displayName,
    };
  } catch (err) {
    await auth.deleteUser(userRecord.uid).catch(() => undefined);
    throw err;
  }
}
