import { initializeApp, applicationDefault, getApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'yesweighmomentumhub';
const appName = 'crm-probe';

if (!getApps().some(a => a.name === appName)) {
  initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT,
  }, appName);
}

const db = getFirestore(getApp(appName));

const docs = ['deactivated_dealers', 'dealer_overrides', 'zip_codes', 'general', 'kams'];
for (const id of docs) {
  const snap = await db.collection('settings').doc(id).get();
  if (!snap.exists) {
    console.log(`\n=== settings/${id}: MISSING ===`);
    continue;
  }
  const data = snap.data();
  const keys = Object.keys(data);
  console.log(`\n=== settings/${id} keys: ${keys.join(', ')} ===`);
  if (id === 'deactivated_dealers') {
    console.log('items count:', data.items?.length ?? 0);
    console.log('sample:', data.items?.slice(0, 3));
  } else if (id === 'dealer_overrides') {
    const names = Object.keys(data).filter(k => !k.startsWith('_'));
    console.log('override count:', names.length);
    const withKam = names.filter(n => data[n]?.key_account_manager);
    console.log('with KAM:', withKam.length);
    console.log('sample:', withKam.slice(0, 3).map(n => ({ name: n, ...data[n] })));
  } else if (id === 'zip_codes') {
    const zips = Object.keys(data).filter(k => /^\d{6}$/.test(k));
    console.log('zip count:', zips.length);
    console.log('sample:', Object.fromEntries(zips.slice(0, 3).map(z => [z, data[z]])));
  } else if (id === 'general') {
    console.log('dealer_stages:', data.dealer_stages);
    console.log('dealer_categories:', data.dealer_categories);
  } else {
    console.log(JSON.stringify(data, null, 2).slice(0, 500));
  }
}

const settingsSnap = await db.collection('settings').get();
console.log('\n=== All settings doc IDs ===');
console.log(settingsSnap.docs.map(d => d.id).join(', '));
