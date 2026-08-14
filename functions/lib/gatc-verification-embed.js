const GATC_EMBED_MINT_URL = 'https://us-central1-yesgatc.cloudfunctions.net/mintYesweighEmbedToken';
const GATC_VERIFICATION_EMBED_URL = 'https://yesgatc.in/rc/verification?embed=1';

/**
 * Calls yesgatc mintYesweighEmbedToken with the shared secret and returns an iframe src.
 */
export async function fetchGatcVerificationEmbedSrc(secret) {
  const value = String(secret ?? '').trim();
  if (!value) {
    return { src: GATC_VERIFICATION_EMBED_URL, autoLogin: false };
  }

  const response = await fetch(GATC_EMBED_MINT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-yesweigh-embed-secret': value,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `GATC embed login failed (${response.status}).`);
  }

  const data = await response.json();
  const token = String(data?.token ?? '').trim();
  if (!token) {
    throw new Error('GATC embed login did not return a session.');
  }

  return {
    src: `${GATC_VERIFICATION_EMBED_URL}#embedToken=${encodeURIComponent(token)}`,
    autoLogin: true,
  };
}

export { GATC_VERIFICATION_EMBED_URL };
