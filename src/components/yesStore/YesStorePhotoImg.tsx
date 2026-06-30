import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { resolveYesStorePhotoUrl } from '../../lib/yesStore/photos';
import type { YesStorePhoto } from '../../types/yes-store';

export const YesStorePhotoImg: React.FC<{
  photo: YesStorePhoto;
  alt?: string;
  className?: string;
  emptyClassName?: string;
}> = ({ photo, alt = '', className, emptyClassName = 'wh-audit-tile__photo-empty text-muted' }) => {
  const { user, loading: authLoading } = useAuth();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    setFailed(false);
    setSrc(null);

    void resolveYesStorePhotoUrl(photo)
      .then(url => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, photo.id, photo.storagePath, photo.url, user?.uid]);

  if (authLoading || (!src && !failed)) {
    return <span className={emptyClassName}>…</span>;
  }

  if (failed || !src) {
    return <span className={emptyClassName}>—</span>;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
};
