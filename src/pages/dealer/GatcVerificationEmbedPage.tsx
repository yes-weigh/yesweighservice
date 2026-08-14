import React, { useEffect, useState } from 'react';
import {
  GATC_VERIFICATION_EMBED_FALLBACK,
  getGatcVerificationEmbedSrc,
} from '../../lib/gatcVerificationEmbed';

export const GatcVerificationEmbedPage: React.FC = () => {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getGatcVerificationEmbedSrc();
        if (!cancelled) setSrc(next);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not open GATC verification.');
        setSrc(GATC_VERIFICATION_EMBED_FALLBACK);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="gatc-verification-embed">
      {!src ? (
        <div className="gatc-verification-embed__loading">
          <div className="loader-ring" />
          <p className="text-muted">Opening GATC verification…</p>
        </div>
      ) : (
        <iframe
          title="GATC Verification"
          src={src}
          className="gatc-verification-embed__frame"
          allow="camera; microphone; clipboard-read; clipboard-write; fullscreen"
        />
      )}
      {error && src ? (
        <p className="gatc-verification-embed__hint text-muted">{error}</p>
      ) : null}
    </div>
  );
};
