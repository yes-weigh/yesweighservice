import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { resolveHrPhotoUrl } from '../../lib/hrStaff';
import type { FirestoreUserDoc } from '../../types';

export const HrStaffPhoto: React.FC<{
  userId: string;
  photo?: Pick<FirestoreUserDoc, 'hrPhotoStoragePath' | 'hrPhotoUrl'> | null;
  className?: string;
  placeholderClassName?: string;
  iconSize?: number;
}> = ({
  userId,
  photo = null,
  className = '',
  placeholderClassName = '',
  iconSize = 20,
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setUrl(null);

    if (!photo?.hrPhotoStoragePath && !photo?.hrPhotoUrl) {
      return () => {
        active = false;
      };
    }

    void resolveHrPhotoUrl(userId, photo).then(resolved => {
      if (active) setUrl(resolved);
    });

    return () => {
      active = false;
    };
  }, [userId, photo?.hrPhotoStoragePath, photo?.hrPhotoUrl]);

  if (!url || failed) {
    return (
      <div className={placeholderClassName || className} aria-hidden>
        <Users size={iconSize} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
};
